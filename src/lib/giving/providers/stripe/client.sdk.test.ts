import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "./errors";
import { FIXTURE_ACCOUNT } from "./testing/sign-event";

vi.mock("server-only", () => ({}));

/**
 * client.ts against a FAKE SDK: what it asks Stripe for, with which per-request
 * options, and how it turns every outcome - a good response, a hostile URL, a
 * failure whose message contains the secret - into a projection or a
 * ProviderError. No network, no real Stripe object ever involved.
 */

const SECRET_MATERIAL = "giving-test-secret-material-0123456789";

const sdk = vi.hoisted(() => {
  const state = {
    constructed: [] as Array<{ key: string; options: Record<string, unknown> }>,
    calls: [] as Array<{ op: string; args: unknown[] }>,
    handlers: {} as Record<string, (...args: unknown[]) => unknown>,
  };
  const call = (op: string) => (...args: unknown[]) => {
    state.calls.push({ op, args });
    const handler = state.handlers[op];
    if (!handler) throw new Error(`no fake handler for ${op}`);
    return Promise.resolve().then(() => handler(...args));
  };
  class FakeStripe {
    static webhooks = {};
    v2 = { core: { accounts: { create: call("accounts.create"), retrieve: call("accounts.retrieve") }, accountLinks: { create: call("accountLinks.create") } } };
    checkout = { sessions: { create: call("sessions.create") } };
    balanceTransactions = { retrieve: call("bt.retrieve"), list: call("bt.list") };
    events = { retrieve: call("events.retrieve") };
    invoices = { retrieve: call("invoices.retrieve") };
    constructor(key: string, options: Record<string, unknown>) {
      state.constructed.push({ key, options });
    }
  }
  return { state, FakeStripe };
});
vi.mock("stripe", () => ({ default: sdk.FakeStripe }));

const KEY = "giving-test-secret-material-0123456789";
const ACCT = FIXTURE_ACCOUNT;

async function load() {
  return import("./client");
}

beforeEach(() => {
  sdk.state.constructed.length = 0;
  sdk.state.calls.length = 0;
  sdk.state.handlers = {};
  vi.unstubAllEnvs();
  vi.stubEnv("STRIPE_SECRET_KEY", KEY);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "giving-e2e-signing-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("construction", () => {
  it("builds the SDK lazily, per call, with the pinned version and 2 network retries", async () => {
    const client = await load();
    expect(sdk.state.constructed).toHaveLength(0); // importing builds nothing
    sdk.state.handlers["accounts.retrieve"] = () => ({});
    await client.retrieveConnectedAccount(ACCT);
    await client.retrieveConnectedAccount(ACCT);
    expect(sdk.state.constructed).toHaveLength(2);
    expect(sdk.state.constructed[0]).toEqual({ key: KEY, options: { apiVersion: "2026-09-30.endive", maxNetworkRetries: 2 } });
  });
});

describe("createConnectedAccount", () => {
  it("sends the confirmed v2 body with the idempotency key and returns a projection", async () => {
    const client = await load();
    sdk.state.handlers["accounts.create"] = () => ({ id: ACCT, livemode: false, display_name: "Leaky Object", secret: "x" });
    const result = await client.createConnectedAccount({
      displayName: "Alder Creek Fellowship",
      contactEmail: "treasurer.fixture@example.invalid",
      idempotencyKey: "giving-connect:org-1:0",
    });
    expect(result).toEqual({ accountId: ACCT, livemode: false });
    const [params, options] = sdk.state.calls[0]!.args as [Record<string, unknown>, Record<string, unknown>];
    expect(options).toEqual({ idempotencyKey: "giving-connect:org-1:0" });
    expect(params).toMatchObject({
      dashboard: "full",
      identity: { country: "us", entity_type: "company" },
      defaults: { currency: "usd", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      configuration: { merchant: { statement_descriptor: { descriptor: "Alder Creek Fellowship" } } },
    });
  });

  it("reports a live account as live", async () => {
    const client = await load();
    sdk.state.handlers["accounts.create"] = () => ({ id: ACCT, livemode: true });
    expect((await client.createConnectedAccount({ displayName: "X Church", contactEmail: "a@example.invalid", idempotencyKey: "k" })).livemode).toBe(true);
  });

  it("refuses an account id that is not the shape the database accepts", async () => {
    const client = await load();
    sdk.state.handlers["accounts.create"] = () => ({ id: "acct_x", livemode: false });
    await expect(
      client.createConnectedAccount({ displayName: "X Church", contactEmail: "a@example.invalid", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("createOnboardingLink", () => {
  const input = { accountId: ACCT, returnUrl: "https://example.invalid/r", refreshUrl: "https://example.invalid/f" };

  it("returns the single-use URL and its expiry", async () => {
    const client = await load();
    sdk.state.handlers["accountLinks.create"] = () => ({ url: "https://accounts.stripe.com/r/acct_x", expires_at: "2026-10-15T12:10:00Z" });
    const link = await client.createOnboardingLink(input);
    expect(link.url).toBe("https://accounts.stripe.com/r/acct_x");
    expect(link.expiresAt?.toISOString()).toBe("2026-10-15T12:10:00.000Z");
    expect(sdk.state.calls[0]!.args[0]).toMatchObject({ account: ACCT, use_case: { type: "account_onboarding" } });
  });

  it("accepts connect.stripe.com too, and tolerates a missing expiry", async () => {
    const client = await load();
    sdk.state.handlers["accountLinks.create"] = () => ({ url: "https://connect.stripe.com/setup/c/x" });
    expect((await client.createOnboardingLink(input)).expiresAt).toBeNull();
  });

  it.each([
    "https://accounts.stripe.com.evil.example/r/x",
    "https://evil.example/r/accounts.stripe.com",
    "https://accounts.stripe.com@evil.example/r/x", // leak-ok: hostile userinfo URL test input, not an email
    "http://accounts.stripe.com/r/x",
    "https://accounts.stripe.com:444/r/x",
    "https://checkout.stripe.com/c/pay/x",
    "",
    null,
  ])("throws bad_origin for %j and never returns it", async (url) => {
    const client = await load();
    sdk.state.handlers["accountLinks.create"] = () => ({ url });
    await expect(client.createOnboardingLink(input)).rejects.toMatchObject({ code: "bad_origin" });
  });
});

describe("retrieveConnectedAccount", () => {
  it("asks for the merchant configuration and requirements, and maps the v2 response", async () => {
    const client = await load();
    sdk.state.handlers["accounts.retrieve"] = () => ({
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { status: "active" },
            ach_debit_payments: { status: "active" },
            stripe_balance: { payouts: { status: "active" } },
          },
        },
      },
      requirements: { entries: [] },
    });
    expect(await client.retrieveConnectedAccount(ACCT)).toMatchObject({
      chargesEnabled: true, payoutsEnabled: true, cardEnabled: true, achEnabled: true, requirementsDue: false,
    });
    expect(sdk.state.calls[0]!.args).toEqual([ACCT, { include: ["configuration.merchant", "requirements"] }]);
  });
});

describe("createCheckoutSession", () => {
  const input = {
    mode: "payment" as const,
    accountId: ACCT,
    totalCents: 5000,
    coveredFeeCents: 0,
    fundDisplayName: "General Fund",
    methods: ["card" as const],
    intentId: "00000000-0000-4000-8000-000000000001",
    successUrl: "https://example.invalid/ok",
    cancelUrl: "https://example.invalid/no",
    expiresAt: new Date(1790000000 * 1000),
    idempotencyKey: "giving-session:00000000-0000-4000-8000-000000000001",
  };

  it("creates the session ON THE CONGREGATION'S ACCOUNT with the idempotency key, and returns id and URL only", async () => {
    const client = await load();
    sdk.state.handlers["sessions.create"] = () => ({
      id: "cs_fixtureSession0001",
      url: "https://checkout.stripe.com/c/pay/cs_fixtureSession0001#frag",
      customer: "cus_leaky",
    });
    const result = await client.createCheckoutSession(input);
    expect(result).toEqual({ sessionId: "cs_fixtureSession0001", url: "https://checkout.stripe.com/c/pay/cs_fixtureSession0001#frag" });
    const [params, options] = sdk.state.calls[0]!.args as [Record<string, unknown>, Record<string, unknown>];
    expect(options).toEqual({ stripeAccount: ACCT, idempotencyKey: input.idempotencyKey });
    expect(params).toMatchObject({ mode: "payment", submit_type: "donate", customer_creation: "always" });
    expect(params).not.toHaveProperty("accountId");
    expect(params).not.toHaveProperty("idempotencyKey");
  });

  it.each([
    "https://checkout.stripe.com.evil.example/c/pay/x",
    "https://evil.example/checkout.stripe.com",
    "https://checkout.stripe.com@evil.example/", // leak-ok: hostile userinfo URL test input, not an email
    "https://checkout.stripe.com:8443/",
    "http://checkout.stripe.com/",
    "https://accounts.stripe.com/r/x",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ])("throws bad_origin for a session URL of %j", async (url) => {
    const client = await load();
    sdk.state.handlers["sessions.create"] = () => ({ id: "cs_fixtureSession0001", url });
    await expect(client.createCheckoutSession(input)).rejects.toMatchObject({ code: "bad_origin" });
  });

  it("refuses a session id the database would not accept", async () => {
    const client = await load();
    sdk.state.handlers["sessions.create"] = () => ({ id: "cs_x", url: "https://checkout.stripe.com/c/pay/x" });
    await expect(client.createCheckoutSession(input)).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("reconciliation reads (Connect)", () => {
  it("retrieveBalanceTransaction scopes to the account and returns cents", async () => {
    const client = await load();
    sdk.state.handlers["bt.retrieve"] = () => ({ amount: 5000, fee: 175, net: 4825, currency: "usd", extra: "x" });
    expect(await client.retrieveBalanceTransaction(ACCT, "txn_fixturePaid0000001")).toEqual({
      amountCents: 5000, feeCents: 175, netCents: 4825, currency: "usd",
    });
    expect(sdk.state.calls[0]!.args).toEqual(["txn_fixturePaid0000001", {}, { stripeAccount: ACCT }]);
  });

  it("refuses a non-USD balance transaction", async () => {
    const client = await load();
    sdk.state.handlers["bt.retrieve"] = () => ({ amount: 5000, fee: 175, net: 4825, currency: "eur" });
    await expect(client.retrieveBalanceTransaction(ACCT, "txn_fixturePaid0000001")).rejects.toMatchObject({ code: "bad_currency" });
  });

  it("refuses non-integer money", async () => {
    const client = await load();
    sdk.state.handlers["bt.retrieve"] = () => ({ amount: 50.5, fee: 1, net: 49.5, currency: "usd" });
    await expect(client.retrieveBalanceTransaction(ACCT, "txn_fixturePaid0000001")).rejects.toMatchObject({ code: "bad_response" });
  });

  it("listBalanceTransactionsForPayout filters by payout, expands the source and projects rows", async () => {
    const client = await load();
    sdk.state.handlers["bt.list"] = () => ({
      has_more: true,
      data: [
        { id: "txn_a", type: "charge", amount: 5000, fee: 175, net: 4825, currency: "usd", source: { payment_intent: "pi_fixturePaid000001" } },
        { id: "txn_b", type: "adjustment", amount: -100, fee: 0, net: -100, currency: "usd", source: "ad_x" },
      ],
    });
    const page = await client.listBalanceTransactionsForPayout(ACCT, "po_fixturePayout000001", "txn_prev");
    expect(page.hasMore).toBe(true);
    expect(page.rows).toEqual([
      { balanceTransactionId: "txn_a", kind: "charge", amountCents: 5000, feeCents: 175, netCents: 4825, paymentIntentId: "pi_fixturePaid000001" },
      { balanceTransactionId: "txn_b", kind: "adjustment", amountCents: -100, feeCents: 0, netCents: -100, paymentIntentId: null },
    ]);
    expect(sdk.state.calls[0]!.args).toEqual([
      { payout: "po_fixturePayout000001", limit: 100, expand: ["data.source"], starting_after: "txn_prev" },
      { stripeAccount: ACCT },
    ]);
  });

  it("retrieveEvent returns the event as JSON text, scoped to the account", async () => {
    const client = await load();
    sdk.state.handlers["events.retrieve"] = () => ({ id: "evt_fixtureEvent00001", type: "charge.succeeded" });
    expect(JSON.parse(await client.retrieveEvent(ACCT, "evt_fixtureEvent00001"))).toEqual({
      id: "evt_fixtureEvent00001", type: "charge.succeeded",
    });
    expect(sdk.state.calls[0]!.args).toEqual(["evt_fixtureEvent00001", {}, { stripeAccount: ACCT }]);
  });
});

describe("retrieveInvoiceForPayment (P3-9)", () => {
  const address = { line1: "100 Fixture Lane", line2: null, city: "Faketown", state: "OH", postal_code: "00000", country: "US" };

  it("projects the subscription from the basil-era parent, and the donor from the invoice's own customer_* fields", async () => {
    const client = await load();
    sdk.state.handlers["invoices.retrieve"] = () => ({
      customer: "cus_fixture000002",
      customer_name: "Fixture Donor",
      customer_email: "donor.fixture@example.invalid",
      customer_address: address,
      billing_reason: "subscription_cycle",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_fixtureMonthly0001" } },
      lines: { data: ["leaky"] },
    });
    const invoice = await client.retrieveInvoiceForPayment(ACCT, "in_fixtureInvoice000001");
    expect(invoice).toEqual({
      subscriptionId: "sub_fixtureMonthly0001",
      billingReason: "subscription_cycle",
      donor: {
        externalCustomerId: "cus_fixture000002",
        name: "Fixture Donor",
        email: "donor.fixture@example.invalid",
        address: { line1: "100 Fixture Lane", line2: null, city: "Faketown", region: "OH", postal: "00000", country: "US" },
      },
    });
    // No `expand`: expanding the customer would need the Customers permission the key does not hold.
    expect(sdk.state.calls[0]!.args).toEqual(["in_fixtureInvoice000001", {}, { stripeAccount: ACCT }]);
  });

  it("falls back to the pre-basil invoice.subscription field, and reads an expanded id", async () => {
    const client = await load();
    sdk.state.handlers["invoices.retrieve"] = () => ({ customer: { id: "cus_fixture000002" }, subscription: { id: "sub_fixtureLegacy00001" } });
    const invoice = await client.retrieveInvoiceForPayment(ACCT, "in_fixtureInvoice000001");
    expect(invoice.subscriptionId).toBe("sub_fixtureLegacy00001");
    expect(invoice.donor.externalCustomerId).toBe("cus_fixture000002");
    expect(invoice.donor.address.city).toBeNull();
  });

  it("an invoice with no subscription projects subscriptionId null", async () => {
    const client = await load();
    sdk.state.handlers["invoices.retrieve"] = () => ({ customer: "cus_fixture000002" });
    expect((await client.retrieveInvoiceForPayment(ACCT, "in_fixtureInvoice000001")).subscriptionId).toBeNull();
  });
});

describe("failures never leak the secret", () => {
  const input = { accountId: ACCT, returnUrl: "https://example.invalid/r", refreshUrl: "https://example.invalid/f" };

  it("a Stripe error whose message contains the key becomes a fixed-text ProviderError", async () => {
    const client = await load();
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.state.handlers["accountLinks.create"] = () => {
      throw Object.assign(new Error(`Invalid API Key provided: ${SECRET_MATERIAL}`), {
        type: "StripeAuthenticationError",
        code: "api_key_invalid",
        statusCode: 401,
        requestId: "req_fixture0001",
        raw: { message: SECRET_MATERIAL },
      });
    };
    let thrown: unknown;
    try {
      await client.createOnboardingLink(input);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ProviderError);
    const error = thrown as ProviderError;
    expect(error.code).toBe("stripe_error");
    const everything = `${error.message}${JSON.stringify(error)}${error.stack ?? ""}${JSON.stringify(logs.mock.calls)}`;
    expect(everything).not.toContain(SECRET_MATERIAL);
    expect(error.details).toEqual({
      stripeType: "StripeAuthenticationError", stripeCode: "api_key_invalid", requestId: "req_fixture0001", statusCode: 401,
    });
    // the log carries type / code / request id only
    expect(logs).toHaveBeenCalledTimes(1);
    expect(logs.mock.calls[0]![1]).toEqual({
      operation: "createOnboardingLink", code: "stripe_error", stripeType: "StripeAuthenticationError",
      stripeCode: "api_key_invalid", requestId: "req_fixture0001", statusCode: 401,
    });
  });

  it.each([
    [{ statusCode: 429 }, "rate_limited", true],
    [{ type: "StripeRateLimitError" }, "rate_limited", true],
    [{ type: "StripeConnectionError" }, "network", true],
    [{ statusCode: 404 }, "not_found", false],
    [{ statusCode: 400, type: "StripeInvalidRequestError" }, "stripe_error", true],
    [{}, "stripe_error", true],
  ])("classifies %j as %s (transient: %s)", async (shape, code, transient) => {
    const client = await load();
    vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.state.handlers["accounts.retrieve"] = () => {
      throw Object.assign(new Error(SECRET_MATERIAL), shape);
    };
    await expect(client.retrieveConnectedAccount(ACCT)).rejects.toSatisfy((err: unknown) => {
      return err instanceof ProviderError && err.code === code && err.transient === transient && !err.message.includes(SECRET_MATERIAL);
    });
  });

  it("a thrown non-Error value is still a ProviderError", async () => {
    const client = await load();
    vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.state.handlers["accounts.retrieve"] = () => {
      throw SECRET_MATERIAL;
    };
    await expect(client.retrieveConnectedAccount(ACCT)).rejects.toBeInstanceOf(ProviderError);
  });
});
