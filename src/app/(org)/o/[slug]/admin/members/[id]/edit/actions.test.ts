/**
 * Orchestration tests for `updatePersonAction`. Mocked at the `@/lib/people`
 * boundary — SQL correctness is proven by `people-update.test.ts` against a
 * real Postgres connection.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockUpdatePerson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/people", () => ({
  updatePerson: (...args: unknown[]) => mockUpdatePerson(...args),
}));

const mockRecordRollAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/roll", () => ({
  recordRollAction: (...args: unknown[]) => mockRecordRollAction(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordRollActionAction, updatePersonAction } from "./actions";

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

const UPDATE_INPUT = {
  personId: "p-1",
  identity: { firstName: "Nora", lastName: "Ashgrove" },
  contact: {},
  household: { mode: "none" as const },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("updatePersonAction", () => {
  it("not signed in returns an error without calling updatePerson", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockUpdatePerson).not.toHaveBeenCalled();
  });

  it("no org access returns an error without calling updatePerson", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
    expect(result.ok).toBe(false);
    expect(mockUpdatePerson).not.toHaveBeenCalled();
  });

  describe("with a resolved session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(SESSION);
      mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    });

    it("passes resolved personId/organizationId to updatePerson (not the client's own claims)", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "ok" });
      await updatePersonAction("alder-creek", UPDATE_INPUT);
      expect(mockUpdatePerson).toHaveBeenCalledWith(
        "person-1",
        "org-1",
        UPDATE_INPUT,
      );
    });

    it("forbidden → ok:false, no revalidate", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "forbidden" });
      const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
      expect(result.ok).toBe(false);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("not_found → ok:false", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "not_found" });
      const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/could not be found/i);
      }
    });

    it("invalid_household → ok:false", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "invalid_household" });
      const result = await updatePersonAction("alder-creek", UPDATE_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/household/i);
      }
    });

    it("ok → returns personId, revalidates the members list and the person's directory page", async () => {
      mockUpdatePerson.mockResolvedValueOnce({ kind: "ok" });
      const result = await updatePersonAction("alder-creek", UPDATE_INPUT);

      expect(result).toEqual({ ok: true, data: { personId: "p-1" } });
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/o/alder-creek/admin/members",
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/o/alder-creek/directory/p-1",
      );
    });
  });
});

const ROLL_ACTION_INPUT = {
  personId: "p-1",
  kind: "restoration" as const,
  effectiveDate: "2026-06-01",
};

describe("recordRollActionAction", () => {
  it("not signed in returns an error without calling recordRollAction", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockRecordRollAction).not.toHaveBeenCalled();
  });

  it("no org access returns an error without calling recordRollAction", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
    expect(result.ok).toBe(false);
    expect(mockRecordRollAction).not.toHaveBeenCalled();
  });

  describe("with a resolved session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(SESSION);
      mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    });

    it("passes resolved personId/organizationId/actingUserId to recordRollAction (not the client's own claims)", async () => {
      mockRecordRollAction.mockResolvedValueOnce({ kind: "ok", rollActionId: "ra-1" });
      await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
      expect(mockRecordRollAction).toHaveBeenCalledWith(
        "person-1",
        "org-1",
        "user-1",
        ROLL_ACTION_INPUT,
      );
    });

    it("forbidden → ok:false, no revalidate", async () => {
      mockRecordRollAction.mockResolvedValueOnce({ kind: "forbidden" });
      const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
      expect(result.ok).toBe(false);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("not_found → ok:false", async () => {
      mockRecordRollAction.mockResolvedValueOnce({ kind: "not_found" });
      const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/could not be found/i);
      }
    });

    it("invalid_kind → ok:false", async () => {
      mockRecordRollAction.mockResolvedValueOnce({ kind: "invalid_kind" });
      const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/isn.t available/i);
      }
    });

    it("ok → returns rollActionId, revalidates the members list and the pending worklist", async () => {
      mockRecordRollAction.mockResolvedValueOnce({ kind: "ok", rollActionId: "ra-1" });
      const result = await recordRollActionAction("alder-creek", ROLL_ACTION_INPUT);

      expect(result).toEqual({ ok: true, data: { rollActionId: "ra-1" } });
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/o/alder-creek/admin/members",
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/o/alder-creek/admin/members/pending",
      );
    });
  });
});
