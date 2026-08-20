/**
 * Orchestration tests for submitContactMessageAction — the one anonymous
 * write path in the public-sites feature. Mocked at the `@/lib/sites` /
 * `@/lib/rate-limit` / `@/lib/request-ip` boundary — SQL correctness is
 * proven by sites.test.ts against a real Postgres connection. What this file
 * pins is the CONTRACT this actions.ts layer owns and nothing else does:
 *
 *   1. The honeypot field short-circuits to a FAKE ok:true — no rate-limit
 *      consumption, no submitSiteContactMessage call at all.
 *   2. The rate limit is IP-and-slug-keyed and checked before
 *      submitSiteContactMessage is ever called.
 *   3. Every result kind maps to the correct ActionResult shape.
 *   4. No audit event anywhere in this file (an anonymous, low-stakes
 *      submission is not a security-sensitive mutation).
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

const mockSubmitSiteContactMessage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({
  submitSiteContactMessage: (...args: unknown[]) =>
    mockSubmitSiteContactMessage(...args),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitContactMessageAction } from "./actions";

function contactFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("name", fields.name ?? "Marisol Enweazu");
  fd.set("email", fields.email ?? "marisol@example.invalid");
  fd.set("body", fields.body ?? "What time is the Sunday service?");
  fd.set("_hp", fields._hp ?? "");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue(new Headers({ "x-real-ip": "203.0.113.7" }));
  mockGetRequestIp.mockReturnValue("203.0.113.7");
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockSubmitSiteContactMessage.mockResolvedValue({ kind: "ok" });
});

// ---------------------------------------------------------------------------
// Honeypot
// ---------------------------------------------------------------------------

describe("submitContactMessageAction — honeypot", () => {
  it("a filled honeypot returns a fake ok:true without checking the rate limit or writing", async () => {
    const result = await submitContactMessageAction(
      "alder-creek",
      contactFormData({ _hp: "I am a bot" }),
    );

    expect(result).toEqual({ ok: true });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockSubmitSiteContactMessage).not.toHaveBeenCalled();
  });

  it("a whitespace-only honeypot trims to empty and is NOT treated as filled", async () => {
    const result = await submitContactMessageAction(
      "alder-creek",
      contactFormData({ _hp: "   " }),
    );

    expect(result).toEqual({ ok: true });
    expect(mockSubmitSiteContactMessage).toHaveBeenCalled();
  });

  it("an empty honeypot proceeds to the rate limit check", async () => {
    await submitContactMessageAction("alder-creek", contactFormData());
    expect(mockCheckRateLimit).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

describe("submitContactMessageAction — rate limiting", () => {
  it("keys the rate limit by slug and IP, checked before submitSiteContactMessage", async () => {
    await submitContactMessageAction("alder-creek", contactFormData());

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "site_contact:alder-creek:203.0.113.7",
      { max: 5, windowSeconds: 3600 },
      expect.objectContaining({ userId: null, actor: "203.0.113.7" }),
    );
  });

  it("falls back to 'unknown' in the rate-limit key when no IP is resolvable", async () => {
    mockGetRequestIp.mockReturnValue(null);

    await submitContactMessageAction("alder-creek", contactFormData());

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "site_contact:alder-creek:unknown",
      expect.anything(),
      expect.objectContaining({ actor: "unknown" }),
    );
  });

  it("blocked → a friendly error, never calls submitSiteContactMessage", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 125 });

    const result = await submitContactMessageAction("alder-creek", contactFormData());

    expect(result).toEqual({
      ok: false,
      error: "Too many messages sent. Try again in 3 minutes.",
    });
    expect(mockSubmitSiteContactMessage).not.toHaveBeenCalled();
  });

  it("blocked with exactly 60 seconds remaining uses singular 'minute'", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    const result = await submitContactMessageAction("alder-creek", contactFormData());

    expect(result).toEqual({
      ok: false,
      error: "Too many messages sent. Try again in 1 minute.",
    });
  });
});

// ---------------------------------------------------------------------------
// Result mapping
// ---------------------------------------------------------------------------

describe("submitContactMessageAction — result mapping", () => {
  it("passes slug and the trimmed-by-the-query-layer form fields through", async () => {
    await submitContactMessageAction(
      "alder-creek",
      contactFormData({ name: "Marisol", email: "marisol@example.invalid", body: "Hi!" }),
    );

    expect(mockSubmitSiteContactMessage).toHaveBeenCalledWith("alder-creek", {
      name: "Marisol",
      email: "marisol@example.invalid",
      body: "Hi!",
    });
  });

  it("not_live → a client-visible error", async () => {
    mockSubmitSiteContactMessage.mockResolvedValue({ kind: "not_live" });

    const result = await submitContactMessageAction("alder-creek", contactFormData());

    expect(result).toEqual({
      ok: false,
      error: "This site isn't accepting messages right now.",
    });
  });

  it("invalid_input → forwards the query layer's own error string", async () => {
    mockSubmitSiteContactMessage.mockResolvedValue({
      kind: "invalid_input",
      error: "Enter a valid email address.",
    });

    const result = await submitContactMessageAction("alder-creek", contactFormData());

    expect(result).toEqual({ ok: false, error: "Enter a valid email address." });
  });

  it("ok → ok:true, no audit event anywhere in this file", async () => {
    const result = await submitContactMessageAction("alder-creek", contactFormData());
    expect(result).toEqual({ ok: true });
  });
});
