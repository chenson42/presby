/**
 * Orchestration tests for submitGrantedReturnAction — the platform's first
 * unauthenticated write path (D16 / DECISION-147,
 * `docs/work-log/2026-09-25-submission-grants.md`). Mocked at the
 * `@/lib/statistics-grants` / `@/lib/rate-limit` / `@/lib/request-ip` /
 * `@/lib/audit` boundary, same shape as `(public)/site/[slug]/actions.test.ts`
 * — SQL correctness is proven by `statistics-grants.test.ts` against a real
 * Postgres connection. What this file pins is the CONTRACT this actions.ts
 * layer owns and nothing else does:
 *
 *   1. The rate limit is IP-keyed (never token-keyed) and checked before
 *      `submitStatisticsGrant` is ever called.
 *   2. `attestedRole: "other"` collapses to a single `"other: <text>"`
 *      string before reaching the query layer; every other role passes
 *      through unchanged.
 *   3. Every failure kind — `"invalid"` and `"invalid_input"` — maps to a
 *      FIXED, byte-identical error string, regardless of which underlying
 *      cause produced it, and neither path calls `recordAudit` or
 *      `redirect`.
 *   4. On success, EXACTLY ONE audit event fires — the no-session actor-
 *      override shape (`{ userId: null, email }`), never the raw token or
 *      its hash anywhere in `metadata` — and the action redirects to the
 *      static confirmation page.
 */

vi.mock("server-only", () => ({}));

const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));

const mockGetRequestIp = vi.hoisted(() => vi.fn());
vi.mock("@/lib/request-ip", () => ({
  getRequestIp: (...args: unknown[]) => mockGetRequestIp(...args),
}));

const mockCheckRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockSubmitStatisticsGrant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/statistics-grants", () => ({
  submitStatisticsGrant: (...args: unknown[]) => mockSubmitStatisticsGrant(...args),
}));

const mockRecordAudit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { STATISTICS_GRANT_SUBMITTED: "tenant.statistics_grant.submitted" },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitGrantedReturnAction } from "./actions";

const BASE_INPUT = {
  token: "raw-token-abc",
  payload: { ending_active: 42 },
  attestedByName: "Jane Clerk",
  attestedRole: "clerk_of_session" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue(new Headers({ "x-real-ip": "203.0.113.7" }));
  mockGetRequestIp.mockReturnValue("203.0.113.7");
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockSubmitStatisticsGrant.mockResolvedValue({
    kind: "ok",
    returnId: "return-uuid-1",
    auditFacts: {
      organizationId: "org-uuid-1",
      aboutOrgId: "about-org-uuid-1",
      reportYear: 2026,
      issuedToEmail: "clerk@quillhaven.example.invalid",
    },
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("submitGrantedReturnAction — rate limiting", () => {
  it("keys the rate limit by IP, never by token", async () => {
    await expect(submitGrantedReturnAction(BASE_INPUT)).rejects.toThrow("REDIRECT:");

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "stats_submit:203.0.113.7",
      { max: 10, windowSeconds: 3600 },
      expect.objectContaining({ userId: null, actor: "203.0.113.7" }),
    );
  });

  it("falls back to 'unknown' in the rate-limit key when no IP is resolvable", async () => {
    mockGetRequestIp.mockReturnValue(null);

    await expect(submitGrantedReturnAction(BASE_INPUT)).rejects.toThrow("REDIRECT:");

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "stats_submit:unknown",
      expect.anything(),
      expect.objectContaining({ actor: "unknown" }),
    );
  });

  it("blocked → a friendly error, never calls submitStatisticsGrant", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 125 });

    const result = await submitGrantedReturnAction(BASE_INPUT);

    expect(result).toEqual({
      ok: false,
      error: "Too many attempts. Try again in 3 minutes.",
    });
    expect(mockSubmitStatisticsGrant).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("blocked with exactly 60 seconds remaining uses singular 'minute'", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    const result = await submitGrantedReturnAction(BASE_INPUT);

    expect(result).toEqual({
      ok: false,
      error: "Too many attempts. Try again in 1 minute.",
    });
  });
});

// ---------------------------------------------------------------------------
// attestedRole collapse
// ---------------------------------------------------------------------------

describe("submitGrantedReturnAction — attestedRole collapse", () => {
  it("passes clerk_of_session through unchanged", async () => {
    await expect(
      submitGrantedReturnAction({ ...BASE_INPUT, attestedRole: "clerk_of_session" }),
    ).rejects.toThrow("REDIRECT:");

    expect(mockSubmitStatisticsGrant).toHaveBeenCalledWith(
      BASE_INPUT.token,
      BASE_INPUT.payload,
      BASE_INPUT.attestedByName,
      "clerk_of_session",
    );
  });

  it("passes moderator through unchanged", async () => {
    await expect(
      submitGrantedReturnAction({ ...BASE_INPUT, attestedRole: "moderator" }),
    ).rejects.toThrow("REDIRECT:");

    expect(mockSubmitStatisticsGrant).toHaveBeenCalledWith(
      BASE_INPUT.token,
      BASE_INPUT.payload,
      BASE_INPUT.attestedByName,
      "moderator",
    );
  });

  it("collapses 'other' + attestedRoleOther into a single 'other: <text>' string", async () => {
    await expect(
      submitGrantedReturnAction({
        ...BASE_INPUT,
        attestedRole: "other",
        attestedRoleOther: "Session treasurer",
      }),
    ).rejects.toThrow("REDIRECT:");

    expect(mockSubmitStatisticsGrant).toHaveBeenCalledWith(
      BASE_INPUT.token,
      BASE_INPUT.payload,
      BASE_INPUT.attestedByName,
      "other: Session treasurer",
    );
  });

  it("trims attestedRoleOther before collapsing", async () => {
    await expect(
      submitGrantedReturnAction({
        ...BASE_INPUT,
        attestedRole: "other",
        attestedRoleOther: "  Session treasurer  ",
      }),
    ).rejects.toThrow("REDIRECT:");

    expect(mockSubmitStatisticsGrant).toHaveBeenCalledWith(
      BASE_INPUT.token,
      BASE_INPUT.payload,
      BASE_INPUT.attestedByName,
      "other: Session treasurer",
    );
  });

  it("collapses to 'other: ' when attestedRoleOther is omitted — never crashes", async () => {
    await expect(
      submitGrantedReturnAction({ ...BASE_INPUT, attestedRole: "other" }),
    ).rejects.toThrow("REDIRECT:");

    expect(mockSubmitStatisticsGrant).toHaveBeenCalledWith(
      BASE_INPUT.token,
      BASE_INPUT.payload,
      BASE_INPUT.attestedByName,
      "other: ",
    );
  });
});

// ---------------------------------------------------------------------------
// Failure collapse — the enumeration-safety property this file owns
// ---------------------------------------------------------------------------

describe("submitGrantedReturnAction — failure collapse", () => {
  const FAILURE_CASES: Array<{
    name: string;
    grantResult: { kind: "invalid" } | { kind: "invalid_input"; message: string };
    expectedError: string;
  }> = [
    {
      name: "no such token",
      grantResult: { kind: "invalid" },
      expectedError:
        "This link is no longer active. If you still need to file, ask the presbytery for a new link.",
    },
    {
      name: "expired/revoked/already-submitted/stale-affiliation/flag-off/DB-failure (same bucket)",
      grantResult: { kind: "invalid" },
      expectedError:
        "This link is no longer active. If you still need to file, ask the presbytery for a new link.",
    },
    {
      name: "field-level rejection",
      grantResult: {
        kind: "invalid_input",
        message: "some SQL-layer message that must never reach the browser",
      },
      expectedError:
        "Some entries could not be saved — check the highlighted fields and try again.",
    },
  ];

  it.each(FAILURE_CASES)(
    "$name → { ok: false, error: <fixed string> }, no audit, no redirect",
    async ({ grantResult, expectedError }) => {
      mockSubmitStatisticsGrant.mockResolvedValue(grantResult);

      const result = await submitGrantedReturnAction(BASE_INPUT);

      expect(result).toEqual({ ok: false, error: expectedError });
      expect(mockRecordAudit).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );

  it("the action's OWN error string never includes the query layer's underlying message — invalid_input", async () => {
    mockSubmitStatisticsGrant.mockResolvedValue({
      kind: "invalid_input",
      message: "presby_write_return_publication_chain: some raw SQL detail",
    });

    const result = await submitGrantedReturnAction(BASE_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("presby_write_return_publication_chain");
    }
  });

  it("every failure kind produces the SAME number of mocked calls (one submitStatisticsGrant call, zero audit, zero redirect) — no branch is measurably cheaper", async () => {
    for (const { grantResult } of FAILURE_CASES) {
      vi.clearAllMocks();
      mockCheckRateLimit.mockResolvedValue({ allowed: true });
      mockSubmitStatisticsGrant.mockResolvedValue(grantResult);

      await submitGrantedReturnAction(BASE_INPUT);

      expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
      expect(mockSubmitStatisticsGrant).toHaveBeenCalledTimes(1);
      expect(mockRecordAudit).toHaveBeenCalledTimes(0);
      expect(mockRedirect).toHaveBeenCalledTimes(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Success — the audit write and the redirect
// ---------------------------------------------------------------------------

describe("submitGrantedReturnAction — success", () => {
  it("records exactly one audit event with the no-session actor-override shape and redirects", async () => {
    await expect(submitGrantedReturnAction(BASE_INPUT)).rejects.toThrow(
      "REDIRECT:/file-statistics/submitted",
    );

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.statistics_grant.submitted",
      actor: { userId: null, email: "clerk@quillhaven.example.invalid" },
      resourceType: "statistical_returns",
      resourceId: "return-uuid-1",
      metadata: {
        organizationId: "org-uuid-1",
        aboutOrgId: "about-org-uuid-1",
        reportYear: 2026,
        returnId: "return-uuid-1",
      },
    });
  });

  it("never places the raw token or a token hash anywhere in the audit call", async () => {
    await expect(submitGrantedReturnAction(BASE_INPUT)).rejects.toThrow("REDIRECT:");

    const [[auditCall]] = mockRecordAudit.mock.calls;
    const serialized = JSON.stringify(auditCall);
    expect(serialized).not.toContain(BASE_INPUT.token);
  });

  it("degrades to a null actor email and null metadata fields when auditFacts could not be resolved — never crashes", async () => {
    mockSubmitStatisticsGrant.mockResolvedValue({
      kind: "ok",
      returnId: "return-uuid-2",
      auditFacts: null,
    });

    await expect(submitGrantedReturnAction(BASE_INPUT)).rejects.toThrow("REDIRECT:");

    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.statistics_grant.submitted",
      actor: { userId: null, email: null },
      resourceType: "statistical_returns",
      resourceId: "return-uuid-2",
      metadata: {
        organizationId: null,
        aboutOrgId: null,
        reportYear: null,
        returnId: "return-uuid-2",
      },
    });
  });
});
