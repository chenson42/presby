/**
 * Orchestration tests for `matchPersonAction` / `createPersonAction`.
 * Mocked at the `@/lib/people` boundary — SQL correctness (F21's
 * `existing_member_elsewhere` catch-based gate, the composite-FK insert
 * ordering, the RLS regression) is proven by `people.test.ts` against a
 * real Postgres connection.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockMatchPerson = vi.hoisted(() => vi.fn());
const mockCreatePerson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/people", () => ({
  matchPerson: (...args: unknown[]) => mockMatchPerson(...args),
  createPerson: (...args: unknown[]) => mockCreatePerson(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPersonAction, matchPersonAction } from "./actions";

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

const CREATE_INPUT = {
  identity: {
    mode: "new" as const,
    firstName: "Nora",
    lastName: "Ashgrove",
  },
  contact: {},
  household: { mode: "none" as const },
  rollAction: {
    kind: "profession_of_faith" as const,
    effectiveDate: "2026-06-01",
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("matchPersonAction", () => {
  it("not signed in returns an error without calling matchPerson", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await matchPersonAction("alder-creek", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });
    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockMatchPerson).not.toHaveBeenCalled();
  });

  it("passes resolved personId/organizationId to matchPerson", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockMatchPerson.mockResolvedValueOnce({ kind: "ok", candidates: [] });

    await matchPersonAction("alder-creek", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });

    expect(mockMatchPerson).toHaveBeenCalledWith("person-1", "org-1", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });
  });

  it("forbidden → ok:false with a human message", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockMatchPerson.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await matchPersonAction("alder-creek", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });

    expect(result.ok).toBe(false);
  });

  it("ok → returns the candidates unmodified (minimal-disclosure passthrough)", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockMatchPerson.mockResolvedValueOnce({
      kind: "ok",
      candidates: [
        { personId: "p-1", displayName: "N. Ashgrove", confidence: "high" },
      ],
    });

    const result = await matchPersonAction("alder-creek", {
      firstName: "Nora",
      lastName: "Ashgrove",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        candidates: [
          { personId: "p-1", displayName: "N. Ashgrove", confidence: "high" },
        ],
      },
    });
  });
});

describe("createPersonAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("passes resolved personId/organizationId AND session.user.id to createPerson", async () => {
    mockCreatePerson.mockResolvedValueOnce({
      kind: "ok",
      personId: "p-1",
      rollActionId: "ra-1",
    });

    await createPersonAction("alder-creek", CREATE_INPUT);

    expect(mockCreatePerson).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-1",
      CREATE_INPUT,
    );
  });

  it("forbidden → ok:false, no revalidate", async () => {
    mockCreatePerson.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await createPersonAction("alder-creek", CREATE_INPUT);
    expect(result.ok).toBe(false);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("existing_member_elsewhere → ok:false with a human, non-technical message", async () => {
    mockCreatePerson.mockResolvedValueOnce({
      kind: "existing_member_elsewhere",
    });
    const result = await createPersonAction("alder-creek", CREATE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already belongs to another organization/i);
    }
  });

  it("invalid_household → ok:false", async () => {
    mockCreatePerson.mockResolvedValueOnce({ kind: "invalid_household" });
    const result = await createPersonAction("alder-creek", CREATE_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/household/i);
    }
  });

  it("ok → returns personId/rollActionId, revalidates members list and pending worklist", async () => {
    mockCreatePerson.mockResolvedValueOnce({
      kind: "ok",
      personId: "p-99",
      rollActionId: "ra-99",
    });

    const result = await createPersonAction("alder-creek", CREATE_INPUT);

    expect(result).toEqual({
      ok: true,
      data: { personId: "p-99", rollActionId: "ra-99" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/members",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/members/pending",
    );
  });
});
