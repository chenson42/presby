vi.mock("server-only", () => ({}));

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { execute: (...args: unknown[]) => mockExecute(...args) } }));
vi.mock("@/lib/authz", () => ({ withOrgContext: vi.fn() }));

const mockConfig = vi.hoisted(() => vi.fn());
vi.mock("./public-config", () => ({ readPublicGivingConfig: (...a: unknown[]) => mockConfig(...a) }));

const mockCreateSession = vi.hoisted(() => vi.fn());
const mockConfigured = vi.hoisted(() => vi.fn());
vi.mock("./providers/stripe/client", () => ({
  createCheckoutSession: (...a: unknown[]) => mockCreateSession(...a),
  isStripeConfigured: () => mockConfigured(),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GIVE_MESSAGES } from "./giving-copy";
import type { ParsedGive } from "./give-input";
import { checkoutReturnUrls, startGiveSession, toIntentRow, type IntentRow } from "./give-session";
import { ProviderError } from "./providers/stripe/errors";

const INTENT = "5c1f0f6e-1111-4222-8333-444455556666";
const ACCOUNT = "acct_fixtureAAAAAAAA1";
const SESSION = "cs_test_fixtureSession0001";
const FUND = "d9100000-0000-0000-0000-0000000000a1";

const PARSED: ParsedGive = {
  amountCents: 5000,
  fundId: FUND,
  frequency: "once",
  coverFees: true,
  method: "card",
  idempotencyKey: "3b0f1c2e-5a4d-4c7e-9b1a-6d2f8e0a1c3d",
};

function row(overrides: Partial<IntentRow> = {}): IntentRow {
  return {
    outcome: "created",
    intentId: INTENT,
    externalAccountId: ACCOUNT,
    livemode: false,
    fundName: "General Fund",
    giftAmountCents: 5000,
    // The DATABASE's figures differ from anything the form could say, so a test can tell them apart.
    coveredCents: 175,
    totalCents: 5175,
    methods: ["card", "bank"],
    alreadyAttached: false,
    ...overrides,
  };
}

/** The SQL text of a drizzle `sql` template, with parameters as `?`. */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => (typeof c === "object" && c !== null && "value" in c ? ((c as { value: string[] }).value).join("") : "?"))
    .join("");
}

const calls = (fn: string) => mockExecute.mock.calls.filter(([q]) => sqlText(q).includes(fn));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
  mockConfigured.mockReturnValue(true);
  mockCreateSession.mockResolvedValue({ sessionId: SESSION, url: "https://checkout.stripe.com/c/pay/cs_test_fixtureSession0001" });
  mockExecute.mockImplementation(async (q: unknown) =>
    sqlText(q).includes("attach_session") ? { rows: [{ attached: true }] } : { rows: [] },
  );
  mockConfig.mockResolvedValue({ state: "live", funds: [{ id: FUND, name: "General Fund" }], cardEnabled: true, achEnabled: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.unstubAllEnvs());

const start = (create: () => Promise<IntentRow>, parsed: ParsedGive = PARSED, surface: "public" | "member" = "public") =>
  startGiveSession({ surface, slug: "alder-creek", parsed, create });

describe("startGiveSession — the happy path", () => {
  it("creates the session from the DATABASE's figures, attaches it, and returns the checkout URL", async () => {
    const result = await start(async () => row());
    expect(result).toEqual({ kind: "checkout", url: "https://checkout.stripe.com/c/pay/cs_test_fixtureSession0001" });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    const input = mockCreateSession.mock.calls[0]![0];
    expect(input).toMatchObject({
      accountId: ACCOUNT,
      mode: "payment",
      totalCents: 5175,
      coveredFeeCents: 175,
      fundDisplayName: "General Fund",
      methods: ["card", "bank"],
      intentId: INTENT,
      idempotencyKey: `giving-session:${INTENT}`,
    });
    expect(input.expiresAt).toBeInstanceOf(Date);
    expect(calls("attach_session")).toHaveLength(1);
    expect(calls("fail_intent")).toHaveLength(0);
  });

  it("a monthly gift is a subscription-mode session", async () => {
    await start(async () => row(), { ...PARSED, frequency: "monthly" });
    expect(mockCreateSession.mock.calls[0]![0].mode).toBe("subscription");
  });

  it("the return URLs come from the configured origin and the slug only", async () => {
    await start(async () => row());
    const input = mockCreateSession.mock.calls[0]![0];
    expect(input.successUrl).toBe("https://app.example.invalid/site/alder-creek/give/return?session_id={CHECKOUT_SESSION_ID}");
    expect(input.cancelUrl).toBe("https://app.example.invalid/site/alder-creek/give");
  });

  it("the member surface returns to the member pages", async () => {
    await start(async () => row(), PARSED, "member");
    const input = mockCreateSession.mock.calls[0]![0];
    expect(input.successUrl).toBe("https://app.example.invalid/o/alder-creek/giving/give/return?session_id={CHECKOUT_SESSION_ID}");
    expect(input.cancelUrl).toBe("https://app.example.invalid/o/alder-creek/giving/give");
  });
});

describe("startGiveSession - where the donor returns (Track F, R5, DECISION-181)", () => {
  const HOST = "church-one.invalid";
  /** `db.execute` answers donorOrigin()'s serving-host read with this row (or throws). */
  function serving(host: string | null | Error) {
    mockExecute.mockImplementation(async (q: unknown) => {
      const text = sqlText(q);
      if (text.includes("serving_host")) {
        if (host instanceof Error) throw host;
        return { rows: [{ serving_host: host }] };
      }
      return text.includes("attach_session") ? { rows: [{ attached: true }] } : { rows: [] };
    });
  }

  it("a PUBLIC donor returns to the organization's serving custom host, at clean paths", async () => {
    serving(HOST);
    await start(async () => row());
    const input = mockCreateSession.mock.calls[0]![0];
    expect(input.successUrl).toBe(`https://${HOST}/give/return?session_id={CHECKOUT_SESSION_ID}`);
    expect(input.cancelUrl).toBe(`https://${HOST}/give`);
  });

  it("no serving host (none, or not serving) -> the platform's slug URL, exactly as before", async () => {
    serving(null);
    await start(async () => row());
    expect(mockCreateSession.mock.calls[0]![0].successUrl).toBe(
      "https://app.example.invalid/site/alder-creek/give/return?session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("a database error reading the serving host falls back to the platform origin and logs the slug only", async () => {
    serving(new Error("Failed query: select serving_host ... params: alder-creek"));
    const result = await start(async () => row());
    expect(result.kind).toBe("checkout");
    expect(mockCreateSession.mock.calls[0]![0].successUrl).toContain("https://app.example.invalid/site/alder-creek/give/return");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/Failed query|select serving_host/);
  });

  it("a malformed serving host is ignored, never used as an origin", async () => {
    serving("evil.invalid/path?x=1#");
    await start(async () => row());
    expect(JSON.stringify(mockCreateSession.mock.calls[0]![0])).not.toContain("evil");
  });

  it("the MEMBER surface always returns to the platform, even when a custom host is serving (members give on the platform)", async () => {
    serving(HOST);
    await start(async () => row(), PARSED, "member");
    const input = mockCreateSession.mock.calls[0]![0];
    expect(input.successUrl).toBe("https://app.example.invalid/o/alder-creek/giving/give/return?session_id={CHECKOUT_SESSION_ID}");
    expect(JSON.stringify(input)).not.toContain(HOST);
    // The member path never even asks.
    expect(calls("serving_host")).toHaveLength(0);
  });

  it("production without an https platform origin is still `unavailable` when no custom host serves, but a serving host works", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    serving(null);
    expect(await start(async () => row())).toEqual({ kind: "unavailable" });
    expect(calls("fail_intent")).toHaveLength(1);

    // The serving host is itself a safe origin (it comes from the database row), so it carries the donor.
    serving(HOST);
    const withHost = await start(async () => row());
    expect(withHost.kind).toBe("checkout");
    expect(mockCreateSession.mock.calls.at(-1)![0].successUrl).toContain(`https://${HOST}/give/return`);
  });
});

describe("checkoutReturnUrls", () => {
  it("builds the platform form with slugSitePath and the custom-host form with clean paths", () => {
    expect(checkoutReturnUrls("https://app.example.invalid", "alder-creek", "public")).toEqual({
      successUrl: "https://app.example.invalid/site/alder-creek/give/return?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.example.invalid/site/alder-creek/give",
    });
    expect(checkoutReturnUrls("https://church-one.invalid", "alder-creek", "public", true)).toEqual({
      successUrl: "https://church-one.invalid/give/return?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://church-one.invalid/give",
    });
    // The member surface has no custom-host form: the flag is ignored there.
    expect(checkoutReturnUrls("https://app.example.invalid", "alder-creek", "member", true).cancelUrl).toBe(
      "https://app.example.invalid/o/alder-creek/giving/give",
    );
  });

  it("leaves Stripe's placeholder literal (braces unencoded) and nothing user-controlled in the URL", () => {
    const { successUrl, cancelUrl } = checkoutReturnUrls("https://app.example.invalid", "alder-creek", "public");
    expect(successUrl).toContain("{CHECKOUT_SESSION_ID}");
    expect(successUrl).not.toContain("%7B");
    expect(new URL(cancelUrl).origin).toBe("https://app.example.invalid");
  });
});

describe("startGiveSession — the unavailable paths record a failed intent", () => {
  it("Stripe not configured: fail_intent, `unavailable`, and no Stripe call", async () => {
    mockConfigured.mockReturnValue(false);
    expect(await start(async () => row())).toEqual({ kind: "unavailable" });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(calls("fail_intent")).toHaveLength(1);
    expect(calls("attach_session")).toHaveLength(0);
  });

  it("no safe public origin (production, NEXT_PUBLIC_APP_URL unset): fail_intent, `unavailable`", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(await start(async () => row())).toEqual({ kind: "unavailable" });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(calls("fail_intent")).toHaveLength(1);
  });

  it("production with an http origin is also unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://app.example.invalid");
    expect(await start(async () => row())).toEqual({ kind: "unavailable" });
  });

  it("the database's own `unavailable` is `unavailable`, and nothing is failed or called", async () => {
    expect(await start(async () => row({ outcome: "unavailable", intentId: null }))).toEqual({ kind: "unavailable" });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("an unrecognized outcome reads as `unavailable`, never a guess", () => {
    expect(toIntentRow({ outcome: "brand_new" }).outcome).toBe("unavailable");
    expect(toIntentRow(undefined).outcome).toBe("unavailable");
  });
});

describe("startGiveSession — Stripe failures", () => {
  it("a Stripe error fails the intent and answers `error`; the log has the intent id and a code, no message", async () => {
    mockCreateSession.mockRejectedValue(new ProviderError("network", { requestId: "req_secret" }));
    expect(await start(async () => row())).toEqual({ kind: "error" });
    expect(calls("fail_intent")).toHaveLength(1);
    expect(calls("attach_session")).toHaveLength(0);
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).toContain(INTENT);
    expect(logged).toContain("network");
    expect(logged).not.toContain("req_secret");
  });

  it("an unexpected throw is still just `error`", async () => {
    mockCreateSession.mockRejectedValue(new TypeError("kaboom"));
    expect(await start(async () => row())).toEqual({ kind: "error" });
    expect(calls("fail_intent")).toHaveLength(1);
  });

  it("the database throwing while creating the intent is `error`", async () => {
    expect(
      await start(async () => {
        throw new Error("db down");
      }),
    ).toEqual({ kind: "error" });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("a fail_intent that itself throws never changes the answer", async () => {
    mockCreateSession.mockRejectedValue(new ProviderError("stripe_error"));
    mockExecute.mockRejectedValue(new Error("db down"));
    expect(await start(async () => row())).toEqual({ kind: "error" });
  });

  it("a created row missing the account or fund name cannot reach Stripe: it is failed and `error`", async () => {
    expect(await start(async () => row({ externalAccountId: null }))).toEqual({ kind: "error" });
    expect(await start(async () => row({ fundName: null }))).toEqual({ kind: "error" });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});

describe("startGiveSession — repeat submits (the same idempotency key)", () => {
  it("an existing intent whose session is attached is `already_started`, with no second Stripe call", async () => {
    expect(await start(async () => row({ outcome: "existing", methods: null, alreadyAttached: true }))).toEqual({
      kind: "already_started",
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("an existing intent with no session continues; the methods come from the org's enabled set", async () => {
    mockConfig.mockResolvedValue({ state: "live", funds: [], cardEnabled: true, achEnabled: false });
    const result = await start(async () => row({ outcome: "existing", methods: null }), { ...PARSED, method: "either", coverFees: false });
    expect(result.kind).toBe("checkout");
    expect(mockCreateSession.mock.calls[0]![0].methods).toEqual(["card"]);
    expect(mockCreateSession.mock.calls[0]![0].totalCents).toBe(5175);
  });

  it("an existing intent whose requested method is no longer enabled is `unavailable` and failed", async () => {
    mockConfig.mockResolvedValue({ state: "live", funds: [], cardEnabled: true, achEnabled: false });
    const result = await start(async () => row({ outcome: "existing", methods: null }), { ...PARSED, method: "bank", coverFees: false });
    expect(result).toEqual({ kind: "unavailable" });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(calls("fail_intent")).toHaveLength(1);
  });

  it("losing the attach race to a concurrent submit of the same key still returns the (identical) session URL", async () => {
    mockExecute.mockImplementation(async (q: unknown) =>
      sqlText(q).includes("attach_session") ? { rows: [{ attached: false }] } : { rows: [] },
    );
    let n = 0;
    const result = await start(async () => (n++ === 0 ? row() : row({ outcome: "existing", methods: null, alreadyAttached: true })));
    expect(result).toEqual({ kind: "checkout", url: "https://checkout.stripe.com/c/pay/cs_test_fixtureSession0001" });
  });

  it("an attach refused because the intent is no longer `created` is `error`, never a URL for a dead intent", async () => {
    mockExecute.mockImplementation(async (q: unknown) =>
      sqlText(q).includes("attach_session") ? { rows: [{ attached: false }] } : { rows: [] },
    );
    const result = await start(async () => row({ outcome: "existing", methods: null, alreadyAttached: false }));
    expect(result).toEqual({ kind: "error" });
  });
});

describe("startGiveSession — the database's refusals", () => {
  it("rate_limited (the per-organization flood cap) carries a wait, and Stripe is not called", async () => {
    const result = await start(async () => row({ outcome: "rate_limited", intentId: null }));
    expect(result).toMatchObject({ kind: "rate_limited" });
    expect((result as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("`invalid` names the retired fund when the fund is no longer offered", async () => {
    mockConfig.mockResolvedValue({ state: "live", funds: [{ id: "other", name: "Other" }], cardEnabled: true, achEnabled: true });
    expect(await start(async () => row({ outcome: "invalid", intentId: null }))).toEqual({
      kind: "invalid",
      field: "fund",
      message: GIVE_MESSAGES.fundUnavailable,
    });
  });

  it("`invalid` names the method when the chosen method is not enabled", async () => {
    mockConfig.mockResolvedValue({ state: "live", funds: [{ id: FUND, name: "G" }], cardEnabled: true, achEnabled: false });
    expect(await start(async () => row({ outcome: "invalid", intentId: null }), { ...PARSED, method: "bank", coverFees: false })).toEqual({
      kind: "invalid",
      field: "method",
      message: GIVE_MESSAGES.methodUnavailable,
    });
  });

  it("`invalid` for anything else is a generic form error; for an org that went offline it is `unavailable`", async () => {
    expect(await start(async () => row({ outcome: "invalid", intentId: null }))).toMatchObject({ kind: "invalid", field: "form" });
    mockConfig.mockResolvedValue({ state: "unavailable" });
    expect(await start(async () => row({ outcome: "invalid", intentId: null }))).toEqual({ kind: "unavailable" });
  });
});
