/**
 * Orchestration tests for issueStatisticsGrantAction / revokeStatisticsGrantAction
 * — mocked at the `@/lib/statistics-grants` / `@/lib/rate-limit` boundary,
 * same principle as `admin/officers/actions.test.ts`: SQL correctness is
 * proven by `statistics-grants.test.ts` against a real Postgres connection.
 * What this file pins is the CONTRACT this actions.ts layer owns:
 *
 *   1. `issueStatisticsGrantAction` checks an ORG-KEYED rate limit
 *      (`stats_grant_issue:<organizationId>`) BEFORE calling
 *      `issueStatisticsGrant` — the gap QA Phase 5 FAIL-1 named (Phase 1 +
 *      Phase 2's [BINDING] "issuance is separately limited per issuing org"
 *      ruling, dropped without notation in Phase 3).
 *   2. A blocked rate limit returns a fixed, friendly error string and never
 *      calls `issueStatisticsGrant`.
 *   3. `revokeStatisticsGrantAction`'s audit metadata carries
 *      `aboutOrgId`/`reportYear` (Phase 5 Advisory 2 — restored after being
 *      thinned to `{ organizationId, grantId }`).
 *
 * `@/lib/presbytery` is mocked wholesale (unused stubs) purely so importing
 * this `actions.ts` file — which also imports per-capita/statistics
 * functions from that module — never pulls in a real DB connection.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    STATISTICS_GRANT_ISSUED: "tenant.statistics_grant.issued",
    STATISTICS_GRANT_REVOKED: "tenant.statistics_grant.revoked",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockCheckRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockIssueStatisticsGrant = vi.hoisted(() => vi.fn());
const mockRevokeStatisticsGrant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/statistics-grants", () => ({
  issueStatisticsGrant: (...args: unknown[]) => mockIssueStatisticsGrant(...args),
  revokeStatisticsGrant: (...args: unknown[]) => mockRevokeStatisticsGrant(...args),
}));

vi.mock("@/lib/presbytery", () => ({
  generatePerCapitaRecords: vi.fn(),
  recordPerCapitaPayment: vi.fn(),
  setCongregationStatistics: vi.fn(),
  setPerCapitaRate: vi.fn(),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueStatisticsGrantAction, revokeStatisticsGrantAction } from "./actions";

const SLUG = "northern-reach";
const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PERSON_ID = "c0000000-0000-0000-0000-00000000000a";
const USER_ID = "e0000000-0000-0000-0000-0000000000f4";

const ISSUE_INPUT = {
  aboutOrgId: "66666666-6666-6666-6666-666666666666",
  reportYear: 2090,
  issuedToName: "Test Clerk",
  issuedToEmail: "clerk@marrowbone.example.invalid",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: USER_ID } });
  mockResolveOrgContext.mockResolvedValue({
    kind: "ok",
    org: { organizationId: ORG_ID, personId: PERSON_ID },
  });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockIssueStatisticsGrant.mockResolvedValue({
    kind: "ok",
    data: { id: "grant-uuid-1", expiresAt: "2027-01-01T00:00:00.000Z" },
  });
  mockRevokeStatisticsGrant.mockResolvedValue({
    kind: "ok",
    data: { id: "grant-uuid-1", aboutOrgId: ISSUE_INPUT.aboutOrgId, reportYear: 2090 },
  });
});

// ---------------------------------------------------------------------------
// issueStatisticsGrantAction — rate limiting (QA Phase 5 FAIL-1)
// ---------------------------------------------------------------------------

describe("issueStatisticsGrantAction — rate limiting — regression for QA Phase 5 FAIL-1 (no rate limit on issuance)", () => {
  it("checks a rate limit keyed on the ISSUING ORG before calling issueStatisticsGrant", async () => {
    await issueStatisticsGrantAction(SLUG, ISSUE_INPUT);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      `stats_grant_issue:${ORG_ID}`,
      { max: 30, windowSeconds: 3600 },
      expect.objectContaining({ userId: USER_ID, actor: ORG_ID }),
    );
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    expect(mockIssueStatisticsGrant).toHaveBeenCalledTimes(1);
  });

  it("the rate-limit key is the ORGANIZATION id, not the acting user id", async () => {
    await issueStatisticsGrantAction(SLUG, ISSUE_INPUT);

    const [key] = mockCheckRateLimit.mock.calls[0];
    expect(key).not.toContain(USER_ID);
    expect(key).toContain(ORG_ID);
  });

  it("blocked → a fixed, friendly error; never calls issueStatisticsGrant", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 125 });

    const result = await issueStatisticsGrantAction(SLUG, ISSUE_INPUT);

    expect(result).toEqual({
      ok: false,
      error: "Too many grants issued recently. Try again in 3 minutes.",
    });
    expect(mockIssueStatisticsGrant).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("blocked with exactly 60 seconds remaining uses singular 'minute'", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    const result = await issueStatisticsGrantAction(SLUG, ISSUE_INPUT);

    expect(result).toEqual({
      ok: false,
      error: "Too many grants issued recently. Try again in 1 minute.",
    });
  });

  it("allowed → proceeds to issueStatisticsGrant and records the audit event on success", async () => {
    const result = await issueStatisticsGrantAction(SLUG, ISSUE_INPUT);

    expect(result).toEqual({ ok: true, data: { id: "grant-uuid-1" } });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tenant.statistics_grant.issued" }),
    );
  });
});

// ---------------------------------------------------------------------------
// revokeStatisticsGrantAction — audit metadata (QA Phase 5 Advisory 2)
// ---------------------------------------------------------------------------

describe("revokeStatisticsGrantAction — audit metadata — regression for QA Phase 5 Advisory 2 (thinned metadata)", () => {
  it("includes aboutOrgId and reportYear in the audit metadata, not just organizationId/grantId", async () => {
    await revokeStatisticsGrantAction(SLUG, "grant-uuid-1");

    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.statistics_grant.revoked",
      resourceType: "statistics_submission_grants",
      resourceId: "grant-uuid-1",
      metadata: {
        organizationId: ORG_ID,
        aboutOrgId: ISSUE_INPUT.aboutOrgId,
        reportYear: 2090,
        grantId: "grant-uuid-1",
      },
    });
  });

  it("no rate limit on revocation — revocation is a closing act, not a volume-amplifying one", async () => {
    await revokeStatisticsGrantAction(SLUG, "grant-uuid-1");
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});
