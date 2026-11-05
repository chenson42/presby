/**
 * The member-tree worship actions (docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 "Server actions"; Phase 4 Batch 3). Unit-level: the store and the
 * session are mocked. Pinned here is what the ACTION owns: it authenticates,
 * derives the viewer from the session and the slug (never from the input),
 * parses the input, attempts the inline email send AFTER the store's commit and
 * only for the two actions that queue mail, maps every store result to a Copy
 * sentence, and revalidates what changed. The gate, the validation and the audit
 * rows are proven against a real database in `store.*.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ value: null as null | { user: { id: string; email: string | null } } }));
const resolve = vi.hoisted(() => vi.fn());
const revalidate = vi.hoisted(() => vi.fn());
const sendQueued = vi.hoisted(() => vi.fn(async () => undefined));
const store = vi.hoisted(() => ({
  respondToAssignment: vi.fn(),
  addBlockout: vi.fn(),
  endBlockout: vi.fn(),
  placePerson: vi.fn(),
  placeGuest: vi.fn(),
  removeAssignment: vi.fn(),
  recordResponse: vi.fn(),
  sendRequests: vi.fn(),
}));
const reads = vi.hoisted(() => ({ getPickerCandidates: vi.fn(), getSendPreview: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/auth", () => ({ auth: async () => session.value }));
vi.mock("@/lib/authz", () => {
  class OrgAccessError extends Error {}
  return { OrgAccessError, resolveOrgContext: resolve };
});
vi.mock("@/lib/worship/store", () => store);
vi.mock("@/lib/worship/reads", () => reads);
vi.mock("@/lib/worship/notify", () => ({ sendQueued }));

import { OrgAccessError } from "@/lib/authz";
import { ACTION_COPY, GATE_COPY } from "@/lib/worship/copy";
import * as actions from "./actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  session.value = { user: { id: "user-1", email: "actor@example.invalid" } };
  resolve.mockResolvedValue({
    kind: "ok",
    org: { organizationId: ORG, personId: PERSON, name: "Alder Creek", organizationType: "congregation", slug: "alder-creek", platformStatus: "managed" },
  });
});

type Case = [name: string, call: () => Promise<{ ok: boolean; error?: string }>, mock: ReturnType<typeof vi.fn>];

const cases: Case[] = [
  ["respondToRequestAction", () => actions.respondToRequestAction("alder-creek", { assignmentId: ID, answer: "accepted" }), store.respondToAssignment],
  ["addBlockoutAction", () => actions.addBlockoutAction("alder-creek", { startsOn: "2099-01-01", endsOn: "2099-01-02" }), store.addBlockout],
  ["endBlockoutAction", () => actions.endBlockoutAction("alder-creek", { blockoutId: ID }), store.endBlockout],
  ["placePersonAction", () => actions.placePersonAction("alder-creek", { eventId: ID, groupId: ID, positionId: ID, personId: ID }), store.placePerson],
  ["placeGuestAction", () => actions.placeGuestAction("alder-creek", { eventId: ID, groupId: ID, positionId: ID, guestName: "Visitor" }), store.placeGuest],
  ["removeAssignmentAction", () => actions.removeAssignmentAction("alder-creek", { assignmentId: ID }), store.removeAssignment],
  ["recordResponseAction", () => actions.recordResponseAction("alder-creek", { assignmentId: ID, answer: "declined", reason: "away" }), store.recordResponse],
  ["sendRequestsAction", () => actions.sendRequestsAction("alder-creek", {}), store.sendRequests],
  [
    "getPickerCandidatesAction",
    () => actions.getPickerCandidatesAction("alder-creek", { eventId: ID, groupId: ID, positionId: ID, showAll: false }),
    reads.getPickerCandidates,
  ],
  ["getSendPreviewAction", () => actions.getSendPreviewAction("alder-creek", { eventIds: [ID], groupId: ID }), reads.getSendPreview],
];

describe.each(cases)("%s", (_name, call, mock) => {
  it("refuses a signed-out caller with the forbidden sentence and calls nothing", async () => {
    session.value = null;
    expect(await call()).toEqual({ ok: false, error: ACTION_COPY.forbidden });
    expect(mock).not.toHaveBeenCalled();
  });

  it("refuses a slug that does not resolve for this user and calls nothing", async () => {
    resolve.mockResolvedValue({ kind: "forbidden", name: "Alder Creek", organizationType: "congregation" });
    expect(await call()).toEqual({ ok: false, error: ACTION_COPY.forbidden });
    expect(mock).not.toHaveBeenCalled();
  });

  it("derives the viewer from the session and the slug", async () => {
    mock.mockResolvedValue({ kind: "ok", data: { queueIds: [], changed: true, sent: 0, emailed: 0, guardian: 0, noAddress: 0, doNotContact: 0, notOnTeam: 0, services: 0 } });
    await call();
    expect(resolve).toHaveBeenCalledWith("user-1", "alder-creek");
    expect(mock.mock.calls[0]![0]).toEqual({ personId: PERSON, organizationId: ORG, organizationType: "congregation", userId: "user-1", email: "actor@example.invalid" });
  });

  it("maps every non-ok store result to a Copy sentence", async () => {
    const expectations: Array<[unknown, string]> = [
      [{ kind: "not_applicable" }, GATE_COPY.notApplicable],
      [{ kind: "toggle_off" }, GATE_COPY.off("Alder Creek")],
      [{ kind: "forbidden" }, ACTION_COPY.forbidden],
      [{ kind: "not_found" }, ACTION_COPY.stale],
      [{ kind: "invalid_input", message: "Enter a name." }, "Enter a name."],
      [{ kind: "conflict", reason: "not_open", message: GATE_COPY.closedRequest.heading }, GATE_COPY.closedRequest.heading],
    ];
    for (const [result, message] of expectations) {
      mock.mockResolvedValueOnce(result);
      expect(await call()).toEqual({ ok: false, error: message });
    }
    expect(sendQueued).not.toHaveBeenCalled();
  });

  it("treats an OrgAccessError (the membership ended mid-request) as forbidden; any other error propagates", async () => {
    mock.mockRejectedValueOnce(new OrgAccessError(PERSON, ORG));
    expect(await call()).toEqual({ ok: false, error: ACTION_COPY.forbidden });
    mock.mockRejectedValueOnce(new Error("connection reset"));
    await expect(call()).rejects.toThrow("connection reset");
  });
});

describe("what the actions do not trust", () => {
  it("never takes an organization id or an acting person from the input: the answering person is the session's", async () => {
    store.respondToAssignment.mockResolvedValue({ kind: "ok", data: { changed: true, queueIds: [] } });
    await actions.respondToRequestAction("alder-creek", {
      assignmentId: ID,
      answer: "accepted",
      organizationId: "99999999-9999-4999-8999-999999999999",
      personId: "88888888-8888-4888-8888-888888888888",
      respondedBy: "x",
    });
    expect(store.respondToAssignment.mock.calls[0]![1]).toEqual({ assignmentId: ID, answer: "accepted" });
    expect(store.respondToAssignment.mock.calls[0]![0].personId).toBe(PERSON);
    expect(store.respondToAssignment.mock.calls[0]![0].organizationId).toBe(ORG);
  });

  it("answers the generic sentence for an input of the wrong shape, without calling the store", async () => {
    expect(await actions.respondToRequestAction("alder-creek", { assignmentId: ID, answer: "maybe" })).toEqual({ ok: false, error: ACTION_COPY.generic });
    expect(await actions.respondToRequestAction("alder-creek", { assignmentId: ID, answer: "declined", reason: "bored" })).toEqual({ ok: false, error: ACTION_COPY.generic });
    expect(await actions.placeGuestAction("alder-creek", "garbage")).toEqual({ ok: false, error: ACTION_COPY.generic });
    expect(await actions.sendRequestsAction("alder-creek", { eventIds: "all" })).toEqual({ ok: false, error: ACTION_COPY.generic });
    expect(await actions.addBlockoutAction("alder-creek", null)).toEqual({ ok: false, error: ACTION_COPY.generic });
    for (const mock of Object.values(store)) expect(mock).not.toHaveBeenCalled();
  });
});

describe("the inline send happens AFTER the commit, for the two actions that queue mail, and never throws into the action", () => {
  it("a decline sends the queued notice; an accept with no queued row sends nothing to send", async () => {
    store.respondToAssignment.mockResolvedValue({ kind: "ok", data: { changed: true, queueIds: ["q1"] } });
    expect(await actions.respondToRequestAction("alder-creek", { assignmentId: ID, answer: "declined", reason: "work" })).toEqual({ ok: true, data: { changed: true } });
    expect(sendQueued).toHaveBeenCalledWith(["q1"]);
    sendQueued.mockClear();
    store.respondToAssignment.mockResolvedValue({ kind: "ok", data: { changed: true, queueIds: [] } });
    await actions.respondToRequestAction("alder-creek", { assignmentId: ID, answer: "accepted" });
    expect(sendQueued).toHaveBeenCalledWith([]);
  });

  it("a Send attempts the inline send for what it queued and returns the counts the toast needs", async () => {
    store.sendRequests.mockResolvedValue({
      kind: "ok",
      data: { sent: 5, emailed: 2, guardian: 1, noAddress: 1, doNotContact: 1, notOnTeam: 0, services: 2, queueIds: ["a", "b"] },
    });
    expect(await actions.sendRequestsAction("alder-creek", { groupId: ID })).toEqual({
      ok: true,
      data: { sent: 5, emailed: 2, notEmailed: 3, notOnTeam: 0, services: 2 },
    });
    expect(sendQueued).toHaveBeenCalledWith(["a", "b"]);
  });

  it("a refused Send or response sends nothing", async () => {
    store.sendRequests.mockResolvedValue({ kind: "conflict", reason: "mail_unavailable", message: ACTION_COPY.sendMailUnavailable });
    expect(await actions.sendRequestsAction("alder-creek", {})).toEqual({ ok: false, error: ACTION_COPY.sendMailUnavailable });
    store.respondToAssignment.mockResolvedValue({ kind: "conflict", reason: "not_open", message: GATE_COPY.closedRequest.heading });
    await actions.respondToRequestAction("alder-creek", { assignmentId: ID, answer: "accepted" });
    expect(sendQueued).not.toHaveBeenCalled();
  });

  it("the placement, removal, record and blockout actions never try to send mail", async () => {
    store.placePerson.mockResolvedValue({ kind: "ok", data: { assignmentId: ID } });
    store.placeGuest.mockResolvedValue({ kind: "ok", data: { assignmentId: ID } });
    store.removeAssignment.mockResolvedValue({ kind: "ok", data: { changed: true } });
    store.recordResponse.mockResolvedValue({ kind: "ok", data: { changed: true } });
    store.addBlockout.mockResolvedValue({ kind: "ok", data: { blockoutId: ID, merged: false, conflicts: [] } });
    store.endBlockout.mockResolvedValue({ kind: "ok", data: { changed: true } });
    await actions.placePersonAction("alder-creek", { eventId: ID, groupId: ID, positionId: ID, personId: ID });
    await actions.placeGuestAction("alder-creek", { eventId: ID, groupId: ID, positionId: ID, guestName: "Visitor" });
    await actions.removeAssignmentAction("alder-creek", { assignmentId: ID });
    await actions.recordResponseAction("alder-creek", { assignmentId: ID, answer: "accepted" });
    await actions.addBlockoutAction("alder-creek", { startsOn: "2099-01-01", endsOn: "2099-01-02", reason: "away" });
    await actions.endBlockoutAction("alder-creek", { blockoutId: ID });
    expect(sendQueued).not.toHaveBeenCalled();
  });
});

describe("results and revalidation", () => {
  it("a blockout returns the merge flag and the conflicts so the page can say so", async () => {
    const conflicts = [{ assignmentId: ID, eventId: ID, startsAt: "2099-01-01T09:00", positionName: "Drums", teamName: "Band" }];
    store.addBlockout.mockResolvedValue({ kind: "ok", data: { blockoutId: ID, merged: true, conflicts } });
    expect(await actions.addBlockoutAction("alder-creek", { startsOn: "2099-01-01", endsOn: "2099-01-01" })).toEqual({
      ok: true,
      data: { blockoutId: ID, merged: true, conflicts },
    });
    expect(revalidate.mock.calls.map((c) => c[0])).toContain("/o/alder-creek/worship/blockouts");
  });

  it("a placement revalidates the board in BOTH trees and the services list", async () => {
    store.placePerson.mockResolvedValue({ kind: "ok", data: { assignmentId: ID } });
    await actions.placePersonAction("alder-creek", { eventId: "e1", groupId: "g1", positionId: ID, personId: ID });
    const paths = revalidate.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/o/alder-creek/worship/teams/g1/services/e1",
        "/o/alder-creek/admin/worship/services/e1",
        "/o/alder-creek/admin/worship/services",
        "/o/alder-creek/worship",
      ]),
    );
  });

  it("answering revalidates that request page", async () => {
    store.respondToAssignment.mockResolvedValue({ kind: "ok", data: { changed: true, queueIds: [] } });
    await actions.respondToRequestAction("alder-creek", { assignmentId: ID, answer: "accepted" });
    expect(revalidate.mock.calls.map((c) => c[0])).toContain(`/o/alder-creek/worship/requests/${ID}`);
  });
});
