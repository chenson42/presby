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
 *   2b. (Track F) The first argument is a SITE KEY bound on the server. It is
 *      re-resolved with `resolveSiteOrganization()` (host mode: Host === key),
 *      and the slug THE DATABASE returned - never the key itself - names the
 *      rate-limit bucket and the write. An unresolvable key is the generic
 *      "not accepting messages", spends no budget, and writes nothing.
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
const mockResolveSiteOrganization = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({
  submitSiteContactMessage: (...args: unknown[]) =>
    mockSubmitSiteContactMessage(...args),
  resolveSiteOrganization: (...args: unknown[]) => mockResolveSiteOrganization(...args),
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
  // Default: the key resolves to the organization whose slug is the key (slug mode).
  mockResolveSiteOrganization.mockImplementation(async (key: string) => ({
    kind: "ok",
    mode: "slug",
    slug: key,
    organizationId: "org-1",
    urls: {},
    redirectHost: null,
    row: {},
  }));
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

// ---------------------------------------------------------------------------
// Track F: the key is bound on the server and re-resolved
// ---------------------------------------------------------------------------

describe("submitContactMessageAction - the site key is re-resolved, and the DB slug is what counts", () => {
  const HOST = "church-one.invalid";

  function hostResolves(dbSlug = "alder-creek") {
    mockResolveSiteOrganization.mockImplementation(async (key: string) => ({
      kind: "ok",
      mode: "host",
      slug: dbSlug,
      organizationId: "org-1",
      urls: {},
      redirectHost: null,
      row: { requested: key },
    }));
  }

  it("a host key writes to the org the DATABASE resolved it to, with that slug's rate-limit bucket", async () => {
    hostResolves("alder-creek");

    const result = await submitContactMessageAction(HOST, contactFormData());

    expect(result).toEqual({ ok: true });
    expect(mockResolveSiteOrganization).toHaveBeenCalledWith(HOST);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "site_contact:alder-creek:203.0.113.7",
      expect.anything(),
      expect.anything(),
    );
    expect(mockSubmitSiteContactMessage).toHaveBeenCalledWith("alder-creek", expect.any(Object));
    // The host itself never reaches the write or the limiter key.
    expect(JSON.stringify(mockSubmitSiteContactMessage.mock.calls)).not.toContain(HOST);
    expect(JSON.stringify(mockCheckRateLimit.mock.calls)).not.toContain(HOST);
  });

  it("an unresolvable key (unknown host, wrong Host header, flag off) is the generic not-live: no budget spent, nothing written", async () => {
    mockResolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });

    const result = await submitContactMessageAction(HOST, contactFormData());

    expect(result).toEqual({ ok: false, error: "This site isn't accepting messages right now." });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockSubmitSiteContactMessage).not.toHaveBeenCalled();
  });

  it("answers an unresolvable key with exactly the text a suspended site gets from the query layer", async () => {
    mockResolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "host", slug: null });
    const unresolvable = await submitContactMessageAction(HOST, contactFormData());

    mockSubmitSiteContactMessage.mockResolvedValue({ kind: "not_live" });
    const suspended = await submitContactMessageAction("alder-creek", contactFormData());

    expect(unresolvable).toEqual(suspended);
  });

  it("a __slug field in the posted form changes nothing: only the bound key and the DB slug are used", async () => {
    hostResolves("alder-creek");
    const fd = contactFormData();
    fd.set("__slug", "someone-elses-church");

    await submitContactMessageAction(HOST, fd);

    expect(mockSubmitSiteContactMessage).toHaveBeenCalledWith("alder-creek", expect.any(Object));
    expect(JSON.stringify(mockSubmitSiteContactMessage.mock.calls)).not.toContain("someone-elses-church");
    expect(JSON.stringify(mockCheckRateLimit.mock.calls)).not.toContain("someone-elses-church");
  });

  it("does not resolve for a bot: the honeypot answers first and spends nothing", async () => {
    await submitContactMessageAction(HOST, contactFormData({ _hp: "bot" }));
    expect(mockResolveSiteOrganization).not.toHaveBeenCalled();
  });
});
