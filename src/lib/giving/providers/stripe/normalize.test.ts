import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../../types";
import { normalize, NormalizeError } from "./normalize";
import { FIXTURE_ACCOUNT, FIXTURE_NAMES, fixtureBody, type FixtureName } from "./testing/sign-event";

const CREATED = 1790000000;
const at = (offset = 0) => new Date((CREATED + offset) * 1000);
const EXPECTED = { accountId: FIXTURE_ACCOUNT, livemode: false };

const DONOR = {
  externalCustomerId: "cus_fixture000001",
  name: "Fixture Donor",
  email: "donor.fixture@example.invalid",
  address: { line1: "100 Fixture Lane", line2: null, city: "Faketown", region: "OH", postal: "00000", country: "US" },
};

/** What each handled fixture must become. A fixture with no row here fails the coverage test below. */
const TABLE: Record<FixtureName, NormalizedEvent[]> = {
  "checkout-session-completed-payment": [
    {
      kind: "gift", status: "succeeded", sessionId: "cs_fixturePaid000001", subscriptionId: null, invoiceId: null,
      paymentIntentId: "pi_fixturePaid000001", amountCents: 5000, authorizedAt: at(), failureCode: null,
      method: "card", donor: DONOR,
    },
  ],
  "checkout-session-completed-payment-unpaid": [
    {
      kind: "gift", status: "pending", sessionId: "cs_fixtureAch00000001", subscriptionId: null, invoiceId: null,
      paymentIntentId: "pi_fixtureAch00000001", amountCents: 10000, authorizedAt: at(), failureCode: null,
      method: "us_bank_account", donor: DONOR,
    },
  ],
  "checkout-session-completed-subscription": [
    {
      kind: "subscription", action: "started", sessionId: "cs_fixtureMonthly0001", subscriptionId: "sub_fixtureMonthly0001",
      donor: { ...DONOR, externalCustomerId: "cus_fixture000002" }, at: at(),
    },
  ],
  "checkout-session-async-payment-succeeded": [
    {
      kind: "gift", status: "succeeded", sessionId: "cs_fixtureAch00000001", subscriptionId: null, invoiceId: null,
      paymentIntentId: "pi_fixtureAch00000001", amountCents: 10000, authorizedAt: at(345600), failureCode: null,
      method: "us_bank_account", donor: DONOR,
    },
  ],
  "checkout-session-async-payment-failed": [
    {
      kind: "gift", status: "failed", sessionId: "cs_fixtureAch00000001", subscriptionId: null, invoiceId: null,
      paymentIntentId: "pi_fixtureAch00000001", amountCents: 10000, authorizedAt: at(345600),
      failureCode: "async_payment_failed", method: "us_bank_account", donor: DONOR,
    },
  ],
  "checkout-session-expired": [{ kind: "intent_expired", sessionId: "cs_fixtureExpired0001" }],
  "invoice-payment-paid": [
    {
      kind: "gift", status: "succeeded", sessionId: null, subscriptionId: null, invoiceId: "in_fixtureInvoice000001",
      paymentIntentId: "pi_fixtureRenewal00001", amountCents: 2500, authorizedAt: at(2592000), failureCode: null,
      method: null, donor: null,
    },
  ],
  "charge-succeeded": [
    { kind: "gift_fee", paymentIntentId: "pi_fixturePaid000001", balanceTransactionId: "txn_fixturePaid0000001", method: "card" },
  ],
  "refund-created": [
    {
      kind: "reversal", paymentIntentId: "pi_fixturePaid000001", reversalKind: "refund", externalReversalId: "re_fixtureRefund000001",
      amountCents: 5000, occurredAt: at(86400), offsetsExternalReversalId: null,
    },
  ],
  "refund-updated-failed": [
    {
      kind: "reversal", paymentIntentId: "pi_fixturePaid000001", reversalKind: "reinstatement",
      externalReversalId: "re_fixtureRefund000001:failed", amountCents: 5000, occurredAt: at(172800),
      offsetsExternalReversalId: "re_fixtureRefund000001",
    },
  ],
  "charge-dispute-created": [
    {
      kind: "reversal", paymentIntentId: "pi_fixturePaid000001", reversalKind: "dispute", externalReversalId: "dp_fixtureDispute00001",
      amountCents: 5000, occurredAt: at(864000), offsetsExternalReversalId: null,
    },
  ],
  "charge-dispute-created-ach": [
    {
      kind: "reversal", paymentIntentId: "pi_fixtureAch00000001", reversalKind: "ach_return", externalReversalId: "dp_fixtureReturn000001",
      amountCents: 10000, occurredAt: at(864000), offsetsExternalReversalId: null,
    },
  ],
  "charge-dispute-closed-won": [
    {
      kind: "reversal", paymentIntentId: "pi_fixturePaid000001", reversalKind: "reinstatement",
      externalReversalId: "dp_fixtureDispute00001:won", amountCents: 5000, occurredAt: at(4000000),
      offsetsExternalReversalId: "dp_fixtureDispute00001",
    },
  ],
  // The money-movement events (Batch 3a addendum). The dispute's own `created` is
  // 1790800000 here (an inquiry that escalated), the event is 864000 s into the
  // fixture clock: the funds moved when Stripe says they did.
  "charge-dispute-funds-withdrawn": [
    {
      kind: "reversal", paymentIntentId: "pi_fixturePaid000001", reversalKind: "dispute", externalReversalId: "dp_fixtureDispute00001",
      amountCents: 5000, occurredAt: at(864000), offsetsExternalReversalId: null,
    },
  ],
  "charge-dispute-funds-reinstated": [
    {
      kind: "reversal", paymentIntentId: "pi_fixturePaid000001", reversalKind: "reinstatement",
      externalReversalId: "dp_fixtureDispute00001:won", amountCents: 5000, occurredAt: at(4000000),
      offsetsExternalReversalId: "dp_fixtureDispute00001",
    },
  ],
  "customer-subscription-deleted": [
    { kind: "subscription", action: "ended", sessionId: null, subscriptionId: "sub_fixtureMonthly0001", donor: null, at: at(7776000) },
  ],
  "invoice-payment-failed": [
    { kind: "subscription", action: "payment_failed", sessionId: null, subscriptionId: "sub_fixtureMonthly0001", donor: null, at: at(5184000) },
  ],
  "payout-paid": [
    {
      kind: "settlement", externalSettlementId: "po_fixturePayout000001", status: "paid",
      arrivalDate: new Date(1790100000 * 1000).toISOString().slice(0, 10), grossCents: 12000, automatic: true,
    },
  ],
  "payout-failed": [
    {
      kind: "settlement", externalSettlementId: "po_fixturePayout000002", status: "failed",
      arrivalDate: new Date(1790200000 * 1000).toISOString().slice(0, 10), grossCents: 7500, automatic: true,
    },
  ],
  "account-updated-active": [
    {
      kind: "connection_status", deauthorized: false,
      status: {
        chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, cardEnabled: true, achEnabled: true,
        requirementsDue: false, disabledReason: null,
      },
    },
  ],
  "account-updated-restricted": [
    {
      kind: "connection_status", deauthorized: false,
      status: {
        chargesEnabled: false, payoutsEnabled: true, detailsSubmitted: true, cardEnabled: false, achEnabled: true,
        requirementsDue: true, disabledReason: null,
      },
    },
  ],
  "account-application-deauthorized": [
    {
      kind: "connection_status", deauthorized: true,
      status: {
        chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, cardEnabled: false, achEnabled: false,
        requirementsDue: false, disabledReason: null,
      },
    },
  ],
};

describe("normalize - one fixture per handled event type", () => {
  it("the table covers every fixture", () => {
    expect(Object.keys(TABLE).sort()).toEqual([...FIXTURE_NAMES].sort());
  });

  for (const name of FIXTURE_NAMES) {
    it(name, () => {
      expect(normalize(fixtureBody(name), EXPECTED)).toEqual(TABLE[name]);
    });
  }

  it("works without the expected (account, livemode) pair", () => {
    expect(normalize(fixtureBody("checkout-session-expired"))).toEqual(TABLE["checkout-session-expired"]);
  });
});

describe("normalize - the body is not trusted for authority (R9)", () => {
  it("ignores fund / membership / intent metadata entirely: the output has no field to carry it", () => {
    const body = fixtureBody("checkout-session-completed-payment", {
      patch(b) {
        const session = (b.data as { object: Record<string, unknown> }).object;
        session.metadata = {
          presby_intent_id: "00000000-0000-4000-8000-0000000000ff",
          fund_id: "11111111-1111-4111-8111-111111111111",
          membership_id: "22222222-2222-4222-8222-222222222222",
        };
        session.client_reference_id = "33333333-3333-4333-8333-333333333333";
      },
    });
    const [gift] = normalize(body, EXPECTED);
    expect(JSON.stringify(gift)).not.toContain("11111111-1111");
    expect(JSON.stringify(gift)).not.toContain("22222222-2222");
    expect(JSON.stringify(gift)).not.toContain("33333333-3333");
    expect(JSON.stringify(gift)).not.toContain("00000000-0000-4000-8000-0000000000ff");
    expect(gift).toEqual(TABLE["checkout-session-completed-payment"][0]);
  });

  it("a charge.succeeded carries only the balance-transaction id; a fee amount in the body is never read", () => {
    const body = fixtureBody("charge-succeeded", {
      patch(b) {
        Object.assign((b.data as { object: Record<string, unknown> }).object, { fee: 1, application_fee_amount: 99999, net: 5 });
      },
    });
    expect(normalize(body, EXPECTED)).toEqual(TABLE["charge-succeeded"]);
  });
});

describe("normalize - refusals (thrown, so the processor dead-letters them visibly)", () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(NormalizeError);
      return (err as NormalizeError).code;
    }
    throw new Error("expected a NormalizeError");
  };

  it("malformed JSON", () => {
    expect(code(() => normalize("{not json"))).toBe("malformed_json");
    expect(code(() => normalize(""))).toBe("malformed_json");
  });

  it("a body that is JSON but not an object", () => {
    expect(code(() => normalize("[1,2]"))).toBe("bad_shape");
    expect(code(() => normalize('"x"'))).toBe("bad_shape");
    expect(code(() => normalize("null"))).toBe("bad_shape");
  });

  it("the wrong api_version", () => {
    const body = fixtureBody("checkout-session-expired", { patch: (b) => void (b.api_version = "2020-08-27") });
    expect(code(() => normalize(body, EXPECTED))).toBe("api_version");
    const missing = fixtureBody("checkout-session-expired", { patch: (b) => void delete b.api_version });
    expect(code(() => normalize(missing, EXPECTED))).toBe("api_version");
  });

  it("a missing top-level account (a platform-scope event)", () => {
    const body = fixtureBody("checkout-session-expired", { patch: (b) => void delete b.account });
    expect(code(() => normalize(body, EXPECTED))).toBe("missing_account");
  });

  it("a body that disagrees with its own inbox row: account and livemode", () => {
    const flipped = fixtureBody("checkout-session-expired", { patch: (b) => void (b.livemode = true) });
    expect(code(() => normalize(flipped, EXPECTED))).toBe("livemode_mismatch");
    const other = fixtureBody("checkout-session-expired", { replacements: { [FIXTURE_ACCOUNT]: "acct_fixtureAccount0002" } });
    expect(code(() => normalize(other, EXPECTED))).toBe("account_mismatch");
  });

  it("an account.updated whose object is a different account than the event's", () => {
    const body = fixtureBody("account-updated-active", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.id = "acct_fixtureAccount0009"),
    });
    expect(code(() => normalize(body, EXPECTED))).toBe("account_mismatch");
  });

  it.each([
    ["a fractional amount", 50.5],
    ["a negative amount", -5000],
    ["a string amount", "5000"],
    ["an absurd amount", 10_000_000_000],
    ["a missing amount", undefined],
  ])("amount anomaly: %s", (_label, value) => {
    const body = fixtureBody("checkout-session-completed-payment", {
      patch(b) {
        const session = (b.data as { object: Record<string, unknown> }).object;
        if (value === undefined) delete session.amount_total;
        else session.amount_total = value;
      },
    });
    expect(code(() => normalize(body, EXPECTED))).toBe("bad_amount");
  });

  it("a payment-mode session with no PaymentIntent", () => {
    const body = fixtureBody("checkout-session-completed-payment", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.payment_intent = null),
    });
    expect(code(() => normalize(body, EXPECTED))).toBe("bad_shape");
  });

  it("a subscription-mode session with no subscription", () => {
    const body = fixtureBody("checkout-session-completed-subscription", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.subscription = null),
    });
    expect(code(() => normalize(body, EXPECTED))).toBe("bad_shape");
  });

  it("an event with no data.object", () => {
    const body = fixtureBody("checkout-session-expired", { patch: (b) => void (b.data = {}) });
    expect(code(() => normalize(body, EXPECTED))).toBe("bad_shape");
  });
});

describe("normalize - well-formed events that are simply not ours to record", () => {
  it("an unknown type is dropped", () => {
    const body = fixtureBody("checkout-session-expired", { patch: (b) => void (b.type = "customer.created") });
    expect(normalize(body, EXPECTED)).toEqual([]);
  });

  it("a non-USD payment is dropped (presby only ever creates USD sessions)", () => {
    const body = fixtureBody("checkout-session-completed-payment", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.currency = "eur"),
    });
    expect(normalize(body, EXPECTED)).toEqual([]);
    const refund = fixtureBody("refund-created", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.currency = "cad"),
    });
    expect(normalize(refund, EXPECTED)).toEqual([]);
    const payout = fixtureBody("payout-paid", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.currency = "eur"),
    });
    expect(normalize(payout, EXPECTED)).toEqual([]);
  });

  it("an upper-case USD is still USD", () => {
    const body = fixtureBody("checkout-session-completed-payment", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.currency = "USD"),
    });
    expect(normalize(body, EXPECTED)).toHaveLength(1);
  });

  it("a setup-mode session is not a gift", () => {
    const body = fixtureBody("checkout-session-completed-payment", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.mode = "setup"),
    });
    expect(normalize(body, EXPECTED)).toEqual([]);
  });

  it("a no_payment_required session is not a gift", () => {
    const body = fixtureBody("checkout-session-completed-payment", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.payment_status = "no_payment_required"),
    });
    expect(normalize(body, EXPECTED)).toEqual([]);
  });

  it("an invoice payment made out of band, or for nothing, is not a card/ACH gift", () => {
    const oob = fixtureBody("invoice-payment-paid", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.payment = { type: "out_of_band" }),
    });
    expect(normalize(oob, EXPECTED)).toEqual([]);
    const zero = fixtureBody("invoice-payment-paid", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.amount_paid = 0),
    });
    expect(normalize(zero, EXPECTED)).toEqual([]);
  });

  it("a charge with no balance transaction yet (pending ACH) or no PaymentIntent has nothing to record", () => {
    const pending = fixtureBody("charge-succeeded", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.balance_transaction = null),
    });
    expect(normalize(pending, EXPECTED)).toEqual([]);
    const noPi = fixtureBody("charge-succeeded", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.payment_intent = null),
    });
    expect(normalize(noPi, EXPECTED)).toEqual([]);
  });

  it("a refund that is still pending, or has no PaymentIntent, is not recorded", () => {
    const pending = fixtureBody("refund-created", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.status = "pending"),
    });
    expect(normalize(pending, EXPECTED)).toEqual([]);
    const noPi = fixtureBody("refund-created", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.payment_intent = null),
    });
    expect(normalize(noPi, EXPECTED)).toEqual([]);
  });

  it("refund.created for a failed refund does NOT reinstate (only refund.updated does)", () => {
    const body = fixtureBody("refund-updated-failed", { patch: (b) => void (b.type = "refund.created") });
    expect(normalize(body, EXPECTED)).toEqual([]);
  });

  it("a refund.updated to succeeded records the refund, keyed by the refund's own id", () => {
    const body = fixtureBody("refund-updated-failed", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.status = "succeeded"),
    });
    const [event] = normalize(body, EXPECTED);
    expect(event).toMatchObject({ reversalKind: "refund", externalReversalId: "re_fixtureRefund000001" });
  });

  it("a dispute that is only a warning moves no funds and is not recorded", () => {
    const body = fixtureBody("charge-dispute-created", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.status = "warning_needs_response"),
    });
    expect(normalize(body, EXPECTED)).toEqual([]);
  });

  it("funds_withdrawn records the same reversal as created, keyed on the dispute id, whatever the dispute status says", () => {
    const created = normalize(fixtureBody("charge-dispute-created"), EXPECTED);
    const withdrawn = normalize(fixtureBody("charge-dispute-funds-withdrawn"), EXPECTED);
    expect(withdrawn).toEqual(created); // same id, kind, amount, time: whichever arrives first records it, the other is a noop
    // An inquiry that escalates is withdrawn with its dispute object still carrying an early status: the event is the fact.
    const inquiry = fixtureBody("charge-dispute-funds-withdrawn", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.status = "warning_needs_response"),
    });
    expect(normalize(inquiry, EXPECTED)).toEqual(created);
  });

  it("funds_withdrawn on a bank debit is an ach_return, like created", () => {
    const body = fixtureBody("charge-dispute-funds-withdrawn", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.payment_method_details = { type: "us_bank_account" }),
    });
    expect(normalize(body, EXPECTED)).toMatchObject([{ reversalKind: "ach_return", externalReversalId: "dp_fixtureDispute00001" }]);
  });

  it("funds_reinstated and closed:won are the SAME reinstatement (one key, so the second delivery is a noop)", () => {
    expect(normalize(fixtureBody("charge-dispute-funds-reinstated"), EXPECTED)).toEqual(
      normalize(fixtureBody("charge-dispute-closed-won"), EXPECTED),
    );
  });

  it("the dispute money events skip a non-USD dispute and refuse a zero amount", () => {
    for (const name of ["charge-dispute-funds-withdrawn", "charge-dispute-funds-reinstated"] as const) {
      const eur = fixtureBody(name, { patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.currency = "eur") });
      expect(normalize(eur, EXPECTED), name).toEqual([]);
      const zero = fixtureBody(name, { patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.amount = 0) });
      expect(() => normalize(zero, EXPECTED), name).toThrow(NormalizeError);
    }
  });

  it("a dispute closed as lost leaves the reversal in place", () => {
    const body = fixtureBody("charge-dispute-closed-won", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.status = "lost"),
    });
    expect(normalize(body, EXPECTED)).toEqual([]);
  });

  it("a subscription-less invoice payment failure is not a recurring gift", () => {
    const body = fixtureBody("invoice-payment-failed", {
      patch: (b) => void delete (b.data as { object: Record<string, unknown> }).object.parent,
    });
    expect(normalize(body, EXPECTED)).toEqual([]);
  });

  it("the pre-basil `invoice.subscription` field still resolves a failed payment's subscription", () => {
    const body = fixtureBody("invoice-payment-failed", {
      patch(b) {
        const invoice = (b.data as { object: Record<string, unknown> }).object;
        delete invoice.parent;
        invoice.subscription = "sub_fixtureLegacy00001";
      },
    });
    expect(normalize(body, EXPECTED)).toMatchObject([{ kind: "subscription", subscriptionId: "sub_fixtureLegacy00001" }]);
  });

  it("a wallet card is reported as a wallet", () => {
    const body = fixtureBody("charge-succeeded", {
      patch(b) {
        const charge = (b.data as { object: { payment_method_details: { card: Record<string, unknown> } } }).object;
        charge.payment_method_details.card.wallet = { type: "apple_pay" };
      },
    });
    expect(normalize(body, EXPECTED)).toMatchObject([{ method: "wallet" }]);
  });

  it("an ACH charge is us_bank_account", () => {
    const body = fixtureBody("charge-succeeded", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.payment_method_details = { type: "us_bank_account" }),
    });
    expect(normalize(body, EXPECTED)).toMatchObject([{ method: "us_bank_account" }]);
  });
});

describe("normalize - donor details are passed through untouched for SQL to clean", () => {
  it("keeps hostile text as text (it is bounded and stripped in SQL, escaped by React, never interpolated)", () => {
    const body = fixtureBody("checkout-session-completed-payment", {
      patch(b) {
        const session = (b.data as { object: Record<string, unknown> }).object;
        session.customer_details = { name: "<script>alert(1)</script>", email: "x@example.invalid", address: null };
      },
    });
    const [gift] = normalize(body, EXPECTED);
    expect(gift).toMatchObject({ donor: { name: "<script>alert(1)</script>", address: { line1: null, postal: null } } });
  });

  it("a missing customer is an empty external id (SQL then skips the identity row)", () => {
    const body = fixtureBody("checkout-session-completed-payment", {
      patch: (b) => void ((b.data as { object: Record<string, unknown> }).object.customer = null),
    });
    expect(normalize(body, EXPECTED)).toMatchObject([{ donor: { externalCustomerId: "" } }]);
  });
});
