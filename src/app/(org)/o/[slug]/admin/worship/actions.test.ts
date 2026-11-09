/**
 * The admin worship actions (docs/work-log/2026-11-04-worship-inc1.md, Phase 3
 * "Server actions"; Phase 4 Batch 2). Unit-level: the store and the session are
 * mocked. What is pinned here is what the ACTION owns: it authenticates,
 * derives the viewer from the session and the slug (never from the input),
 * parses the input, maps every store result to a Copy sentence, and
 * revalidates the pages that changed. The gate, the validation and the audit
 * rows are proven against a real database in `store.*.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ value: null as null | { user: { id: string; email: string | null } } }));
const resolve = vi.hoisted(() => vi.fn());
const revalidate = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({
  createTeam: vi.fn(),
  adoptTeam: vi.fn(),
  updateTeam: vi.fn(),
  retireTeam: vi.fn(),
  addPosition: vi.fn(),
  updatePosition: vi.fn(),
  retirePosition: vi.fn(),
  setQualifications: vi.fn(),
  addTeamMember: vi.fn(),
  endTeamMember: vi.fn(),
  createServiceType: vi.fn(),
  updateServiceType: vi.fn(),
  retireServiceType: vi.fn(),
  setServiceTypeTeams: vi.fn(),
  createService: vi.fn(),
  generateServices: vi.fn(),
  updateService: vi.fn(),
  cancelService: vi.fn(),
  setServiceTeams: vi.fn(),
}));
const reads = vi.hoisted(() => ({ searchRosterCandidates: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/auth", () => ({ auth: async () => session.value }));
vi.mock("@/lib/authz", () => {
  class OrgAccessError extends Error {}
  return { OrgAccessError, resolveOrgContext: resolve };
});
vi.mock("@/lib/worship/store", () => store);
vi.mock("@/lib/worship/reads", () => reads);

import { OrgAccessError } from "@/lib/authz";
import { ACTION_COPY, GATE_COPY } from "@/lib/worship/copy";
import * as actions from "./actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";

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
  ["createTeamAction", () => actions.createTeamAction("alder-creek", { name: "Band", kind: "team" }), store.createTeam],
  ["adoptTeamAction", () => actions.adoptTeamAction("alder-creek", { groupId: GROUP }), store.adoptTeam],
  ["updateTeamAction", () => actions.updateTeamAction("alder-creek", { groupId: GROUP, name: "Band" }), store.updateTeam],
  ["retireTeamAction", () => actions.retireTeamAction("alder-creek", { groupId: GROUP }), store.retireTeam],
  ["addPositionAction", () => actions.addPositionAction("alder-creek", { groupId: GROUP, name: "Drums", slots: 1 }), store.addPosition],
  ["updatePositionAction", () => actions.updatePositionAction("alder-creek", { positionId: GROUP, name: "Drums", slots: 1 }), store.updatePosition],
  ["retirePositionAction", () => actions.retirePositionAction("alder-creek", { positionId: GROUP }), store.retirePosition],
  ["setQualificationsAction", () => actions.setQualificationsAction("alder-creek", { groupId: GROUP, personId: GROUP, positionIds: [] }), store.setQualifications],
  ["addTeamMemberAction", () => actions.addTeamMemberAction("alder-creek", { groupId: GROUP, personId: GROUP }), store.addTeamMember],
  ["endTeamMemberAction", () => actions.endTeamMemberAction("alder-creek", { groupId: GROUP, groupMembershipId: GROUP }), store.endTeamMember],
  ["createServiceTypeAction", () => actions.createServiceTypeAction("alder-creek", { name: "Sunday", startTime: "09:00" }), store.createServiceType],
  ["updateServiceTypeAction", () => actions.updateServiceTypeAction("alder-creek", { serviceTypeId: GROUP, name: "Sunday", startTime: "09:00" }), store.updateServiceType],
  ["retireServiceTypeAction", () => actions.retireServiceTypeAction("alder-creek", { serviceTypeId: GROUP }), store.retireServiceType],
  ["setServiceTypeTeamsAction", () => actions.setServiceTypeTeamsAction("alder-creek", { serviceTypeId: GROUP, groupIds: [] }), store.setServiceTypeTeams],
  ["searchRosterCandidatesAction", () => actions.searchRosterCandidatesAction("alder-creek", { groupId: GROUP, q: "al" }), reads.searchRosterCandidates],
  ["createServiceAction", () => actions.createServiceAction("alder-creek", { title: "Sunday", startsAt: "2099-01-01T09:00", groupIds: [] }), store.createService],
  ["generateServicesAction", () => actions.generateServicesAction("alder-creek", { serviceTypeId: GROUP, firstDate: "2099-01-01", pattern: "weekly", count: 4 }), store.generateServices],
  ["updateServiceAction", () => actions.updateServiceAction("alder-creek", { eventId: GROUP, title: "Sunday", startsAt: "2099-01-01T09:00" }), store.updateService],
  ["cancelServiceAction", () => actions.cancelServiceAction("alder-creek", { eventId: GROUP }), store.cancelService],
  ["setServiceTeamsAction", () => actions.setServiceTeamsAction("alder-creek", { eventId: GROUP, groupIds: [] }), store.setServiceTeams],
];

describe.each(cases)("%s", (_name, call, mock) => {
  it("refuses a signed-out caller with the forbidden sentence and calls nothing", async () => {
    session.value = null;
    expect(await call()).toEqual({ ok: false, error: ACTION_COPY.forbidden });
    expect(mock).not.toHaveBeenCalled();
  });

  it("refuses a slug that does not resolve for this user (the four-way miss collapses to forbidden) and calls nothing", async () => {
    resolve.mockResolvedValue({ kind: "forbidden", name: "Alder Creek", organizationType: "congregation" });
    expect(await call()).toEqual({ ok: false, error: ACTION_COPY.forbidden });
    expect(mock).not.toHaveBeenCalled();
  });

  it("derives the viewer from the session and the slug", async () => {
    mock.mockResolvedValue({ kind: "ok", data: {} });
    await call();
    expect(resolve).toHaveBeenCalledWith("user-1", "alder-creek");
    expect(mock.mock.calls[0]![0]).toEqual({
      personId: PERSON,
      organizationId: ORG,
      organizationType: "congregation",
      userId: "user-1",
      email: "actor@example.invalid",
    });
  });

  it("maps every non-ok store result to a Copy sentence", async () => {
    const expectations: Array<[unknown, string]> = [
      [{ kind: "not_applicable" }, GATE_COPY.notApplicable],
      [{ kind: "toggle_off" }, GATE_COPY.off("Alder Creek")],
      [{ kind: "forbidden" }, ACTION_COPY.forbidden],
      [{ kind: "not_found" }, ACTION_COPY.stale],
      [{ kind: "invalid_input", message: "Enter a name." }, "Enter a name."],
      [{ kind: "conflict", reason: "in_use", message: "Band is still scheduled for 2 upcoming services. Remove those people first." }, "Band is still scheduled for 2 upcoming services. Remove those people first."],
    ];
    for (const [result, message] of expectations) {
      mock.mockResolvedValueOnce(result);
      expect(await call()).toEqual({ ok: false, error: message });
    }
  });

  it("treats an OrgAccessError (the membership ended mid-request) as forbidden", async () => {
    mock.mockRejectedValueOnce(new OrgAccessError(PERSON, ORG));
    expect(await call()).toEqual({ ok: false, error: ACTION_COPY.forbidden });
  });

  it("lets an error that is not ours propagate", async () => {
    mock.mockRejectedValueOnce(new Error("connection reset"));
    await expect(call()).rejects.toThrow("connection reset");
  });
});

describe("what the actions do not trust", () => {
  it("never passes an organization id or an acting person from the input to the store", async () => {
    store.createTeam.mockResolvedValue({ kind: "ok", data: { groupId: GROUP, positionIds: [] } });
    await actions.createTeamAction("alder-creek", {
      name: "Band",
      kind: "team",
      organizationId: "99999999-9999-4999-8999-999999999999",
      personId: "88888888-8888-4888-8888-888888888888",
      viewer: { personId: "x" },
    });
    expect(store.createTeam.mock.calls[0]![1]).toEqual({ name: "Band", kind: "team" });
    expect(store.createTeam.mock.calls[0]![0].organizationId).toBe(ORG);
    expect(store.createTeam.mock.calls[0]![0].personId).toBe(PERSON);
  });

  it("answers the generic sentence for an input of the wrong shape, without calling the store", async () => {
    expect(await actions.createTeamAction("alder-creek", { name: 5, kind: "team" })).toEqual({ ok: false, error: ACTION_COPY.generic });
    expect(await actions.addPositionAction("alder-creek", "garbage")).toEqual({ ok: false, error: ACTION_COPY.generic });
    expect(await actions.createTeamAction("alder-creek", null)).toEqual({ ok: false, error: ACTION_COPY.generic });
    expect(store.createTeam).not.toHaveBeenCalled();
    expect(store.addPosition).not.toHaveBeenCalled();
  });

  it("resolves the organization from the slug the caller named, inside the user's own memberships", async () => {
    store.retireTeam.mockResolvedValue({ kind: "ok", data: { groupId: GROUP } });
    await actions.retireTeamAction("some-other-slug", { groupId: GROUP });
    expect(resolve).toHaveBeenCalledWith("user-1", "some-other-slug");
  });
});

describe("revalidation and results", () => {
  it("a created team revalidates the hub, the teams list and Groups, and returns the new group id", async () => {
    store.createTeam.mockResolvedValue({ kind: "ok", data: { groupId: GROUP, positionIds: ["p"] } });
    expect(await actions.createTeamAction("alder-creek", { name: "Band", kind: "team", starter: "praise_band" })).toEqual({
      ok: true,
      data: { groupId: GROUP },
    });
    const paths = revalidate.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(expect.arrayContaining([
      "/o/alder-creek/admin/worship",
      "/o/alder-creek/admin/worship/teams",
      "/o/alder-creek/admin/groups",
    ]));
  });

  it("a position change revalidates that team's page", async () => {
    store.addPosition.mockResolvedValue({ kind: "ok", data: { positionId: "p" } });
    await actions.addPositionAction("alder-creek", { groupId: GROUP, name: "Drums", slots: 1 });
    expect(revalidate.mock.calls.map((c) => c[0])).toContain(`/o/alder-creek/admin/worship/teams/${GROUP}`);
  });

  it("service type changes revalidate the service types page", async () => {
    store.createServiceType.mockResolvedValue({ kind: "ok", data: { serviceTypeId: "t" } });
    await actions.createServiceTypeAction("alder-creek", { name: "Sunday", startTime: "09:00" });
    expect(revalidate.mock.calls.map((c) => c[0])).toContain("/o/alder-creek/admin/worship/service-types");
  });

  it("a service change revalidates the services pages and the calendar; a cancel revalidates that service", async () => {
    store.cancelService.mockResolvedValue({ kind: "ok", data: { changed: true } });
    expect(await actions.cancelServiceAction("alder-creek", { eventId: GROUP })).toEqual({ ok: true, data: { changed: true } });
    const paths = revalidate.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/o/alder-creek/admin/worship/services",
        `/o/alder-creek/admin/worship/services/${GROUP}`,
        "/o/alder-creek/worship",
        "/o/alder-creek/calendar",
      ]),
    );
  });

  it("adding a service returns the duplicate hint untouched so the form can ask 'Add it anyway'", async () => {
    store.createService.mockResolvedValue({ kind: "ok", data: { created: false, duplicate: { eventId: GROUP, title: "Morning worship" } } });
    expect(await actions.createServiceAction("alder-creek", { title: "x", startsAt: "2099-01-01T09:00", groupIds: [] })).toEqual({
      ok: true,
      data: { created: false, duplicate: { eventId: GROUP, title: "Morning worship" } },
    });
    store.createService.mockResolvedValue({ kind: "ok", data: { created: true, eventId: GROUP } });
    await actions.createServiceAction("alder-creek", { title: "x", startsAt: "2099-01-01T09:00", groupIds: [], allowDuplicate: true });
    expect(store.createService.mock.calls[1]![1]).toMatchObject({ allowDuplicate: true });
  });

  it("the roster search is a read: it revalidates nothing and returns the names", async () => {
    reads.searchRosterCandidates.mockResolvedValue({ kind: "ok", data: [{ personId: PERSON, displayName: "Alice Worshiptest" }] });
    expect(await actions.searchRosterCandidatesAction("alder-creek", { groupId: GROUP, q: "al" })).toEqual({
      ok: true,
      data: [{ personId: PERSON, displayName: "Alice Worshiptest" }],
    });
    expect(revalidate).not.toHaveBeenCalled();
  });
});
