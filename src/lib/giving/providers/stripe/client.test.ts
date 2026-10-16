import { readFileSync } from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripComments } from "../../../../../scripts/check-giving-boundaries.mjs";
import { ProviderError, WebhookSignatureError } from "./errors";
import { FIXTURE_ACCOUNT, FIXTURE_SECRET, fixtureBody, signStripePayload } from "./testing/sign-event";

vi.mock("server-only", () => ({}));

const clientSource = readFileSync(path.join(__dirname, "client.ts"), "utf8");

// A key-shaped value is assembled at runtime so no key shape is ever written in a file.
const liveKey = ["sk", "live", "fixture-not-a-real-key"].join("_");
const testKey = ["sk", "test", "fixture-not-a-real-key"].join("_");
const restrictedLive = ["rk", "live", "fixture-not-a-real-key"].join("_");

describe("the Stripe allowlist (R8)", () => {
  it("exports EXACTLY the Phase 3 set", async () => {
    const client = await import("./client");
    expect(Object.keys(client).sort()).toEqual(
      [
        "STRIPE_API_VERSION",
        "createCheckoutSession",
        "createConnectedAccount",
        "createOnboardingLink",
        "isStripeConfigured",
        "listBalanceTransactionsForPayout",
        "platformMode",
        "retrieveBalanceTransaction",
        "retrieveConnectedAccount",
        "retrieveEvent",
        "retrieveInvoiceForPayment",
        "verifyWebhook",
      ].sort(),
    );
  });

  it("never touches a forbidden resource or a list/search of customers, charges, payment intents or subscriptions", () => {
    const code: string = stripComments(clientSource);
    for (const forbidden of [
      /\bcustomers\./,
      /\bcharges\./,
      /\bpaymentIntents\./,
      /\bsubscriptions\./,
      /\.search\(/,
      /\binvoices\.list\b/,
      /\brefunds\./,
      /\bpayouts\./,
      /\btransfers\./,
      /\bbillingPortal\b/,
      /\bwebhookEndpoints\b/,
      /\bcustomerPortal\b/,
    ]) {
      expect(code, `client.ts must not match ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("reaches exactly the SDK resources the restricted-key table grants, and no others", () => {
    const code: string = stripComments(clientSource);
    const used = new Set([...code.matchAll(/\bstripe\.((?:[a-zA-Z0-9]+\.)*[a-zA-Z0-9]+)\.(?:create|retrieve|list)\(/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(
      [
        "balanceTransactions",
        "checkout.sessions",
        "events",
        "invoices",
        "v2.core.accountLinks",
        "v2.core.accounts",
      ].sort(),
    );
  });

  it("is the only non-test module in the tree that imports stripe at runtime", () => {
    // The tripwire is the authority (check:giving-boundaries B1); this pins the premise.
    expect(clientSource).toMatch(/^import Stripe from "stripe";$/m);
  });

  it("pins the SDK exactly (no range) and the API version to the SDK's own", async () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.dependencies.stripe).toBe("23.0.0");
    const { STRIPE_API_VERSION } = await import("./client");
    expect(STRIPE_API_VERSION).toBe("2026-09-30.endive");
    // If a dependency bump moves the SDK's pinned version, this fails and a human decides.
    expect(Stripe.API_VERSION).toBe(STRIPE_API_VERSION);
  });

  it("builds the SDK per call with the pinned version and bounded retries", () => {
    expect(clientSource).toMatch(/apiVersion: STRIPE_API_VERSION/);
    expect(clientSource).toMatch(/maxNetworkRetries: 2/);
  });

  it("logs error type, code and request id only: never a message, a body or a key", () => {
    const code: string = stripComments(clientSource);
    const logs = code.split("\n").filter((l) => l.includes("console."));
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toMatch(/\.message|\.stack|rawBody|STRIPE_SECRET_KEY|secretKey|\bkey\b/);
    }
  });
});

describe("configuration", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("isStripeConfigured needs BOTH the API key and the webhook secret", async () => {
    const { isStripeConfigured } = await import("./client");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(isStripeConfigured()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", testKey);
    expect(isStripeConfigured()).toBe(false);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", FIXTURE_SECRET);
    expect(isStripeConfigured()).toBe(true);
    vi.stubEnv("STRIPE_SECRET_KEY", "   ");
    expect(isStripeConfigured()).toBe(false);
  });

  it("platformMode reads the key prefix; anything unrecognized reads as test", async () => {
    const { platformMode } = await import("./client");
    vi.stubEnv("STRIPE_SECRET_KEY", liveKey);
    expect(platformMode()).toBe("live");
    vi.stubEnv("STRIPE_SECRET_KEY", restrictedLive);
    expect(platformMode()).toBe("live");
    vi.stubEnv("STRIPE_SECRET_KEY", testKey);
    expect(platformMode()).toBe("test");
    vi.stubEnv("STRIPE_SECRET_KEY", "giving-e2e-not-a-key");
    expect(platformMode()).toBe("test");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(platformMode()).toBe("test");
  });

  it("every SDK-backed call fails with 'unconfigured' BEFORE any network when the key is unset", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const client = await import("./client");
    await expect(client.retrieveConnectedAccount(FIXTURE_ACCOUNT)).rejects.toMatchObject({ code: "unconfigured" });
    await expect(
      client.createConnectedAccount({ displayName: "X Church", contactEmail: "a@example.invalid", idempotencyKey: "k" }),
    ).rejects.toBeInstanceOf(ProviderError);
    await expect(client.retrieveEvent(FIXTURE_ACCOUNT, "evt_fixtureEvent00001")).rejects.toMatchObject({ code: "unconfigured" });
  });

  it("rejects malformed ids before calling out (no request built from a bad id)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", testKey);
    const client = await import("./client");
    await expect(client.retrieveConnectedAccount("acct_../../etc")).rejects.toMatchObject({ code: "bad_response" });
    await expect(client.retrieveBalanceTransaction(FIXTURE_ACCOUNT, "not-a-txn")).rejects.toMatchObject({ code: "bad_response" });
    await expect(client.retrieveInvoiceForPayment(FIXTURE_ACCOUNT, "in_x")).rejects.toMatchObject({ code: "bad_response" });
    await expect(client.retrieveEvent("nope", "evt_fixtureEvent00001")).rejects.toMatchObject({ code: "bad_response" });
    await expect(client.listBalanceTransactionsForPayout(FIXTURE_ACCOUNT, "po_")).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("verifyWebhook - the static helper, so it works with STRIPE_SECRET_KEY unset", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", FIXTURE_SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a correctly signed fixture and returns only the facts the route needs", async () => {
    const { verifyWebhook } = await import("./client");
    const body = fixtureBody("checkout-session-completed-payment");
    expect(verifyWebhook(body, signStripePayload(body))).toEqual({
      id: "evt_fixtureCheckoutSessionCompletedPayment",
      type: "checkout.session.completed",
      account: FIXTURE_ACCOUNT,
      livemode: false,
      apiVersion: "2026-09-30.endive",
    });
  });

  it("reports a platform-scope event (no account) as account null", async () => {
    const { verifyWebhook } = await import("./client");
    const body = fixtureBody("charge-succeeded", { patch: (b) => void delete b.account });
    expect(verifyWebhook(body, signStripePayload(body)).account).toBeNull();
  });

  it("reports livemode only when it is exactly true", async () => {
    const { verifyWebhook } = await import("./client");
    const live = fixtureBody("charge-succeeded", { patch: (b) => void (b.livemode = true) });
    expect(verifyWebhook(live, signStripePayload(live)).livemode).toBe(true);
    const odd = fixtureBody("charge-succeeded", { patch: (b) => void (b.livemode = "true") });
    expect(verifyWebhook(odd, signStripePayload(odd)).livemode).toBe(false);
  });

  it("rejects a signature made with a different secret", async () => {
    const { verifyWebhook } = await import("./client");
    const body = fixtureBody("charge-succeeded");
    expect(() => verifyWebhook(body, signStripePayload(body, "some-other-secret"))).toThrow(WebhookSignatureError);
  });

  it("rejects a body altered after signing (one byte)", async () => {
    const { verifyWebhook } = await import("./client");
    const body = fixtureBody("charge-succeeded");
    const header = signStripePayload(body);
    expect(() => verifyWebhook(body.replace("5000", "5001"), header)).toThrow(WebhookSignatureError);
    expect(() => verifyWebhook(`${body} `, header)).toThrow(WebhookSignatureError);
  });

  it("enforces the 300 second tolerance against a STALE timestamp (replay protection)", async () => {
    const { verifyWebhook } = await import("./client");
    const body = fixtureBody("charge-succeeded");
    const now = Math.floor(Date.now() / 1000);
    expect(() => verifyWebhook(body, signStripePayload(body, FIXTURE_SECRET, now - 290))).not.toThrow();
    expect(() => verifyWebhook(body, signStripePayload(body, FIXTURE_SECRET, now - 400))).toThrow(WebhookSignatureError);
    // The SDK checks age only: a future-dated header that carries a valid HMAC
    // needs the secret to forge, so it is not a replay. Pinned so a change is noticed.
    expect(() => verifyWebhook(body, signStripePayload(body, FIXTURE_SECRET, now + 400))).not.toThrow();
  });

  it.each(["", "garbage", "t=,v1=", "v1=abc", "t=123", "t=abc,v1=def"])("rejects the header %j", async (header) => {
    const { verifyWebhook } = await import("./client");
    expect(() => verifyWebhook(fixtureBody("charge-succeeded"), header)).toThrow(WebhookSignatureError);
  });

  it("rejects a validly signed body that is not an event", async () => {
    const { verifyWebhook } = await import("./client");
    for (const body of ['{"hello":1}', "[]", "null", "not json"]) {
      expect(() => verifyWebhook(body, signStripePayload(body))).toThrow(WebhookSignatureError);
    }
  });

  it("with the signing secret unset it is 'unconfigured', never a pass", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const { verifyWebhook } = await import("./client");
    const body = fixtureBody("charge-succeeded");
    expect(() => verifyWebhook(body, signStripePayload(body, ""))).toThrow(ProviderError);
  });

  it("does not echo the secret, the signature or the body in its error", async () => {
    const { verifyWebhook } = await import("./client");
    const body = fixtureBody("charge-succeeded");
    try {
      verifyWebhook(body, signStripePayload(body, "wrong-secret"));
    } catch (err) {
      const text = `${(err as Error).message}${JSON.stringify(err)}`;
      expect(text).not.toContain(FIXTURE_SECRET);
      expect(text).not.toContain("wrong-secret");
      expect(text).not.toContain("evt_fixture");
    }
  });
});
