/**
 * Orchestration tests for the four pending-queue server actions
 * (`approveRollActionAction`, `approveRollActionsAction`, `denyRollActionAction`,
 * `withdrawRollActionAction`; docs/work-log/2026-10-22-founding-admin-directory.md,
 * Increment 2). Mocked at the `@/lib/roll` boundary: SQL correctness (the
 * definer functions, the in-transaction audit, the freeze) is proven by
 * `roll.test.ts` and `session-approval.db.test.ts` against a real Postgres.
 *
 * What these tests own: the action re-resolves the session and the org and
 * NEVER takes the organization, the acting person or the decision from the
 * client; ids are UUID-checked before the lib is called; every typed refusal
 * maps through ONE copy table (and a runtime test walks the closed
 * vocabularies, so a code without copy fails here as well as at the type
 * level); the right paths revalidate.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockApproveRollAction = vi.hoisted(() => vi.fn());
const mockApproveRollActions = vi.hoisted(() => vi.fn());
const mockDenyRollAction = vi.hoisted(() => vi.fn());
const mockWithdrawRollAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/roll", () => ({
  approveRollAction: (...args: unknown[]) => mockApproveRollAction(...args),
  approveRollActions: (...args: unknown[]) => mockApproveRollActions(...args),
  denyRollAction: (...args: unknown[]) => mockDenyRollAction(...args),
  withdrawRollAction: (...args: unknown[]) => mockWithdrawRollAction(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveRollActionAction,
  approveRollActionsAction,
  denyRollActionAction,
  withdrawRollActionAction,
} from "./actions";
import {
  BULK_COPY,
  DECISION_COPY,
  WITHDRAW_COPY,
} from "./decision-copy";
import {
  ROLL_DECISION_REFUSALS,
  ROLL_WITHDRAW_REFUSALS,
} from "@/lib/roll-action-kinds";

const SESSION = { user: { id: "user-1", email: "clerk@example.invalid" } };
const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};

const RA_1 = "11111111-1111-4111-8111-111111111111";
const RA_2 = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";
const TODAY = new Date().toISOString().slice(0, 10);

function okApproval(overrides: Record<string, unknown> = {}) {
  return {
    kind: "ok" as const,
    rollActionId: RA_1,
    personId: PERSON,
    rollKind: "profession_of_faith" as const,
    effectiveDate: "2026-01-04",
    affectsFiledPeriod: false,
    shadowedBy: null,
    selfApproved: false,
    selfTarget: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  mockAuth.mockResolvedValue(SESSION);
  mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
});

describe("identity (all four actions)", () => {
  it("no session -> ok:false, the lib is never called", async () => {
    mockAuth.mockResolvedValue(null);
    const results = await Promise.all([
      approveRollActionAction("alder-creek", { rollActionId: RA_1 }),
      approveRollActionsAction("alder-creek", { rollActionIds: [RA_1] }),
      denyRollActionAction("alder-creek", { rollActionId: RA_1, reason: "x" }),
      withdrawRollActionAction("alder-creek", { rollActionId: RA_1, reason: "x" }),
    ]);
    for (const r of results) expect(r.ok).toBe(false);
    expect(mockApproveRollAction).not.toHaveBeenCalled();
    expect(mockApproveRollActions).not.toHaveBeenCalled();
    expect(mockDenyRollAction).not.toHaveBeenCalled();
    expect(mockWithdrawRollAction).not.toHaveBeenCalled();
  });

  it("a slug the user cannot enter -> ok:false, the lib is never called", async () => {
    mockResolveOrgContext.mockResolvedValue({ kind: "forbidden" });
    const results = await Promise.all([
      approveRollActionAction("elsewhere", { rollActionId: RA_1 }),
      approveRollActionsAction("elsewhere", { rollActionIds: [RA_1] }),
      denyRollActionAction("elsewhere", { rollActionId: RA_1, reason: "x" }),
      withdrawRollActionAction("elsewhere", { rollActionId: RA_1, reason: "x" }),
    ]);
    for (const r of results) expect(r.ok).toBe(false);
    expect(mockApproveRollAction).not.toHaveBeenCalled();
  });
});

describe("approveRollActionAction", () => {
  it("passes the RESOLVED org and person and session.user.id (the approver's users.id), never a client value", async () => {
    mockApproveRollAction.mockResolvedValueOnce(okApproval());

    await approveRollActionAction("alder-creek", {
      rollActionId: RA_1,
      minuteReference: "2026-06 §4",
      // A forged payload: none of these may reach the lib.
      ...({
        organizationId: "other-org",
        personId: "other-person",
        decision: "deny",
        approvedBy: "someone-else",
      } as object),
    });

    expect(mockApproveRollAction).toHaveBeenCalledTimes(1);
    expect(mockApproveRollAction).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-1",
      RA_1,
      { minuteReference: "2026-06 §4" },
      { actingUserEmail: "clerk@example.invalid" },
    );
  });

  it("a malformed id is not_found copy and the lib is never called", async () => {
    const result = await approveRollActionAction("alder-creek", {
      rollActionId: "ra-1; drop table roll_actions",
    });
    expect(result).toEqual({ ok: false, error: DECISION_COPY.not_found });
    expect(mockApproveRollAction).not.toHaveBeenCalled();
  });

  it("forbidden -> the forbidden copy, nothing revalidated", async () => {
    mockApproveRollAction.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await approveRollActionAction("alder-creek", { rollActionId: RA_1 });
    expect(result).toEqual({ ok: false, error: DECISION_COPY.forbidden });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("every decide refusal maps to its own copy (none falls through to a generic string)", async () => {
    for (const reason of ROLL_DECISION_REFUSALS) {
      mockApproveRollAction.mockResolvedValueOnce({ kind: "refused", reason });
      const result = await approveRollActionAction("alder-creek", { rollActionId: RA_1 });
      expect(result).toEqual({ ok: false, error: DECISION_COPY[reason] });
      expect(DECISION_COPY[reason].length).toBeGreaterThan(10);
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("ok -> returns the effective date, the warnings and selfApproved, and revalidates queue, community, directory and the person's edit page", async () => {
    mockApproveRollAction.mockResolvedValueOnce(
      okApproval({
        effectiveDate: "2999-01-01",
        affectsFiledPeriod: true,
        shadowedBy: { kind: "reaffirmation", effectiveDate: "3000-01-01" },
        selfApproved: true,
      }),
    );
    const result = await approveRollActionAction("alder-creek", { rollActionId: RA_1 });
    expect(result).toEqual({
      ok: true,
      data: {
        rollActionId: RA_1,
        effectiveDate: "2999-01-01",
        futureDated: true,
        affectsFiledPeriod: true,
        shadowed: { kind: "reaffirmation", effectiveDate: "3000-01-01" },
        selfApproved: true,
      },
    });
    for (const path of [
      "/o/alder-creek/admin/community/pending",
      "/o/alder-creek/admin/community",
      "/o/alder-creek/directory",
      `/o/alder-creek/admin/community/${PERSON}/edit`,
    ]) {
      expect(mockRevalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("a date of today is not future-dated", async () => {
    mockApproveRollAction.mockResolvedValueOnce(okApproval({ effectiveDate: TODAY }));
    const result = await approveRollActionAction("alder-creek", { rollActionId: RA_1 });
    expect(result.ok && result.data?.futureDated).toBe(false);
  });
});

describe("approveRollActionsAction (bulk)", () => {
  it("passes the ids and the one minute reference with the resolved identity", async () => {
    mockApproveRollActions.mockResolvedValueOnce({
      kind: "ok",
      results: [
        { rollActionId: RA_1, result: okApproval() },
        { rollActionId: RA_2, result: okApproval({ rollActionId: RA_2 }) },
      ],
      approved: 2,
      needAttention: 0,
    });
    const result = await approveRollActionsAction("alder-creek", {
      rollActionIds: [RA_1, RA_2],
      minuteReference: "2026-06 §4",
    });
    expect(mockApproveRollActions).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-1",
      { rollActionIds: [RA_1, RA_2], minuteReference: "2026-06 §4" },
      { actingUserEmail: "clerk@example.invalid" },
    );
    expect(result).toEqual({
      ok: true,
      data: { approved: 2, failed: [], affectsFiledPeriod: false, shadowedCount: 0 },
    });
  });

  it("partial failure is ok:true with each failed row and its own reason", async () => {
    mockApproveRollActions.mockResolvedValueOnce({
      kind: "ok",
      results: [
        { rollActionId: RA_1, result: okApproval({ affectsFiledPeriod: true }) },
        { rollActionId: RA_2, result: { kind: "refused", reason: "already_decided" } },
      ],
      approved: 1,
      needAttention: 1,
    });
    const result = await approveRollActionsAction("alder-creek", {
      rollActionIds: [RA_1, RA_2],
    });
    expect(result).toEqual({
      ok: true,
      data: {
        approved: 1,
        failed: [{ rollActionId: RA_2, error: DECISION_COPY.already_decided }],
        affectsFiledPeriod: true,
        shadowedCount: 0,
      },
    });
  });

  it("counts shadowed approvals", async () => {
    const shadowed = { kind: "reaffirmation" as const, effectiveDate: "2030-01-01" };
    mockApproveRollActions.mockResolvedValueOnce({
      kind: "ok",
      results: [
        { rollActionId: RA_1, result: okApproval({ shadowedBy: shadowed }) },
        { rollActionId: RA_2, result: okApproval({ rollActionId: RA_2 }) },
      ],
      approved: 2,
      needAttention: 0,
    });
    const result = await approveRollActionsAction("alder-creek", {
      rollActionIds: [RA_1, RA_2],
    });
    expect(result.ok && result.data?.shadowedCount).toBe(1);
  });

  it("empty, too_many and forbidden map to their own copy and revalidate nothing", async () => {
    mockApproveRollActions.mockResolvedValueOnce({ kind: "empty" });
    expect(
      await approveRollActionsAction("alder-creek", { rollActionIds: [] }),
    ).toEqual({ ok: false, error: BULK_COPY.empty });
    mockApproveRollActions.mockResolvedValueOnce({ kind: "too_many" });
    expect(
      await approveRollActionsAction("alder-creek", { rollActionIds: [RA_1] }),
    ).toEqual({ ok: false, error: BULK_COPY.tooMany });
    mockApproveRollActions.mockResolvedValueOnce({ kind: "forbidden" });
    expect(
      await approveRollActionsAction("alder-creek", { rollActionIds: [RA_1] }),
    ).toEqual({ ok: false, error: DECISION_COPY.forbidden });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("a non-array payload is the empty refusal and never reaches the lib", async () => {
    const result = await approveRollActionsAction("alder-creek", {
      rollActionIds: "not-an-array" as unknown as string[],
    });
    expect(result).toEqual({ ok: false, error: BULK_COPY.empty });
    expect(mockApproveRollActions).not.toHaveBeenCalled();
  });
});

describe("denyRollActionAction", () => {
  it("passes the reason with the resolved identity and the session user id", async () => {
    mockDenyRollAction.mockResolvedValueOnce({
      kind: "ok",
      rollActionId: RA_2,
      personId: PERSON,
    });

    await denyRollActionAction("alder-creek", {
      rollActionId: RA_2,
      reason: "Duplicate entry",
    });

    expect(mockDenyRollAction).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-1",
      RA_2,
      { reason: "Duplicate entry" },
      { actingUserEmail: "clerk@example.invalid" },
    );
  });

  it("a malformed id is not_found copy and the lib is never called", async () => {
    const result = await denyRollActionAction("alder-creek", {
      rollActionId: "nope",
      reason: "x",
    });
    expect(result).toEqual({ ok: false, error: DECISION_COPY.not_found });
    expect(mockDenyRollAction).not.toHaveBeenCalled();
  });

  it("a non-string reason reaches the lib as empty, so reason_required decides", async () => {
    mockDenyRollAction.mockResolvedValueOnce({ kind: "refused", reason: "reason_required" });
    const result = await denyRollActionAction("alder-creek", {
      rollActionId: RA_2,
      reason: 42 as unknown as string,
    });
    expect(mockDenyRollAction.mock.calls[0]![4]).toEqual({ reason: "" });
    expect(result).toEqual({ ok: false, error: DECISION_COPY.reason_required });
  });

  it("every decide refusal and forbidden map to copy", async () => {
    mockDenyRollAction.mockResolvedValueOnce({ kind: "forbidden" });
    expect(
      await denyRollActionAction("alder-creek", { rollActionId: RA_2, reason: "x" }),
    ).toEqual({ ok: false, error: DECISION_COPY.forbidden });
    for (const reason of ROLL_DECISION_REFUSALS) {
      mockDenyRollAction.mockResolvedValueOnce({ kind: "refused", reason });
      expect(
        await denyRollActionAction("alder-creek", { rollActionId: RA_2, reason: "x" }),
      ).toEqual({ ok: false, error: DECISION_COPY[reason] });
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("ok -> revalidates the queue, the list and the person's edit page", async () => {
    mockDenyRollAction.mockResolvedValueOnce({
      kind: "ok",
      rollActionId: RA_2,
      personId: PERSON,
    });
    const result = await denyRollActionAction("alder-creek", {
      rollActionId: RA_2,
      reason: "Duplicate entry",
    });
    expect(result).toEqual({ ok: true, data: { rollActionId: RA_2 } });
    for (const path of [
      "/o/alder-creek/admin/community/pending",
      "/o/alder-creek/admin/community",
      `/o/alder-creek/admin/community/${PERSON}/edit`,
    ]) {
      expect(mockRevalidatePath).toHaveBeenCalledWith(path);
    }
  });
});

describe("withdrawRollActionAction", () => {
  it("passes the reason with the resolved identity and the session user id", async () => {
    mockWithdrawRollAction.mockResolvedValueOnce({
      kind: "ok",
      rollActionId: RA_1,
      personId: PERSON,
      selfProposed: true,
    });
    const result = await withdrawRollActionAction("alder-creek", {
      rollActionId: RA_1,
      reason: "Entered in error",
    });
    expect(mockWithdrawRollAction).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-1",
      RA_1,
      { reason: "Entered in error" },
      { actingUserEmail: "clerk@example.invalid" },
    );
    expect(result).toEqual({ ok: true, data: { rollActionId: RA_1 } });
    for (const path of [
      "/o/alder-creek/admin/community/pending",
      "/o/alder-creek/admin/community",
      `/o/alder-creek/admin/community/${PERSON}/edit`,
    ]) {
      expect(mockRevalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("a malformed id is the withdraw not_found copy and the lib is never called", async () => {
    const result = await withdrawRollActionAction("alder-creek", {
      rollActionId: "../etc",
      reason: "x",
    });
    expect(result).toEqual({ ok: false, error: WITHDRAW_COPY.not_found });
    expect(mockWithdrawRollAction).not.toHaveBeenCalled();
  });

  it("forbidden and every withdraw refusal map to the WITHDRAW copy", async () => {
    mockWithdrawRollAction.mockResolvedValueOnce({ kind: "forbidden" });
    expect(
      await withdrawRollActionAction("alder-creek", { rollActionId: RA_1, reason: "x" }),
    ).toEqual({ ok: false, error: WITHDRAW_COPY.forbidden });
    for (const reason of ROLL_WITHDRAW_REFUSALS) {
      mockWithdrawRollAction.mockResolvedValueOnce({ kind: "refused", reason });
      expect(
        await withdrawRollActionAction("alder-creek", { rollActionId: RA_1, reason: "x" }),
      ).toEqual({ ok: false, error: WITHDRAW_COPY[reason] });
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("copy tables", () => {
  it("DECISION_COPY covers every decide refusal plus forbidden, WITHDRAW_COPY every withdraw refusal plus forbidden", () => {
    expect(Object.keys(DECISION_COPY).sort()).toEqual(
      [...ROLL_DECISION_REFUSALS, "forbidden"].sort(),
    );
    expect(Object.keys(WITHDRAW_COPY).sort()).toEqual(
      [...ROLL_WITHDRAW_REFUSALS, "forbidden"].sort(),
    );
  });

  it("active_elsewhere never names another organization and points to a support ticket", () => {
    expect(DECISION_COPY.active_elsewhere).toMatch(/support ticket/i);
    expect(DECISION_COPY.active_elsewhere).not.toMatch(/another (congregation|organization)|elsewhere/i);
  });
});
