/**
 * Orchestration tests for submitCongregationFeedbackAction.
 *
 * Mocked at the `@/lib/tickets` / `@/lib/rate-limit` boundary — the SQL
 * correctness of `submitFeedback()` is proven by `tickets.test.ts` against a
 * real Postgres connection. This file pins:
 *
 *   1. `organizationId`/`personId` come from a fresh `resolveOrgContext`.
 *   2. The rate-limit key is `congregation-feedback:${personId}` (Phase 3's
 *      exact key format), checked BEFORE `submitFeedback()` is ever called.
 *   3. A blocked rate limit never reaches the query layer.
 *   4. Every result kind maps to the correct `ActionResult` shape.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockSubmitFeedback = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tickets", () => ({
  submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args),
}));

const mockCheckRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitCongregationFeedbackAction } from "./actions";

const SESSION = {
  user: { id: "user-platform-id-1", email: "member@example.invalid" },
};

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

beforeEach(() => {
  mockAuth.mockResolvedValue(SESSION);
  mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("submitCongregationFeedbackAction", () => {
  it("not signed in returns an error without calling resolveOrgContext or the rate limiter", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await submitCongregationFeedbackAction("alder-creek", "The bulletin link is broken.");

    expect(result).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("a non-'ok' resolution returns an error without calling the rate limiter or submitFeedback", async () => {
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const result = await submitCongregationFeedbackAction("bramblewood", "x");

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
  });

  it("rate limit is checked with the personId-scoped key, BEFORE submitFeedback is called", async () => {
    mockSubmitFeedback.mockResolvedValueOnce({ kind: "ok", feedbackId: "fb-1" });

    await submitCongregationFeedbackAction("alder-creek", "The bulletin link is broken.");

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "congregation-feedback:person-1",
      { max: 5, windowSeconds: 3600 },
      expect.objectContaining({ userId: "user-platform-id-1" }),
    );
  });

  it("a blocked rate limit returns an error and never calls submitFeedback", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 120 });

    const result = await submitCongregationFeedbackAction("alder-creek", "x");

    expect(result).toEqual({
      ok: false,
      error: "Too many submissions — come back in a bit.",
    });
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
  });

  it("invalid_input → ok:false with the query layer's own error message", async () => {
    mockSubmitFeedback.mockResolvedValueOnce({
      kind: "invalid_input",
      error: "Say something first.",
    });

    const result = await submitCongregationFeedbackAction("alder-creek", "   ");

    expect(result).toEqual({ ok: false, error: "Say something first." });
  });

  it("ok → returns the feedbackId, passing resolved.org.personId/organizationId to submitFeedback", async () => {
    mockSubmitFeedback.mockResolvedValueOnce({ kind: "ok", feedbackId: "fb-1" });

    const result = await submitCongregationFeedbackAction(
      "alder-creek",
      "The bulletin link is broken.",
    );

    expect(result).toEqual({ ok: true, data: { feedbackId: "fb-1" } });
    expect(mockSubmitFeedback).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "The bulletin link is broken.",
    );
  });
});
