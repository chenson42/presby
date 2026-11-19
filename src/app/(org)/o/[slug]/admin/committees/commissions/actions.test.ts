/**
 * The commission Server Actions (`commissions/actions.ts`,
 * `commissions/[commissionId]/actions.ts`) with the gate and the store mocked
 * (docs/work-log/2026-11-19-presbytery-committees.md, Phase 3 "API Contract",
 * Increment 2). Pinned: every action runs the gate FIRST and returns its refusal
 * untouched (the store is never called); an invalid form returns BEFORE any store
 * call; the store receives the PARSED input and the ids from the form; a missing or
 * malformed edit version is refused as tampered; a store outcome is the fixed
 * `copy.ts` string (the commission wording for the kinds that differ by object); the
 * congregation id is handed to the store unchecked (one neutral answer there). The
 * store's own checks are `store.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveCommitteesActor: vi.fn(),
  recordCommission: vi.fn(),
  updateCommission: vi.fn(),
  addCommissionMember: vi.fn(),
  endCommissionMember: vi.fn(),
  endCommission: vi.fn(),
  removeCommissionRecord: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/authz", () => ({ resolveOrgContext: vi.fn() }));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: vi.fn() }));
vi.mock("@/lib/committees/action-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/committees/action-gate")>();
  return { ...actual, resolveCommitteesActor: mocks.resolveCommitteesActor };
});
vi.mock("@/lib/committees/store", () => ({
  recordCommission: mocks.recordCommission,
  updateCommission: mocks.updateCommission,
  addCommissionMember: mocks.addCommissionMember,
  endCommissionMember: mocks.endCommissionMember,
  endCommission: mocks.endCommission,
  removeCommissionRecord: mocks.removeCommissionRecord,
}));

import { recordCommissionAction } from "./actions";
import {
  addCommissionMemberAction,
  endCommissionAction,
  endCommissionMemberAction,
  removeCommissionRecordAction,
  updateCommissionAction,
} from "./[commissionId]/actions";
import { REFUSAL } from "@/lib/committees/copy";

const KID = "00000000-0000-4000-8000-0000000000c1";
const MID = "00000000-0000-4000-8000-0000000000e1";
const PID = "00000000-0000-4000-8000-0000000000a1";
const GID = "00000000-0000-4000-8000-0000000000b1";
const identity = {
  slug: "northern",
  env: { today: "2026-06-15" },
  ctx: { personId: "person-1", organizationId: "org-1", actor: { userId: "user-1", email: "clerk@example.invalid" } },
};
const refusal = { ok: false, error: "You must be signed in to do that.", kind: "unauthenticated" } as const;
const stores = ["recordCommission", "updateCommission", "addCommissionMember", "endCommissionMember", "endCommission", "removeCommissionRecord"] as const;

const record = { title: "Commission on Alder Creek", charge: "", aboutOrgId: "", appointedOn: "2026-06-01", minuteReference: "" };
const COMMISSION = { subject: "commission" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveCommitteesActor.mockResolvedValue({ ok: true, identity });
  for (const s of stores) mocks[s].mockResolvedValue({ kind: "ok", data: { id: "result-id" } });
});

const noStoreCalls = () => stores.forEach((s) => expect(mocks[s], s).not.toHaveBeenCalled());

describe("every commission action runs the gate first and returns its refusal untouched", () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["recordCommissionAction", () => recordCommissionAction("northern", record)],
    ["updateCommissionAction", () => updateCommissionAction("northern", { ...record, commissionId: KID, expectedVersion: "1" })],
    ["addCommissionMemberAction", () => addCommissionMemberAction("northern", { commissionId: KID, personId: PID, role: "member", startsOn: "2026-06-01", endsOn: "" })],
    ["endCommissionMemberAction", () => endCommissionMemberAction("northern", { commissionId: KID, memberId: MID, endsOn: "2026-06-01" })],
    ["endCommissionAction", () => endCommissionAction("northern", { commissionId: KID, endedOn: "2026-06-01", endedMinuteReference: "" })],
    ["removeCommissionRecordAction", () => removeCommissionRecordAction("northern", { commissionId: KID })],
  ];

  it.each(calls)("%s", async (_name, call) => {
    mocks.resolveCommitteesActor.mockResolvedValue({ ok: false, result: refusal });
    expect(await call()).toEqual(refusal);
    noStoreCalls();
  });

  it("each action names its ids to the gate (a malformed id is refused there, before any SQL) and never an organization id", async () => {
    await recordCommissionAction("northern", record);
    expect(mocks.resolveCommitteesActor).toHaveBeenLastCalledWith("northern", {}, COMMISSION);
    await updateCommissionAction("northern", { ...record, commissionId: KID, expectedVersion: "1" });
    expect(mocks.resolveCommitteesActor).toHaveBeenLastCalledWith("northern", { commissionId: KID }, COMMISSION);
    await endCommissionMemberAction("northern", { commissionId: KID, memberId: MID, endsOn: "2026-06-01" });
    expect(mocks.resolveCommitteesActor).toHaveBeenLastCalledWith("northern", { commissionId: KID, memberId: MID }, COMMISSION);
  });

  it("a null or non-object form is handled defensively (the gate refuses the missing id)", async () => {
    mocks.resolveCommitteesActor.mockResolvedValue({ ok: false, result: refusal });
    expect(await removeCommissionRecordAction("northern", null as never)).toEqual(refusal);
    expect(mocks.resolveCommitteesActor).toHaveBeenLastCalledWith("northern", { commissionId: undefined }, COMMISSION);
    noStoreCalls();
  });
});

describe("an invalid form returns BEFORE any store call, with the field's own message", () => {
  it("record: a missing title, an over-long charge, no appointed date", async () => {
    expect(await recordCommissionAction("northern", { ...record, title: " " })).toEqual({ ok: false, error: "Title is required.", field: "title", kind: "invalid" });
    expect(await recordCommissionAction("northern", { ...record, charge: "c".repeat(501) })).toMatchObject({ ok: false, field: "charge", error: "Charge must be 500 characters or fewer." });
    expect(await recordCommissionAction("northern", { ...record, appointedOn: "" })).toMatchObject({ ok: false, field: "appointedOn", error: "Choose the date it was appointed." });
    expect(await recordCommissionAction("northern", { ...record, appointedOn: "2026-06-16" })).toMatchObject({
      ok: false,
      field: "appointedOn",
      error: "The appointed date can't be after today.",
    });
    expect((await recordCommissionAction("northern", { ...record, appointedOn: "2026-06-15" })).ok).toBe(true);
    mocks.recordCommission.mockClear();
    noStoreCalls();
  });

  it("update, add, end a member and end the commission each validate", async () => {
    expect(await updateCommissionAction("northern", { ...record, commissionId: KID, expectedVersion: "1", title: "t".repeat(201) })).toMatchObject({ ok: false, field: "title" });
    expect(await addCommissionMemberAction("northern", { commissionId: KID, personId: "nope", role: "member", startsOn: "2026-06-01", endsOn: "" })).toMatchObject({ ok: false, field: "personId" });
    expect(await addCommissionMemberAction("northern", { commissionId: KID, personId: PID, role: "leader", startsOn: "2026-06-01", endsOn: "" })).toMatchObject({ ok: false, field: "role" });
    expect(await endCommissionMemberAction("northern", { commissionId: KID, memberId: MID, endsOn: "2026-02-30" })).toMatchObject({ ok: false, field: "endsOn" });
    expect(await endCommissionAction("northern", { commissionId: KID, endedOn: "2026-06-16", endedMinuteReference: "" })).toMatchObject({
      ok: false,
      field: "endedOn",
      error: "The end date can't be in the future.",
    });
    expect(await endCommissionAction("northern", { commissionId: KID, endedOn: "2026-06-01", endedMinuteReference: "m".repeat(201) })).toMatchObject({ ok: false, field: "endedMinuteReference" });
    noStoreCalls();
  });

  it("the server's own day is the validation env (ending today is allowed, tomorrow is not)", async () => {
    expect((await endCommissionAction("northern", { commissionId: KID, endedOn: "2026-06-15", endedMinuteReference: "" })).ok).toBe(true);
    expect((await endCommissionAction("northern", { commissionId: KID, endedOn: "2026-06-16", endedMinuteReference: "" })).ok).toBe(false);
  });

  it("an edit without a usable version is refused as tampered, writing nothing (a form always carries it)", async () => {
    for (const bad of [undefined, "", "0", "-1", "abc", 1.5, null]) {
      expect(await updateCommissionAction("northern", { ...record, commissionId: KID, expectedVersion: bad as never }), String(bad)).toEqual({
        ok: false,
        error: REFUSAL.save_failed,
        kind: "invalid",
      });
    }
    noStoreCalls();
  });
});

describe("the store receives the parsed input and the ids from the form", () => {
  it("record passes the cleaned values and the context the gate returned; the congregation id goes UNCHECKED", async () => {
    const result = await recordCommissionAction("northern", {
      title: "  Commission   on Alder Creek ",
      charge: " To review the session's records. ",
      aboutOrgId: ` ${GID} `,
      appointedOn: "2026-06-01",
      minuteReference: " 2026-05-12, item 7 ",
    });
    expect(mocks.recordCommission).toHaveBeenCalledWith(identity.ctx, {
      title: "Commission on Alder Creek",
      charge: "To review the session's records.",
      aboutOrgId: GID,
      appointedOn: "2026-06-01",
      minuteReference: "2026-05-12, item 7",
    });
    expect(result).toEqual({ ok: true, data: { id: "result-id" } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/northern/admin/committees");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/northern/admin/committees/commissions/result-id");
    await recordCommissionAction("northern", { ...record, aboutOrgId: "not-a-uuid" });
    expect(mocks.recordCommission).toHaveBeenLastCalledWith(identity.ctx, expect.objectContaining({ aboutOrgId: "not-a-uuid" }));
  });

  it("update, add, end a member, end and remove pass the commission, the member and the parsed values", async () => {
    await updateCommissionAction("northern", { ...record, commissionId: KID, expectedVersion: "3" });
    expect(mocks.updateCommission).toHaveBeenCalledWith(identity.ctx, KID, { title: "Commission on Alder Creek", charge: null, aboutOrgId: null, appointedOn: "2026-06-01", minuteReference: null }, 3);
    await updateCommissionAction("northern", { ...record, commissionId: KID, expectedVersion: 4 });
    expect(mocks.updateCommission).toHaveBeenLastCalledWith(identity.ctx, KID, expect.anything(), 4);

    await addCommissionMemberAction("northern", { commissionId: KID, personId: PID, role: "clerk", startsOn: "2026-06-01", endsOn: "2027-06-01" });
    expect(mocks.addCommissionMember).toHaveBeenCalledWith(identity.ctx, KID, { personId: PID, role: "clerk", startsOn: "2026-06-01", endsOn: "2027-06-01" });

    await endCommissionMemberAction("northern", { commissionId: KID, memberId: MID, endsOn: "" });
    expect(mocks.endCommissionMember).toHaveBeenCalledWith(identity.ctx, KID, MID, { endsOn: null });

    await endCommissionAction("northern", { commissionId: KID, endedOn: "2026-06-01", endedMinuteReference: " reported 2026-06-01 " });
    expect(mocks.endCommission).toHaveBeenCalledWith(identity.ctx, KID, { endedOn: "2026-06-01", endedMinuteReference: "reported 2026-06-01" });

    await removeCommissionRecordAction("northern", { commissionId: KID });
    expect(mocks.removeCommissionRecord).toHaveBeenCalledWith(identity.ctx, KID);
  });
});

describe("a store outcome becomes one fixed copy string", () => {
  it("the kinds that differ by object read in the commission's wording; nothing is database text", async () => {
    mocks.addCommissionMember.mockResolvedValue({ kind: "refused", reason: "overlap", detail: { personName: "Wren Halloway", subject: "commission" } });
    expect(await addCommissionMemberAction("northern", { commissionId: KID, personId: PID, role: "member", startsOn: "2026-06-01", endsOn: "" })).toEqual({
      ok: false,
      error: "Wren Halloway already serves on this commission during those dates. End that term first.",
      kind: "overlap",
    });
    mocks.addCommissionMember.mockResolvedValue({ kind: "refused", reason: "commission_ended" });
    expect(await addCommissionMemberAction("northern", { commissionId: KID, personId: PID, role: "member", startsOn: "2026-06-01", endsOn: "" })).toEqual({
      ok: false,
      error: "This commission has ended, so no one can be added.",
      kind: "commission_ended",
    });
    mocks.recordCommission.mockResolvedValue({ kind: "refused", reason: "congregation_not_found", detail: { presbyteryName: "Northern Reach" } });
    expect(await recordCommissionAction("northern", { ...record, aboutOrgId: GID })).toEqual({
      ok: false,
      error: "That congregation could not be found among Northern Reach's member congregations.",
      kind: "congregation_not_found",
    });
    mocks.updateCommission.mockResolvedValue({ kind: "refused", reason: "stale", detail: { subject: "commission" } });
    expect(await updateCommissionAction("northern", { ...record, commissionId: KID, expectedVersion: "1" })).toMatchObject({
      ok: false,
      kind: "stale",
      error: "This record was changed by someone else after you opened it. Reload the page, then make your change again.",
    });
    mocks.endCommission.mockResolvedValue({ kind: "refused", reason: "already_ended", detail: { subject: "commission" } });
    expect(await endCommissionAction("northern", { commissionId: KID, endedOn: "2026-06-01", endedMinuteReference: "" })).toMatchObject({
      ok: false,
      error: "This commission has already ended.",
    });
  });

  it("an unchanged edit is ok and revalidates nothing; an end reports how many members it ended", async () => {
    mocks.updateCommission.mockResolvedValue({ kind: "ok", data: { id: KID, unchanged: true } });
    mocks.revalidatePath.mockClear();
    expect(await updateCommissionAction("northern", { ...record, commissionId: KID, expectedVersion: "1" })).toEqual({ ok: true, data: { id: KID, unchanged: true } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    mocks.endCommission.mockResolvedValue({ kind: "ok", data: { id: KID, membersEnded: 3 } });
    expect(await endCommissionAction("northern", { commissionId: KID, endedOn: "2026-06-01", endedMinuteReference: "" })).toEqual({ ok: true, data: { id: KID, membersEnded: 3 } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/northern/admin/committees/commissions/" + KID);
  });

  it("a store field message passes through under its field", async () => {
    mocks.endCommission.mockResolvedValue({ kind: "invalid", field: "endedOn", message: "The end date can't be in the future." });
    expect(await endCommissionAction("northern", { commissionId: KID, endedOn: "2026-06-01", endedMinuteReference: "" })).toEqual({
      ok: false,
      error: "The end date can't be in the future.",
      field: "endedOn",
      kind: "invalid",
    });
  });
});
