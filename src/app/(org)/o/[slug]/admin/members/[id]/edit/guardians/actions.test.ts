/**
 * Orchestration tests for the guardians sub-screen's Server Actions.
 * Mocked at the `@/lib/children` boundary — SQL correctness is proven by
 * `children.test.ts` against a real Postgres connection.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockAddGuardianLink = vi.hoisted(() => vi.fn());
const mockUpdateGuardianLink = vi.hoisted(() => vi.fn());
const mockRemoveGuardianLink = vi.hoisted(() => vi.fn());
const mockSearchLinkablePeople = vi.hoisted(() => vi.fn());
vi.mock("@/lib/children", () => ({
  addGuardianLink: (...args: unknown[]) => mockAddGuardianLink(...args),
  updateGuardianLink: (...args: unknown[]) => mockUpdateGuardianLink(...args),
  removeGuardianLink: (...args: unknown[]) => mockRemoveGuardianLink(...args),
  searchLinkablePeople: (...args: unknown[]) => mockSearchLinkablePeople(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addGuardianLinkAction,
  removeGuardianLinkAction,
  searchLinkablePeopleAction,
  updateGuardianLinkAction,
} from "./actions";

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

describe("addGuardianLinkAction", () => {
  const INPUT = {
    relatedName: "Aunt Wilhelmina",
    relationship: "caregiver" as const,
    isEmergencyContact: false,
  };

  it("not signed in returns an error without calling addGuardianLink", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await addGuardianLinkAction("alder-creek", "p-1", INPUT);
    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockAddGuardianLink).not.toHaveBeenCalled();
  });

  it("no org access returns an error without calling addGuardianLink", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await addGuardianLinkAction("alder-creek", "p-1", INPUT);
    expect(result.ok).toBe(false);
    expect(mockAddGuardianLink).not.toHaveBeenCalled();
  });

  describe("with a resolved session", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(SESSION);
      mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    });

    it("passes resolved personId/organizationId (not the client's own claims)", async () => {
      mockAddGuardianLink.mockResolvedValueOnce({ kind: "ok", linkId: "l-1" });
      await addGuardianLinkAction("alder-creek", "p-1", INPUT);
      expect(mockAddGuardianLink).toHaveBeenCalledWith(
        "person-1",
        "org-1",
        "p-1",
        INPUT,
      );
    });

    it("forbidden → ok:false, no revalidate", async () => {
      mockAddGuardianLink.mockResolvedValueOnce({ kind: "forbidden" });
      const result = await addGuardianLinkAction("alder-creek", "p-1", INPUT);
      expect(result.ok).toBe(false);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("not_found → ok:false", async () => {
      mockAddGuardianLink.mockResolvedValueOnce({ kind: "not_found" });
      const result = await addGuardianLinkAction("alder-creek", "p-1", INPUT);
      expect(result.ok).toBe(false);
    });

    it("invalid_input on relatedPersonId → a linking-specific message", async () => {
      mockAddGuardianLink.mockResolvedValueOnce({
        kind: "invalid_input",
        field: "relatedPersonId",
      });
      const result = await addGuardianLinkAction("alder-creek", "p-1", INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/already in this organization/i);
      }
    });

    it("invalid_input on notes → a human-readable, field-naming message", async () => {
      mockAddGuardianLink.mockResolvedValueOnce({
        kind: "invalid_input",
        field: "notes",
      });
      const result = await addGuardianLinkAction("alder-creek", "p-1", INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/too long/i);
      }
    });

    it("ok → returns linkId, revalidates the guardians page", async () => {
      mockAddGuardianLink.mockResolvedValueOnce({ kind: "ok", linkId: "l-1" });
      const result = await addGuardianLinkAction("alder-creek", "p-1", INPUT);
      expect(result).toEqual({ ok: true, data: { linkId: "l-1" } });
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/o/alder-creek/admin/members/p-1/edit/guardians",
      );
    });
  });
});

describe("updateGuardianLinkAction", () => {
  const INPUT = {
    relatedName: "Aunt Wilhelmina",
    relationship: "guardian" as const,
    isEmergencyContact: true,
  };

  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("not_found → ok:false", async () => {
    mockUpdateGuardianLink.mockResolvedValueOnce({ kind: "not_found" });
    const result = await updateGuardianLinkAction(
      "alder-creek",
      "p-1",
      "l-1",
      INPUT,
    );
    expect(result.ok).toBe(false);
  });

  it("ok → returns linkId and revalidates", async () => {
    mockUpdateGuardianLink.mockResolvedValueOnce({ kind: "ok", linkId: "l-1" });
    const result = await updateGuardianLinkAction(
      "alder-creek",
      "p-1",
      "l-1",
      INPUT,
    );
    expect(result).toEqual({ ok: true, data: { linkId: "l-1" } });
    expect(mockUpdateGuardianLink).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "p-1",
      "l-1",
      INPUT,
    );
  });
});

describe("removeGuardianLinkAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("forbidden → ok:false", async () => {
    mockRemoveGuardianLink.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await removeGuardianLinkAction("alder-creek", "p-1", "l-1");
    expect(result.ok).toBe(false);
  });

  it("ok → revalidates", async () => {
    mockRemoveGuardianLink.mockResolvedValueOnce({ kind: "ok" });
    const result = await removeGuardianLinkAction("alder-creek", "p-1", "l-1");
    expect(result).toEqual({ ok: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/members/p-1/edit/guardians",
    );
  });
});

describe("searchLinkablePeopleAction", () => {
  it("not signed in → ok:true with an empty list (never a forbidden-shaped error for a typeahead)", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await searchLinkablePeopleAction("alder-creek", "Iso");
    expect(result).toEqual({ ok: true, data: { people: [] } });
    expect(mockSearchLinkablePeople).not.toHaveBeenCalled();
  });

  it("forbidden from the module → ok:true with an empty list", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    mockSearchLinkablePeople.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await searchLinkablePeopleAction("alder-creek", "Iso");
    expect(result).toEqual({ ok: true, data: { people: [] } });
  });

  it("ok → returns the matched people", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
    mockSearchLinkablePeople.mockResolvedValueOnce({
      kind: "ok",
      people: [
        { personId: "adult-1", firstName: "Isolde", lastName: "S", preferredName: null },
      ],
    });
    const result = await searchLinkablePeopleAction("alder-creek", "Iso");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.people).toHaveLength(1);
    }
  });
});
