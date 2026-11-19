/**
 * The committees Server Actions (`new/actions.ts`, `[committeeId]/actions.ts`) with
 * the gate and the store mocked (docs/work-log/2026-11-19-presbytery-committees.md,
 * Phase 3 "API Contract"). Pinned: every action runs the gate FIRST and returns its
 * refusal untouched (the store is never called); an invalid form returns BEFORE any
 * store call; the store receives the PARSED input and the ids from the form; a
 * non-boolean listing switch is refused as tampered; a store outcome is the fixed
 * `copy.ts` string. The store's own checks are `store.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  resolveCommitteesActor: vi.fn(),
  createCommittee: vi.fn(),
  updateCommittee: vi.fn(),
  dissolveCommittee: vi.fn(),
  addCommitteeSeat: vi.fn(),
  changeCommitteeSeatRole: vi.fn(),
  endCommitteeSeat: vi.fn(),
  setCommitteeSeatPublicListed: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
// The real action-gate (for finish, invalidResult, tamperedResult) imports these; nothing here signs anyone in.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/authz", () => ({ resolveOrgContext: vi.fn() }));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: vi.fn() }));
vi.mock("@/lib/committees/action-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/committees/action-gate")>();
  return { ...actual, resolveCommitteesActor: mocks.resolveCommitteesActor };
});
vi.mock("@/lib/committees/store", () => ({
  createCommittee: mocks.createCommittee,
  updateCommittee: mocks.updateCommittee,
  dissolveCommittee: mocks.dissolveCommittee,
  addCommitteeSeat: mocks.addCommitteeSeat,
  changeCommitteeSeatRole: mocks.changeCommitteeSeatRole,
  endCommitteeSeat: mocks.endCommitteeSeat,
  setCommitteeSeatPublicListed: mocks.setCommitteeSeatPublicListed,
}));

import { createCommitteeAction } from "./new/actions";
import {
  addCommitteeSeatAction,
  changeCommitteeSeatRoleAction,
  dissolveCommitteeAction,
  endCommitteeSeatAction,
  setCommitteeSeatPublicListedAction,
  updateCommitteeAction,
} from "./[committeeId]/actions";
import { REFUSAL } from "@/lib/committees/copy";

const CID = "00000000-0000-4000-8000-0000000000c1";
const MID = "00000000-0000-4000-8000-0000000000e1";
const PID = "00000000-0000-4000-8000-0000000000a1";
const identity = {
  slug: "northern",
  env: { today: "2026-06-15" },
  ctx: { personId: "person-1", organizationId: "org-1", actor: { userId: "user-1", email: "clerk@example.invalid" } },
};
const refusal = { ok: false, error: "You must be signed in to do that.", kind: "unauthenticated" } as const;
const stores = ["createCommittee", "updateCommittee", "dissolveCommittee", "addCommitteeSeat", "changeCommitteeSeatRole", "endCommitteeSeat", "setCommitteeSeatPublicListed"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveCommitteesActor.mockResolvedValue({ ok: true, identity });
  for (const s of stores) mocks[s].mockResolvedValue({ kind: "ok", data: { id: "result-id" } });
});

const noStoreCalls = () => stores.forEach((s) => expect(mocks[s], s).not.toHaveBeenCalled());

describe("every action runs the gate first and returns its refusal untouched", () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["createCommitteeAction", () => createCommitteeAction("northern", { name: "Ministry", kind: "required", purpose: "", meetsWhen: "" })],
    ["updateCommitteeAction", () => updateCommitteeAction("northern", { committeeId: CID, name: "Ministry", kind: "required", purpose: "", meetsWhen: "" })],
    ["dissolveCommitteeAction", () => dissolveCommitteeAction("northern", { committeeId: CID, dissolvedOn: "2026-06-01" })],
    ["addCommitteeSeatAction", () => addCommitteeSeatAction("northern", { committeeId: CID, personId: PID, role: "member", startsOn: "2026-06-01", endsOn: "" })],
    ["changeCommitteeSeatRoleAction", () => changeCommitteeSeatRoleAction("northern", { committeeId: CID, membershipId: MID, expectedRole: "member", newRole: "clerk", effectiveOn: "2026-06-01" })],
    ["endCommitteeSeatAction", () => endCommitteeSeatAction("northern", { committeeId: CID, membershipId: MID, endsOn: "2026-06-01" })],
    ["setCommitteeSeatPublicListedAction", () => setCommitteeSeatPublicListedAction("northern", { committeeId: CID, membershipId: MID, publicListed: true })],
  ];

  it.each(calls)("%s", async (_name, call) => {
    mocks.resolveCommitteesActor.mockResolvedValue({ ok: false, result: refusal });
    expect(await call()).toEqual(refusal);
    noStoreCalls();
  });

  it("each action names its ids to the gate (a malformed id is refused there, before any SQL) and never an organization id", async () => {
    await updateCommitteeAction("northern", { committeeId: CID, name: "A", kind: "required", purpose: "", meetsWhen: "" });
    expect(mocks.resolveCommitteesActor).toHaveBeenLastCalledWith("northern", { committeeId: CID });
    await endCommitteeSeatAction("northern", { committeeId: CID, membershipId: MID, endsOn: "2026-06-01" });
    expect(mocks.resolveCommitteesActor).toHaveBeenLastCalledWith("northern", { committeeId: CID, membershipId: MID });
    await createCommitteeAction("northern", { name: "A", kind: "required", purpose: "", meetsWhen: "" });
    expect(mocks.resolveCommitteesActor).toHaveBeenLastCalledWith("northern");
  });

  it("a null or non-object form is handled defensively (the gate refuses the missing id)", async () => {
    mocks.resolveCommitteesActor.mockResolvedValue({ ok: false, result: refusal });
    expect(await updateCommitteeAction("northern", null as never)).toEqual(refusal);
    expect(mocks.resolveCommitteesActor).toHaveBeenLastCalledWith("northern", { committeeId: undefined });
    noStoreCalls();
  });
});

describe("an invalid form returns BEFORE any store call, with the field's own message", () => {
  it("create: a missing name and an unknown kind", async () => {
    expect(await createCommitteeAction("northern", { name: " ", kind: "other", purpose: "", meetsWhen: "" })).toEqual({
      ok: false,
      error: "Name is required.",
      field: "name",
      kind: "invalid",
    });
    noStoreCalls();
  });

  it("update, add, change role, end and dissolve each validate", async () => {
    expect(await updateCommitteeAction("northern", { committeeId: CID, name: "x".repeat(201), kind: "required", purpose: "", meetsWhen: "" })).toMatchObject({ ok: false, field: "name" });
    expect(await addCommitteeSeatAction("northern", { committeeId: CID, personId: "nope", role: "member", startsOn: "2026-06-01", endsOn: "" })).toMatchObject({ ok: false, field: "personId" });
    expect(await addCommitteeSeatAction("northern", { committeeId: CID, personId: PID, role: "leader", startsOn: "2026-06-01", endsOn: "" })).toMatchObject({ ok: false, field: "role" });
    expect(await changeCommitteeSeatRoleAction("northern", { committeeId: CID, membershipId: MID, expectedRole: "member", newRole: "", effectiveOn: "2026-06-01" })).toMatchObject({ ok: false, field: "newRole" });
    expect(await endCommitteeSeatAction("northern", { committeeId: CID, membershipId: MID, endsOn: "2026-02-30" })).toMatchObject({ ok: false, field: "endsOn" });
    expect(await dissolveCommitteeAction("northern", { committeeId: CID, dissolvedOn: "2026-06-16" })).toMatchObject({
      ok: false,
      field: "dissolvedOn",
      error: "The dissolve date can't be in the future.",
    });
    noStoreCalls();
  });

  it("the server's own day is the validation env (dissolving today is allowed, tomorrow is not)", async () => {
    expect((await dissolveCommitteeAction("northern", { committeeId: CID, dissolvedOn: "2026-06-15" })).ok).toBe(true);
    expect((await dissolveCommitteeAction("northern", { committeeId: CID, dissolvedOn: "2026-06-16" })).ok).toBe(false);
  });
});

describe("the store receives the parsed input and the ids from the form", () => {
  it("create passes the cleaned values and the context the gate returned", async () => {
    const result = await createCommitteeAction("northern", { name: "  Ministry   Committee ", kind: "required", purpose: "", meetsWhen: " Mondays " });
    expect(mocks.createCommittee).toHaveBeenCalledWith(identity.ctx, { name: "Ministry Committee", kind: "required", purpose: null, meetsWhen: "Mondays" });
    expect(result).toEqual({ ok: true, data: { id: "result-id" } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/o/northern/admin/committees");
  });

  it("update, dissolve, add, change role and end pass the committee, the seat and the parsed values", async () => {
    await updateCommitteeAction("northern", { committeeId: CID, name: "A", kind: "standing", purpose: "p", meetsWhen: "" });
    expect(mocks.updateCommittee).toHaveBeenCalledWith(identity.ctx, CID, { name: "A", kind: "standing", purpose: "p", meetsWhen: null });

    await dissolveCommitteeAction("northern", { committeeId: CID, dissolvedOn: "2026-06-01" });
    expect(mocks.dissolveCommittee).toHaveBeenCalledWith(identity.ctx, CID, "2026-06-01");

    await addCommitteeSeatAction("northern", { committeeId: CID, personId: PID, role: "clerk", startsOn: "2026-06-01", endsOn: "2027-06-01" });
    expect(mocks.addCommitteeSeat).toHaveBeenCalledWith(identity.ctx, CID, { personId: PID, role: "clerk", startsOn: "2026-06-01", endsOn: "2027-06-01" });

    await changeCommitteeSeatRoleAction("northern", { committeeId: CID, membershipId: MID, expectedRole: "member", newRole: "chair", effectiveOn: "2026-06-10" });
    expect(mocks.changeCommitteeSeatRole).toHaveBeenCalledWith(identity.ctx, CID, MID, { expectedRole: "member", newRole: "chair", effectiveOn: "2026-06-10" });

    await endCommitteeSeatAction("northern", { committeeId: CID, membershipId: MID, endsOn: "" });
    expect(mocks.endCommitteeSeat).toHaveBeenCalledWith(identity.ctx, CID, MID, { endsOn: null });
  });

  it("a change-role form with no expectedRole reaches the store as an empty string, which is `stale` there", async () => {
    await changeCommitteeSeatRoleAction("northern", { committeeId: CID, membershipId: MID, newRole: "chair", effectiveOn: "2026-06-10" } as never);
    expect(mocks.changeCommitteeSeatRole).toHaveBeenCalledWith(identity.ctx, CID, MID, expect.objectContaining({ expectedRole: "" }));
  });
});

describe("the public listing switch", () => {
  it("passes a boolean through, and refuses anything else as tampered, writing nothing", async () => {
    await setCommitteeSeatPublicListedAction("northern", { committeeId: CID, membershipId: MID, publicListed: false });
    expect(mocks.setCommitteeSeatPublicListed).toHaveBeenCalledWith(identity.ctx, CID, MID, false);
    mocks.setCommitteeSeatPublicListed.mockClear();
    for (const bad of ["true", 1, null, undefined]) {
      expect(await setCommitteeSeatPublicListedAction("northern", { committeeId: CID, membershipId: MID, publicListed: bad as never }), String(bad)).toEqual({
        ok: false,
        error: REFUSAL.save_failed,
        kind: "invalid",
      });
    }
    expect(mocks.setCommitteeSeatPublicListed).not.toHaveBeenCalled();
  });
});

describe("a store outcome becomes one fixed copy string", () => {
  it("a refusal is never database text, and an unchanged result is ok", async () => {
    mocks.addCommitteeSeat.mockResolvedValue({ kind: "refused", reason: "overlap", detail: { personName: "Wren Halloway", committeeName: "Finance" } });
    expect(await addCommitteeSeatAction("northern", { committeeId: CID, personId: PID, role: "member", startsOn: "2026-06-01", endsOn: "" })).toEqual({
      ok: false,
      error: 'Wren Halloway already serves on Finance during those dates. Use "Change role", or end that term first.',
      kind: "overlap",
    });
    mocks.updateCommittee.mockResolvedValue({ kind: "ok", data: { id: CID, unchanged: true } });
    expect(await updateCommitteeAction("northern", { committeeId: CID, name: "A", kind: "standing", purpose: "", meetsWhen: "" })).toEqual({
      ok: true,
      data: { id: CID, unchanged: true },
    });
    mocks.endCommitteeSeat.mockResolvedValue({ kind: "invalid", field: "endsOn", message: "The end date can't be before the start date." });
    expect(await endCommitteeSeatAction("northern", { committeeId: CID, membershipId: MID, endsOn: "2026-06-01" })).toEqual({
      ok: false,
      error: "The end date can't be before the start date.",
      field: "endsOn",
      kind: "invalid",
    });
  });
});
