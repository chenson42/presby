import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../providers/stripe/errors";
import { FIXTURE_ACCOUNT, fixtureBody, type FixtureName } from "../providers/stripe/testing/sign-event";

vi.mock("server-only", () => ({}));

const fns = vi.hoisted(() => ({
  claimEvent: vi.fn(),
  finishEvent: vi.fn(),
  applyGift: vi.fn(),
  applyGiftFee: vi.fn(),
  applyReversal: vi.fn(),
  applySubscription: vi.fn(),
  applyIntentExpired: vi.fn(),
  applySettlement: vi.fn(),
  applyConnectionStatus: vi.fn(),
}));
vi.mock("./functions", () => fns);

const stripe = vi.hoisted(() => ({
  retrieveBalanceTransaction: vi.fn(),
  retrieveInvoiceForPayment: vi.fn(),
  retrieveEvent: vi.fn(),
}));
vi.mock("../providers/stripe/client", () => stripe);

const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));
// The real module pulls in next-auth and the database; the keys it exports are
// pinned against the source text in outcome.test.ts, so a stand-in whose values
// are the key names themselves keeps these assertions honest and DB-free.
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: new Proxy({}, { get: (_t, key) => String(key) }),
  recordAudit: audit.recordAudit,
}));

import { AUDIT_ACTIONS } from "@/lib/audit";
import { processInboxEvent } from "./process";

const INBOX = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "22222222-2222-4222-8222-222222222222";

function claim(fixture: FixtureName | null, overrides: Record<string, unknown> = {}, body?: string | null) {
  return {
    rawBody: body !== undefined ? body : fixture ? fixtureBody(fixture) : null,
    eventType: "checkout.session.completed",
    attempts: 1,
    bodyPurged: false,
    connectionId: CONNECTION,
    accountId: FIXTURE_ACCOUNT,
    livemode: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  fns.finishEvent.mockImplementation(async (_id: string, outcome: string) =>
    outcome === "dead" ? "dead_letter" : outcome === "failed" || outcome === "parked" ? "parked" : outcome,
  );
});

describe("processInboxEvent - the flow", () => {
  it("is a no-op when the row is not claimable (taken, not due, or gone)", async () => {
    fns.claimEvent.mockResolvedValue(null);
    expect(await processInboxEvent(INBOX)).toEqual({ inboxId: INBOX, claimed: false, status: null, verdict: null, parts: [] });
    expect(fns.finishEvent).not.toHaveBeenCalled();
  });

  it("applies a payment-mode gift and finishes it applied; no audit for a plain gift", async () => {
    fns.claimEvent.mockResolvedValue(claim("checkout-session-completed-payment"));
    fns.applyGift.mockResolvedValue("applied");
    const result = await processInboxEvent(INBOX);
    expect(result).toMatchObject({ claimed: true, status: "applied", verdict: "applied", parts: ["applied"] });
    expect(fns.applyGift).toHaveBeenCalledTimes(1);
    expect(fns.applyGift.mock.calls[0]![0]).toBe(INBOX);
    expect(fns.applyGift.mock.calls[0]![1]).toMatchObject({ paymentIntentId: "pi_fixturePaid000001", amountCents: 5000 });
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "applied", null);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("finishes AFTER applying and audits AFTER finishing", async () => {
    const order: string[] = [];
    fns.claimEvent.mockResolvedValue(claim("refund-created"));
    fns.applyReversal.mockImplementation(async () => (order.push("apply"), "applied"));
    fns.finishEvent.mockImplementation(async () => (order.push("finish"), "applied"));
    audit.recordAudit.mockImplementation(async () => void order.push("audit"));
    await processInboxEvent(INBOX);
    expect(order).toEqual(["apply", "finish", "audit"]);
  });

  it("a gift_fee retrieves the balance transaction through the allowlist and passes ITS numbers, never the body's", async () => {
    fns.claimEvent.mockResolvedValue(
      claim("charge-succeeded", {}, fixtureBody("charge-succeeded", { patch: (b) => void Object.assign((b.data as { object: object }).object, { fee: 9999, net: 1 }) })),
    );
    stripe.retrieveBalanceTransaction.mockResolvedValue({ amountCents: 5000, feeCents: 175, netCents: 4825, currency: "usd" });
    fns.applyGiftFee.mockResolvedValue("applied");
    await processInboxEvent(INBOX);
    expect(stripe.retrieveBalanceTransaction).toHaveBeenCalledWith(FIXTURE_ACCOUNT, "txn_fixturePaid0000001");
    expect(fns.applyGiftFee).toHaveBeenCalledWith(INBOX, {
      paymentIntentId: "pi_fixturePaid000001", feeCents: 175, netCents: 4825, method: "card",
    });
  });

  it("an invoice_payment.paid is COMPLETED from the invoice before it is applied (P3-9)", async () => {
    fns.claimEvent.mockResolvedValue(claim("invoice-payment-paid"));
    const donor = { externalCustomerId: "cus_fixture000002", name: "Fixture Donor", email: "d@example.invalid", address: { line1: null, line2: null, city: null, region: null, postal: null, country: null } };
    stripe.retrieveInvoiceForPayment.mockResolvedValue({ subscriptionId: "sub_fixtureMonthly0001", donor, billingReason: "subscription_cycle" });
    fns.applyGift.mockResolvedValue("applied");
    await processInboxEvent(INBOX);
    expect(stripe.retrieveInvoiceForPayment).toHaveBeenCalledWith(FIXTURE_ACCOUNT, "in_fixtureInvoice000001");
    expect(fns.applyGift).toHaveBeenCalledWith(INBOX, expect.objectContaining({ invoiceId: "in_fixtureInvoice000001" }), {
      subscriptionId: "sub_fixtureMonthly0001", donor,
    });
  });

  it("an invoice with no subscription is not a recurring gift of ours: ignored, never applied", async () => {
    fns.claimEvent.mockResolvedValue(claim("invoice-payment-paid"));
    stripe.retrieveInvoiceForPayment.mockResolvedValue({ subscriptionId: null, donor: {}, billingReason: "manual" });
    const result = await processInboxEvent(INBOX);
    expect(fns.applyGift).not.toHaveBeenCalled();
    expect(result).toMatchObject({ verdict: "ignored", parts: ["ignored:no_subscription_on_invoice"] });
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "ignored", "no_subscription_on_invoice");
  });

  it("routes every other kind to its apply function", async () => {
    const cases: Array<[FixtureName, keyof typeof fns]> = [
      ["checkout-session-completed-subscription", "applySubscription"],
      ["customer-subscription-deleted", "applySubscription"],
      ["checkout-session-expired", "applyIntentExpired"],
      ["payout-paid", "applySettlement"],
      ["account-updated-active", "applyConnectionStatus"],
      ["refund-updated-failed", "applyReversal"],
    ];
    for (const [fixture, fn] of cases) {
      vi.clearAllMocks();
      fns.claimEvent.mockResolvedValue(claim(fixture));
      fns[fn]!.mockResolvedValue("applied");
      fns.finishEvent.mockResolvedValue("applied");
      await processInboxEvent(INBOX);
      expect(fns[fn], fixture).toHaveBeenCalledTimes(1);
    }
  });

  it("an unhandled body (no normalized events) is ignored, not an error", async () => {
    fns.claimEvent.mockResolvedValue(claim(null, {}, fixtureBody("checkout-session-expired", { patch: (b) => void (b.type = "customer.created") })));
    const result = await processInboxEvent(INBOX);
    expect(result.verdict).toBe("ignored");
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "ignored", "no_events");
  });
});

describe("processInboxEvent - verdicts", () => {
  it("a body the normalizer refuses is DEAD with a readable code, and is audited as a dead letter", async () => {
    fns.claimEvent.mockResolvedValue(claim(null, {}, fixtureBody("checkout-session-expired", { patch: (b) => void (b.api_version = "2020-08-27") })));
    const result = await processInboxEvent(INBOX);
    expect(result).toMatchObject({ verdict: "dead", status: "dead_letter" });
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "dead", "normalize_api_version");
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.GIVING_EVENT_DEAD_LETTERED, actor: null, resourceId: INBOX }),
    );
  });

  it("malformed JSON is dead normalize_malformed_json", async () => {
    fns.claimEvent.mockResolvedValue(claim(null, {}, "{not json"));
    await processInboxEvent(INBOX);
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "dead", "normalize_malformed_json");
  });

  it("a body that disagrees with its inbox row is dead", async () => {
    fns.claimEvent.mockResolvedValue(claim("checkout-session-expired", { livemode: true }));
    await processInboxEvent(INBOX);
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "dead", "normalize_livemode_mismatch");
  });

  it("an over-reversal dead-letters and is audited as a dead letter (no reversal row was recorded)", async () => {
    fns.claimEvent.mockResolvedValue(claim("refund-created"));
    fns.applyReversal.mockResolvedValue("dead:over_reversal");
    const result = await processInboxEvent(INBOX);
    expect(result).toMatchObject({ verdict: "dead", status: "dead_letter" });
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "dead", "over_reversal");
    expect(audit.recordAudit.mock.calls.map((c) => c[0].action)).toEqual([AUDIT_ACTIONS.GIVING_EVENT_DEAD_LETTERED]);
  });

  it("a refund before its gift PARKS with the no_gift code (the ageing code)", async () => {
    fns.claimEvent.mockResolvedValue(claim("refund-created"));
    fns.applyReversal.mockResolvedValue("parked:no_gift");
    const result = await processInboxEvent(INBOX);
    expect(result).toMatchObject({ verdict: "parked", status: "parked" });
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "parked", "no_gift");
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("an applied reversal is audited with its kind and amount, system actor, after finish", async () => {
    fns.claimEvent.mockResolvedValue(claim("charge-dispute-created"));
    fns.applyReversal.mockResolvedValue("applied");
    await processInboxEvent(INBOX);
    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
    expect(audit.recordAudit).toHaveBeenCalledWith({
      action: AUDIT_ACTIONS.GIVING_REVERSAL_RECORDED,
      actor: null,
      resourceType: "giving_provider_connection",
      resourceId: CONNECTION,
      metadata: { connectionId: CONNECTION, inboxId: INBOX, eventType: "checkout.session.completed", reversalKind: "dispute", amountCents: 5000 },
    });
  });

  it("a deauthorization is audited as a system disconnect", async () => {
    fns.claimEvent.mockResolvedValue(claim("account-application-deauthorized"));
    fns.applyConnectionStatus.mockResolvedValue("applied:disconnected");
    await processInboxEvent(INBOX);
    expect(audit.recordAudit.mock.calls.map((c) => [c[0].action, c[0].actor])).toEqual([
      [AUDIT_ACTIONS.GIVING_CONNECTION_DISCONNECTED, null],
    ]);
  });

  it("an auto-linked gift writes the autolink row; a conflict writes the conflict row", async () => {
    fns.claimEvent.mockResolvedValue(claim("checkout-session-completed-payment"));
    fns.applyGift.mockResolvedValue("applied:autolinked");
    await processInboxEvent(INBOX);
    fns.applyGift.mockResolvedValue("applied:link_conflict");
    await processInboxEvent(INBOX);
    expect(audit.recordAudit.mock.calls.map((c) => c[0].action)).toEqual([
      AUDIT_ACTIONS.GIVING_DONOR_AUTOLINKED,
      AUDIT_ACTIONS.GIVING_DONOR_LINK_CONFLICT,
    ]);
  });

  it("writes NO audit row if finish_event says the lease was lost (someone else owns the event now)", async () => {
    fns.claimEvent.mockResolvedValue(claim("refund-created"));
    fns.applyReversal.mockResolvedValue("applied");
    fns.finishEvent.mockResolvedValue("not_processing");
    await processInboxEvent(INBOX);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("a reinstatement of a reversal never recorded is given up on after the grace, and parked before it", async () => {
    fns.claimEvent.mockResolvedValue(claim("refund-updated-failed", { attempts: 2 }));
    fns.applyReversal.mockResolvedValue("parked:no_reversal");
    await processInboxEvent(INBOX);
    expect(fns.finishEvent).toHaveBeenLastCalledWith(INBOX, "parked", "no_reversal");
    fns.claimEvent.mockResolvedValue(claim("refund-updated-failed", { attempts: 4 }));
    await processInboxEvent(INBOX);
    expect(fns.finishEvent).toHaveBeenLastCalledWith(INBOX, "ignored", "no_reversal");
  });
});

describe("processInboxEvent - it NEVER throws", () => {
  it("a claim failure returns unclaimed", async () => {
    fns.claimEvent.mockRejectedValue(new Error("connection reset"));
    await expect(processInboxEvent(INBOX)).resolves.toMatchObject({ claimed: false });
  });

  it("an apply that throws finishes the event failed:exception (back-off, dead letter at 8)", async () => {
    fns.claimEvent.mockResolvedValue(claim("refund-created"));
    fns.applyReversal.mockRejectedValue(new Error("deadlock detected"));
    const result = await processInboxEvent(INBOX);
    expect(result.parts).toEqual(["failed:exception"]);
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "failed", "exception");
  });

  it("a Stripe rate limit while fetching the fee is a retryable failure, not a dead letter", async () => {
    fns.claimEvent.mockResolvedValue(claim("charge-succeeded"));
    stripe.retrieveBalanceTransaction.mockRejectedValue(new ProviderError("rate_limited"));
    await processInboxEvent(INBOX);
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "failed", "stripe_rate_limited");
  });

  it("an unconfigured key retries too (the operator can fix the environment)", async () => {
    fns.claimEvent.mockResolvedValue(claim("charge-succeeded"));
    stripe.retrieveBalanceTransaction.mockRejectedValue(new ProviderError("unconfigured"));
    await processInboxEvent(INBOX);
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "failed", "stripe_unconfigured");
  });

  it("a non-USD balance transaction is ignored; a malformed Stripe response is dead", async () => {
    fns.claimEvent.mockResolvedValue(claim("charge-succeeded"));
    stripe.retrieveBalanceTransaction.mockRejectedValue(new ProviderError("bad_currency"));
    await processInboxEvent(INBOX);
    expect(fns.finishEvent).toHaveBeenLastCalledWith(INBOX, "ignored", "not_usd");
    stripe.retrieveBalanceTransaction.mockRejectedValue(new ProviderError("bad_response"));
    await processInboxEvent(INBOX);
    expect(fns.finishEvent).toHaveBeenLastCalledWith(INBOX, "dead", "stripe_bad_response");
  });

  it("a finish failure returns without throwing, with no audit", async () => {
    fns.claimEvent.mockResolvedValue(claim("refund-created"));
    fns.applyReversal.mockResolvedValue("applied");
    fns.finishEvent.mockRejectedValue(new Error("db down"));
    const result = await processInboxEvent(INBOX);
    expect(result).toMatchObject({ claimed: true, status: null });
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("logs ids and error classes only: never a body, a name or an amount", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fns.claimEvent.mockResolvedValue(claim("checkout-session-completed-payment"));
    fns.applyGift.mockRejectedValue(new Error("duplicate key value Fixture Donor donor.fixture@example.invalid"));
    await processInboxEvent(INBOX);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("Fixture Donor");
    expect(logged).not.toContain("example.invalid");
    expect(logged).not.toContain("5000");
  });
});

describe("processInboxEvent - purged bodies", () => {
  it("re-fetches through retrieveEvent when the claim can name the event", async () => {
    fns.claimEvent.mockResolvedValue(claim(null, { bodyPurged: true, externalEventId: "evt_fixtureRefetch0001" }, null));
    stripe.retrieveEvent.mockResolvedValue(fixtureBody("checkout-session-expired"));
    fns.applyIntentExpired.mockResolvedValue("applied");
    const result = await processInboxEvent(INBOX);
    expect(stripe.retrieveEvent).toHaveBeenCalledWith(FIXTURE_ACCOUNT, "evt_fixtureRefetch0001");
    expect(result.verdict).toBe("applied");
  });

  it("without an event id a purged body is dead with a code that says why", async () => {
    fns.claimEvent.mockResolvedValue(claim(null, { bodyPurged: true }, null));
    await processInboxEvent(INBOX);
    expect(stripe.retrieveEvent).not.toHaveBeenCalled();
    expect(fns.finishEvent).toHaveBeenCalledWith(INBOX, "dead", "body_purged");
  });
});
