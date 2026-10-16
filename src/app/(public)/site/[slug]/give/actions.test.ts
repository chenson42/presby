/**
 * Orchestration tests for createPublicGiveSessionAction - the anonymous way a
 * visitor starts a gift (docs/work-log/2026-10-15-online-giving.md, Batch 4a).
 * Mocked at the EDGES only (request headers, the limiter, Turnstile, the
 * database, the Stripe allowlist): the action, `parseGiveForm` and
 * `startGiveSession` all run for real, so what these pin is the contract the
 * three layers make together:
 *
 *   1. the honeypot answers a fake `unavailable` and spends no budget;
 *   2. the three rate-limit keys, in order, each only if the one before allowed it;
 *   3. Turnstile, then the amount parse, then the database, then Stripe;
 *   4. every `GiveResult` arm;
 *   5. `Host` / `X-Forwarded-Host` cannot change where Stripe sends the donor back to.
 */
vi.mock("server-only", () => ({}));

const callLog = vi.hoisted(() => ({ entries: [] as string[] }));

const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockTurnstile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: (...args: unknown[]) => mockTurnstile(...args),
}));

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { execute: (...args: unknown[]) => mockExecute(...args) } }));
vi.mock("@/lib/authz", () => ({ withOrgContext: vi.fn() }));

const mockCreateSession = vi.hoisted(() => vi.fn());
const mockConfigured = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/providers/stripe/client", () => ({
  createCheckoutSession: (...a: unknown[]) => mockCreateSession(...a),
  isStripeConfigured: () => mockConfigured(),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GIVE_MESSAGES } from "@/lib/giving/giving-copy";
import { createPublicGiveSessionAction } from "./actions";

const FUND = "d9100000-0000-0000-0000-0000000000a1";
const KEY = "3b0f1c2e-5a4d-4c7e-9b1a-6d2f8e0a1c3d";
const INTENT = "5c1f0f6e-1111-4222-8333-444455556666";
const SESSION = "cs_test_fixtureSession0001";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_fixtureSession0001";

function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => (typeof c === "object" && c !== null && "value" in c ? (c as { value: string[] }).value.join("") : "?"))
    .join("");
}

/** Every bound parameter of a drizzle `sql` template. */
function sqlParams(query: unknown): unknown[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks.filter((c) => !(typeof c === "object" && c !== null && "value" in c && Array.isArray((c as { value: unknown }).value)));
}

function giveForm(fields: Record<string, string | undefined> = {}): FormData {
  const base: Record<string, string | undefined> = {
    amount: "50",
    fundId: FUND,
    frequency: "once",
    method: "card",
    idempotencyKey: KEY,
    _hp: "",
    ...fields,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(base)) if (v !== undefined) fd.set(k, v);
  return fd;
}

type IntentRowFixture = Record<string, unknown>;
const createdRow = (overrides: IntentRowFixture = {}): IntentRowFixture => ({
  outcome: "created",
  intent_id: INTENT,
  external_account_id: "acct_fixtureAAAAAAAA1",
  livemode: false,
  fund_name: "General Fund",
  gift_amount_cents: 5000,
  covered_cents: 0,
  total_cents: 5000,
  methods: ["card", "bank"],
  already_attached: false,
  ...overrides,
});

let intentRow: IntentRowFixture;

beforeEach(() => {
  vi.clearAllMocks();
  callLog.entries = [];
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
  mockHeaders.mockResolvedValue(new Headers({ "x-real-ip": "203.0.113.7" }));
  mockRateLimit.mockImplementation(async (key: string) => {
    callLog.entries.push(`limit:${key}`);
    return { allowed: true };
  });
  mockTurnstile.mockImplementation(async () => {
    callLog.entries.push("turnstile");
    return true;
  });
  mockConfigured.mockReturnValue(true);
  mockCreateSession.mockImplementation(async () => {
    callLog.entries.push("stripe");
    return { sessionId: SESSION, url: CHECKOUT_URL };
  });
  intentRow = createdRow();
  mockExecute.mockImplementation(async (q: unknown) => {
    const text = sqlText(q);
    if (text.includes("create_intent_public")) {
      callLog.entries.push("db:create_intent");
      return { rows: [intentRow] };
    }
    if (text.includes("attach_session")) {
      callLog.entries.push("db:attach");
      return { rows: [{ attached: true }] };
    }
    if (text.includes("fail_intent")) {
      callLog.entries.push("db:fail");
      return { rows: [] };
    }
    if (text.includes("public_giving_config")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.unstubAllEnvs());

describe("honeypot", () => {
  it("a filled honeypot answers a fake `unavailable` and spends NO budget, no Turnstile call, no database", async () => {
    const result = await createPublicGiveSessionAction("alder-creek", giveForm({ _hp: "I am a bot" }));
    expect(result).toEqual({ kind: "unavailable" });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockTurnstile).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("a whitespace-only honeypot is NOT filled", async () => {
    const result = await createPublicGiveSessionAction("alder-creek", giveForm({ _hp: "   " }));
    expect(result.kind).toBe("checkout");
  });
});

describe("a slug that is not a slug", () => {
  it("is `unavailable` and mints no limiter key", async () => {
    for (const slug of ["", "Alder Creek", "../etc", "a".repeat(100), "a:b"]) {
      expect(await createPublicGiveSessionAction(slug, giveForm())).toEqual({ kind: "unavailable" });
    }
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("rate limits", () => {
  it("checks the three keys in the stated order with the stated budgets, BEFORE Turnstile and the database", async () => {
    await createPublicGiveSessionAction("alder-creek", giveForm());
    expect(mockRateLimit.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["giving_session:alder-creek:203.0.113.7", { max: 10, windowSeconds: 600 }],
      ["giving_session_site:alder-creek", { max: 120, windowSeconds: 3600 }],
      ["giving_session_global", { max: 2000, windowSeconds: 3600 }],
    ]);
    expect(callLog.entries.slice(0, 5)).toEqual([
      "limit:giving_session:alder-creek:203.0.113.7",
      "limit:giving_session_site:alder-creek",
      "limit:giving_session_global",
      "turnstile",
      "db:create_intent",
    ]);
  });

  it("falls back to `unknown` for the IP when none is resolvable", async () => {
    mockHeaders.mockResolvedValue(new Headers());
    await createPublicGiveSessionAction("alder-creek", giveForm());
    expect(mockRateLimit.mock.calls[0]![0]).toBe("giving_session:alder-creek:unknown");
  });

  it.each([
    ["the per-IP key", 0],
    ["the per-site key", 1],
    ["the global key", 2],
  ])("%s refusing answers rate_limited with ITS wait, and nothing later runs", async (_name, index) => {
    mockRateLimit.mockImplementation(async (key: string) => {
      callLog.entries.push(`limit:${key}`);
      return callLog.entries.length === index + 1 ? { allowed: false, retryAfterSeconds: 77 + index } : { allowed: true };
    });
    const result = await createPublicGiveSessionAction("alder-creek", giveForm());
    expect(result).toEqual({ kind: "rate_limited", retryAfterSeconds: 77 + index });
    expect(mockRateLimit).toHaveBeenCalledTimes(index + 1);
    expect(mockTurnstile).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("an invalid amount has already spent the rate-limit budget (a probe pays), but never reaches the database", async () => {
    await createPublicGiveSessionAction("alder-creek", giveForm({ amount: "nope" }));
    expect(mockRateLimit).toHaveBeenCalledTimes(3);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("a limiter that throws is `error`, not a stack trace", async () => {
    mockRateLimit.mockRejectedValue(new Error("upstash down"));
    expect(await createPublicGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "error" });
  });
});

describe("Turnstile", () => {
  it("runs after the limiter and before parsing; a failure is `invalid` on the form and touches nothing", async () => {
    mockTurnstile.mockResolvedValue(false);
    const result = await createPublicGiveSessionAction("alder-creek", giveForm());
    expect(result).toEqual({ kind: "invalid", field: "form", message: GIVE_MESSAGES.captcha });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("reads the token from `turnstileToken`, falling back to the widget's own field, and passes the IP", async () => {
    await createPublicGiveSessionAction("alder-creek", giveForm({ turnstileToken: "tok-a" }));
    expect(mockTurnstile).toHaveBeenLastCalledWith("tok-a", "203.0.113.7");
    await createPublicGiveSessionAction("alder-creek", giveForm({ "cf-turnstile-response": "tok-b" }));
    expect(mockTurnstile).toHaveBeenLastCalledWith("tok-b", "203.0.113.7");
    await createPublicGiveSessionAction("alder-creek", giveForm());
    expect(mockTurnstile).toHaveBeenLastCalledWith(null, "203.0.113.7");
  });
});

describe("the amount is a string parsed once", () => {
  // regression for the amount-tampering row of the adversarial table
  it.each(["10.999", "1e3", "-5", "٣٠", "0", "25000.01", "1,000", "NaN", "Infinity"])(
    "amount %j is `invalid` on the amount field and never reaches the database or Stripe",
    async (amount) => {
      const result = await createPublicGiveSessionAction("alder-creek", giveForm({ amount }));
      expect(result).toMatchObject({ kind: "invalid", field: "amount" });
      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockCreateSession).not.toHaveBeenCalled();
    },
  );

  it("hands the database integer cents and the slug from the URL - nothing else from the form", async () => {
    await createPublicGiveSessionAction("alder-creek", giveForm({ amount: "37.50", coverFees: "on", frequency: "monthly", organizationId: "evil", membershipId: "evil" }));
    const create = mockExecute.mock.calls.find(([q]) => sqlText(q).includes("create_intent_public"))![0];
    const params = sqlParams(create);
    expect(params).toEqual(["alder-creek", FUND, 3750, true, "card", "monthly", KEY]);
  });
});

describe("every GiveResult arm", () => {
  it("checkout: the session URL, from the DATABASE's total", async () => {
    intentRow = createdRow({ covered_cents: 175, total_cents: 5175 });
    const result = await createPublicGiveSessionAction("alder-creek", giveForm({ coverFees: "on" }));
    expect(result).toEqual({ kind: "checkout", url: CHECKOUT_URL });
    expect(mockCreateSession.mock.calls[0]![0]).toMatchObject({ totalCents: 5175, coveredFeeCents: 175 });
    expect(callLog.entries.slice(-3)).toEqual(["db:create_intent", "stripe", "db:attach"]);
  });

  it("invalid: a bad field names itself", async () => {
    expect(await createPublicGiveSessionAction("alder-creek", giveForm({ frequency: "weekly" }))).toMatchObject({
      kind: "invalid",
      field: "frequency",
    });
  });

  it("rate_limited: the database's flood cap", async () => {
    intentRow = { outcome: "rate_limited" };
    expect(await createPublicGiveSessionAction("alder-creek", giveForm())).toMatchObject({ kind: "rate_limited" });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("unavailable: the database says the org is not live", async () => {
    intentRow = { outcome: "unavailable" };
    expect(await createPublicGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "unavailable" });
  });

  it("unavailable: Stripe unset records a failed intent first, and Stripe is not called", async () => {
    mockConfigured.mockReturnValue(false);
    expect(await createPublicGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "unavailable" });
    expect(callLog.entries.slice(-2)).toEqual(["db:create_intent", "db:fail"]);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("already_started: a repeat of a key whose session exists", async () => {
    intentRow = createdRow({ outcome: "existing", methods: null, already_attached: true });
    expect(await createPublicGiveSessionAction("alder-creek", giveForm())).toEqual({ kind: "already_started" });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("error: a Stripe failure fails the intent and says nothing about why", async () => {
    mockCreateSession.mockRejectedValue(new Error("stripe said something with sk_secret in it"));
    const result = await createPublicGiveSessionAction("alder-creek", giveForm());
    expect(result).toEqual({ kind: "error" });
    expect(JSON.stringify(result)).not.toContain("sk_");
    expect(callLog.entries.at(-1)).toBe("db:fail");
  });
});

describe("redirect targets (adversarial: Host spoofing)", () => {
  it("success_url and cancel_url come from NEXT_PUBLIC_APP_URL however Host / X-Forwarded-Host / Origin / Referer lie", async () => {
    mockHeaders.mockResolvedValue(
      new Headers({
        host: "evil.example",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "http",
        origin: "https://evil.example",
        referer: "https://evil.example/give",
        "x-real-ip": "203.0.113.7",
      }),
    );
    await createPublicGiveSessionAction("alder-creek", giveForm());
    const input = mockCreateSession.mock.calls[0]![0];
    expect(input.successUrl).toBe("https://app.example.invalid/site/alder-creek/give/return?session_id={CHECKOUT_SESSION_ID}");
    expect(input.cancelUrl).toBe("https://app.example.invalid/site/alder-creek/give");
    expect(JSON.stringify(input)).not.toContain("evil");
  });

  it("a form field named like a URL changes nothing", async () => {
    await createPublicGiveSessionAction(
      "alder-creek",
      giveForm({ successUrl: "https://evil.example/", cancelUrl: "https://evil.example/", returnUrl: "https://evil.example" }),
    );
    expect(JSON.stringify(mockCreateSession.mock.calls[0]![0])).not.toContain("evil");
  });
});

describe("no session, no audit", () => {
  it("never needs a session: no @/auth import exists in this action", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./actions.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/from\s+["']@\/auth["']/);
    expect(source).not.toMatch(/recordAudit|auditEvents/);
    expect(source).toMatch(/audit-exempt:/);
  });
});
