/**
 * Orchestration tests for `approveRollActionAction` / `denyRollActionAction`.
 * Mocked at the `@/lib/roll` boundary — SQL correctness (the pending-status
 * pre-check, the `presby_freeze_approved_roll_action` regression pin) is
 * proven by `roll.test.ts` against a real Postgres connection.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockApproveRollAction = vi.hoisted(() => vi.fn());
const mockDenyRollAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/roll", () => ({
  approveRollAction: (...args: unknown[]) => mockApproveRollAction(...args),
  denyRollAction: (...args: unknown[]) => mockDenyRollAction(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approveRollActionAction, denyRollActionAction } from "./actions";

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

afterEach(() => {
  vi.clearAllMocks();
});

describe("approveRollActionAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("passes resolved identity AND session.user.id (approver's users.id) to approveRollAction", async () => {
    mockApproveRollAction.mockResolvedValueOnce({ kind: "ok" });

    await approveRollActionAction("alder-creek", {
      rollActionId: "ra-1",
      minuteReference: "2026-06 §4",
    });

    expect(mockApproveRollAction).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-1",
      "ra-1",
      { minuteReference: "2026-06 §4" },
    );
  });

  it("forbidden → ok:false", async () => {
    mockApproveRollAction.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await approveRollActionAction("alder-creek", {
      rollActionId: "ra-1",
    });
    expect(result.ok).toBe(false);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("already_decided → ok:false, names the race", async () => {
    mockApproveRollAction.mockResolvedValueOnce({ kind: "already_decided" });
    const result = await approveRollActionAction("alder-creek", {
      rollActionId: "ra-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already decided/i);
    }
  });

  it("ok → revalidates pending worklist, members list, and directory", async () => {
    mockApproveRollAction.mockResolvedValueOnce({ kind: "ok" });
    const result = await approveRollActionAction("alder-creek", {
      rollActionId: "ra-1",
    });
    expect(result).toEqual({ ok: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/members/pending",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/members",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/directory");
  });
});

describe("denyRollActionAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("passes the reason through to denyRollAction", async () => {
    mockDenyRollAction.mockResolvedValueOnce({ kind: "ok" });

    await denyRollActionAction("alder-creek", {
      rollActionId: "ra-2",
      reason: "Duplicate entry",
    });

    expect(mockDenyRollAction).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "ra-2",
      { reason: "Duplicate entry" },
    );
  });

  it("not_found → ok:false", async () => {
    mockDenyRollAction.mockResolvedValueOnce({ kind: "not_found" });
    const result = await denyRollActionAction("alder-creek", {
      rollActionId: "ra-2",
      reason: "Duplicate entry",
    });
    expect(result.ok).toBe(false);
  });

  it("ok → revalidates the pending worklist", async () => {
    mockDenyRollAction.mockResolvedValueOnce({ kind: "ok" });
    const result = await denyRollActionAction("alder-creek", {
      rollActionId: "ra-2",
      reason: "Duplicate entry",
    });
    expect(result).toEqual({ ok: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/members/pending",
    );
  });
});
