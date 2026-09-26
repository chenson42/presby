/**
 * Orchestration tests for withdrawFilingAction — mocked at the
 * `@/lib/filings` / `@/lib/authz` / `@/lib/flags` boundary, same principle as
 * `admin/reports/actions.test.ts`: SQL correctness is proven by
 * `filings.test.ts` against a real Postgres connection. What this file pins
 * is the CONTRACT this actions.ts layer owns:
 *
 *   1. The auth -> resolveOrgContext -> assertOrgAccess -> flag -> org-type
 *      -> zod -> withdrawFiling gate order, and that each gate short-circuits
 *      before the next (a flag-off org never reaches withdrawFiling(), a
 *      wrong-org-type org never reaches withdrawFiling(), invalid input never
 *      reaches withdrawFiling()).
 *   2. `withdrawnBy`/`actingUserId` is ALWAYS `identity.userId` — the
 *      session's own resolved user id — and NEVER a value read off `input`,
 *      even if a caller stuffs an extra key onto the object shaped like one.
 *   3. The `FilingsResult.kind` -> `ActionResult` copy mapping (all five
 *      non-ok kinds), matching Phase 3's refusal-copy table verbatim.
 *   4. The audit metadata shape: BOTH organization ids
 *      (`organizationId`/`recipientOrgId`), `aboutOrgId` (== organizationId,
 *      never a second read), `reportYear`, `publicationId`.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
const mockAssertOrgAccess = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const MockOrgAccessError = vi.hoisted(() => class MockOrgAccessError extends Error {});
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
  assertOrgAccess: (...args: unknown[]) => mockAssertOrgAccess(...args),
  OrgAccessError: MockOrgAccessError,
}));

const mockIsFlagEnabled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args),
}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    STATISTICS_RETURN_WITHDRAWN: "tenant.statistics_return.withdrawn",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockWithdrawFiling = vi.hoisted(() => vi.fn());
vi.mock("@/lib/filings", () => ({
  withdrawFiling: (...args: unknown[]) => mockWithdrawFiling(...args),
  MINUTE_REFERENCE_MAX: 500,
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { withdrawFilingAction } from "./actions";

const SLUG = "alder-creek";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const RECIPIENT_ORG_ID = "11111111-1111-1111-1111-111111111111";
const PERSON_ID = "c0000000-0000-0000-0000-000000000002";
const USER_ID = "e0000000-0000-0000-0000-0000000000f3";
const PUBLICATION_ID = "a9000000-0000-0000-0000-000000000009";

const VALID_INPUT = {
  publicationId: PUBLICATION_ID,
  minuteReference: "Session stated meeting, 2026-02-10, item 4",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: USER_ID } });
  mockResolveOrgContext.mockResolvedValue({
    kind: "ok",
    org: {
      organizationId: ORG_ID,
      personId: PERSON_ID,
      organizationType: "congregation",
    },
  });
  mockAssertOrgAccess.mockResolvedValue(undefined);
  mockIsFlagEnabled.mockResolvedValue(true);
  mockWithdrawFiling.mockResolvedValue({
    kind: "ok",
    data: { id: PUBLICATION_ID, recipientOrgId: RECIPIENT_ORG_ID, reportYear: 2025 },
  });
});

// ---------------------------------------------------------------------------
// Gate order — auth / org access / flag / org-type / zod
// ---------------------------------------------------------------------------

describe("withdrawFilingAction — gate order", () => {
  it("unauthenticated: never calls resolveOrgContext or withdrawFiling", async () => {
    mockAuth.mockResolvedValue(null);

    const result = await withdrawFilingAction(SLUG, VALID_INPUT);

    expect(result).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockWithdrawFiling).not.toHaveBeenCalled();
  });

  it("resolveOrgContext not ok: never calls withdrawFiling", async () => {
    mockResolveOrgContext.mockResolvedValue({ kind: "not-found" });

    const result = await withdrawFilingAction(SLUG, VALID_INPUT);

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockWithdrawFiling).not.toHaveBeenCalled();
  });

  it("assertOrgAccess throws OrgAccessError: a friendly error, never calls withdrawFiling", async () => {
    mockAssertOrgAccess.mockRejectedValue(new MockOrgAccessError("gone"));

    const result = await withdrawFilingAction(SLUG, VALID_INPUT);

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockWithdrawFiling).not.toHaveBeenCalled();
  });

  it("flag off: never calls withdrawFiling", async () => {
    mockIsFlagEnabled.mockResolvedValue(false);

    const result = await withdrawFilingAction(SLUG, VALID_INPUT);

    expect(result).toEqual({
      ok: false,
      error: "Statistical filings aren't turned on for this organization.",
    });
    expect(mockWithdrawFiling).not.toHaveBeenCalled();
  });

  it("checks the org_portal.filings flag key specifically", async () => {
    await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(mockIsFlagEnabled).toHaveBeenCalledWith("org_portal.filings");
  });

  it("wrong org type (presbytery): never calls withdrawFiling", async () => {
    mockResolveOrgContext.mockResolvedValue({
      kind: "ok",
      org: { organizationId: ORG_ID, personId: PERSON_ID, organizationType: "presbytery" },
    });

    const result = await withdrawFilingAction(SLUG, VALID_INPUT);

    expect(result).toEqual({
      ok: false,
      error: "Statistical filings aren't available for this organization.",
    });
    expect(mockWithdrawFiling).not.toHaveBeenCalled();
  });

  it("invalid publicationId (not a uuid): never calls withdrawFiling", async () => {
    const result = await withdrawFilingAction(SLUG, {
      publicationId: "not-a-uuid",
      minuteReference: "Session minute",
    });

    expect(result.ok).toBe(false);
    expect(mockWithdrawFiling).not.toHaveBeenCalled();
  });

  it("blank minute reference: never calls withdrawFiling", async () => {
    const result = await withdrawFilingAction(SLUG, {
      publicationId: PUBLICATION_ID,
      minuteReference: "   ",
    });

    expect(result.ok).toBe(false);
    expect(mockWithdrawFiling).not.toHaveBeenCalled();
  });

  it("over-length minute reference: never calls withdrawFiling", async () => {
    const result = await withdrawFilingAction(SLUG, {
      publicationId: PUBLICATION_ID,
      minuteReference: "x".repeat(501),
    });

    expect(result.ok).toBe(false);
    expect(mockWithdrawFiling).not.toHaveBeenCalled();
  });

  it("all gates pass: calls withdrawFiling exactly once", async () => {
    await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(mockWithdrawFiling).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// withdrawnBy / actingUserId — never a client-suppliable field
// ---------------------------------------------------------------------------

describe("withdrawFilingAction — withdrawnBy is bound server-side, never from input", () => {
  it("passes identity.userId (the SESSION's own user id) as actingUserId, positionally, regardless of what the input object carries", async () => {
    // A caller that stuffs an extra, identity-shaped key onto the input —
    // exactly the shape a hand-crafted client request could attempt. The
    // action's own type signature (`{ publicationId, minuteReference }`) has
    // no field for it, and zod's schema strips unknown keys by default, but
    // this test proves the RUNTIME property too: even if the extra key
    // somehow reached this far, withdrawFiling() is called with FOUR
    // positional arguments, and the third is always identity.userId.
    const maliciousInput = {
      ...VALID_INPUT,
      withdrawnBy: "e0000000-0000-0000-0000-000000000000",
      actingUserId: "e0000000-0000-0000-0000-000000000000",
    } as typeof VALID_INPUT;

    await withdrawFilingAction(SLUG, maliciousInput);

    expect(mockWithdrawFiling).toHaveBeenCalledWith(
      PERSON_ID,
      ORG_ID,
      USER_ID, // identity.userId from the mocked session — not the attacker's value
      PUBLICATION_ID,
      VALID_INPUT.minuteReference,
    );
  });

  it("a different signed-in user resolves to a different actingUserId — the value tracks the SESSION, not a fixed constant", async () => {
    mockAuth.mockResolvedValue({ user: { id: "e0000000-0000-0000-0000-000000000099" } });

    await withdrawFilingAction(SLUG, VALID_INPUT);

    expect(mockWithdrawFiling).toHaveBeenCalledWith(
      PERSON_ID,
      ORG_ID,
      "e0000000-0000-0000-0000-000000000099",
      PUBLICATION_ID,
      VALID_INPUT.minuteReference,
    );
  });
});

// ---------------------------------------------------------------------------
// FilingsResult.kind -> ActionResult copy mapping (Phase 3's refusal table)
// ---------------------------------------------------------------------------

describe("withdrawFilingAction — refusal copy mapping", () => {
  it("forbidden", async () => {
    mockWithdrawFiling.mockResolvedValue({ kind: "forbidden" });
    const result = await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to withdraw filings here.",
    });
  });

  it("invalid_target — the ONE uniform literal's user-facing copy", async () => {
    mockWithdrawFiling.mockResolvedValue({ kind: "invalid_target" });
    const result = await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(result).toEqual({
      ok: false,
      error: "That filing can't be withdrawn. Refresh the page and try again.",
    });
  });

  it("invalid_input — passes the lib's own message through verbatim", async () => {
    mockWithdrawFiling.mockResolvedValue({
      kind: "invalid_input",
      message: "Minute reference must be 1–500 characters.",
    });
    const result = await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(result).toEqual({
      ok: false,
      error: "Minute reference must be 1–500 characters.",
    });
  });

  it("already_withdrawn", async () => {
    mockWithdrawFiling.mockResolvedValue({ kind: "already_withdrawn" });
    const result = await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(result).toEqual({
      ok: false,
      error: "This filing has already been withdrawn.",
    });
  });

  it("superseded", async () => {
    mockWithdrawFiling.mockResolvedValue({ kind: "superseded" });
    const result = await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(result).toEqual({
      ok: false,
      error: "A newer filing supersedes this one — only the current filing can be withdrawn.",
    });
  });

  it("the five non-ok kinds each produce a DIFFERENT error string", async () => {
    const kinds = [
      { kind: "forbidden" },
      { kind: "invalid_target" },
      { kind: "invalid_input", message: "bad" },
      { kind: "already_withdrawn" },
      { kind: "superseded" },
    ] as const;

    const errors = new Set<string>();
    for (const k of kinds) {
      mockWithdrawFiling.mockResolvedValue(k);
      const result = await withdrawFilingAction(SLUG, VALID_INPUT);
      if (!result.ok) errors.add(result.error);
    }
    expect(errors.size).toBe(kinds.length);
  });
});

// ---------------------------------------------------------------------------
// Success — audit metadata shape, revalidation, return value
// ---------------------------------------------------------------------------

describe("withdrawFilingAction — success", () => {
  it("returns ok with the withdrawn publication's id", async () => {
    const result = await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(result).toEqual({ ok: true, data: { id: PUBLICATION_ID } });
  });

  it("records the audit event with BOTH organization ids, aboutOrgId, reportYear, and publicationId", async () => {
    await withdrawFilingAction(SLUG, VALID_INPUT);

    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.statistics_return.withdrawn",
      resourceType: "publications",
      resourceId: PUBLICATION_ID,
      metadata: {
        organizationId: ORG_ID,
        recipientOrgId: RECIPIENT_ORG_ID,
        aboutOrgId: ORG_ID,
        reportYear: 2025,
        publicationId: PUBLICATION_ID,
      },
    });
  });

  it("never records an audit event on any non-ok outcome", async () => {
    mockWithdrawFiling.mockResolvedValue({ kind: "already_withdrawn" });
    await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("revalidates the filings page for this slug", async () => {
    await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/o/${SLUG}/admin/filings`);
  });

  it("never revalidates on a non-ok outcome", async () => {
    mockWithdrawFiling.mockResolvedValue({ kind: "invalid_target" });
    await withdrawFilingAction(SLUG, VALID_INPUT);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
