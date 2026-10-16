import type { DonorDetails, GiftMethod, NormalizedEvent } from "../../types";
import { STRIPE_API_VERSION } from "./constants";
import { mapAccountSnapshotToStatus, type V1AccountSnapshot } from "./status";

/**
 * Stripe event body -> provider-neutral `NormalizedEvent[]` - docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "`NormalizedEvent`" and its event-type
 * -> kind map. PURE: no network, no database, no `stripe` runtime import. The
 * processor feeds the result, in order, to the SECURITY DEFINER apply
 * functions; nothing downstream knows the events came from Stripe.
 *
 * WHAT THIS DOES NOT DO (R9). A normalized `gift` carries NO fund and NO
 * membership: both come from presby's own checkout-intent row, found by the
 * Checkout session id or the subscription id. Stripe `metadata` is never read
 * here - a body that names a foreign fund id changes nothing, because nothing
 * in this file looks. A `gift_fee` carries the balance-transaction id only; the
 * processor retrieves the numbers through the allowlist. An
 * `invoice_payment.paid` normalizes to a gift with no subscription and no donor
 * and the processor COMPLETES it (P3-9).
 *
 * SHAPE ERRORS ARE THROWN, not skipped. A body that is not JSON, names the
 * wrong API version, or lacks a field a handled type cannot do without throws a
 * `NormalizeError` carrying a code; the processor finishes the event dead with
 * that code, which is visible to the operator. An event type we are not
 * subscribed to returns `[]` (the route drops those before the inbox, so this
 * is defence in depth). A well-formed event that is simply not ours to record -
 * a non-USD amount, a refund with no PaymentIntent, a dispute that is only a
 * warning, an invoice payment made out of band - returns `[]` too.
 *
 * `expected`, when given, is the (account, livemode) pair of the inbox row the
 * body was stored against; a body that disagrees with its own row is refused
 * rather than trusted.
 */

export type NormalizeErrorCode =
  | "malformed_json"
  | "api_version"
  | "bad_shape"
  | "missing_account"
  | "account_mismatch"
  | "livemode_mismatch"
  | "bad_amount";

export class NormalizeError extends Error {
  readonly code: NormalizeErrorCode;
  constructor(code: NormalizeErrorCode) {
    super(`normalize: ${code}`);
    this.name = "NormalizeError";
    this.code = code;
  }
}

type Json = Record<string, unknown>;

const MAX_AMOUNT_CENTS = 100_000_000;
const NO_STATUS = {
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  cardEnabled: false,
  achEnabled: false,
  requirementsDue: false,
  disabledReason: null,
} as const;

// ---- small, defensive readers ---------------------------------------------

function rec(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
/** An id that Stripe may send as a string or, when expanded, as an object with `id`. */
function idOf(value: unknown): string | null {
  return str(value) ?? str(rec(value)?.id);
}
function cents(value: unknown): number {
  const v = num(value);
  if (v === null || !Number.isSafeInteger(v) || v < 0 || v > MAX_AMOUNT_CENTS) {
    throw new NormalizeError("bad_amount");
  }
  return v;
}
function seconds(value: unknown): Date | null {
  const v = num(value);
  return v === null || v <= 0 ? null : new Date(v * 1000);
}
function requireSeconds(value: unknown): Date {
  const d = seconds(value);
  if (!d) throw new NormalizeError("bad_shape");
  return d;
}
function isUsd(value: unknown): boolean {
  return typeof value === "string" && value.toLowerCase() === "usd";
}

function donorFrom(customerId: string | null, details: unknown): DonorDetails {
  const d = rec(details) ?? {};
  const a = rec(d.address) ?? {};
  return {
    externalCustomerId: customerId ?? "",
    name: str(d.name),
    email: str(d.email),
    address: {
      line1: str(a.line1),
      line2: str(a.line2),
      city: str(a.city),
      region: str(a.state),
      postal: str(a.postal_code),
      country: str(a.country),
    },
  };
}

function sessionMethod(session: Json, paymentStatus: string | null): GiftMethod | null {
  const types = Array.isArray(session.payment_method_types) ? session.payment_method_types : [];
  if (types.length === 1 && types[0] === "card") return "card";
  if (types.length === 1 && types[0] === "us_bank_account") return "us_bank_account";
  if (paymentStatus === "paid") return "card";
  if (paymentStatus === "unpaid") return "us_bank_account";
  return null;
}

// ---- the entry point -------------------------------------------------------

export function normalize(
  rawBody: string,
  expected?: { accountId: string; livemode: boolean },
): NormalizedEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new NormalizeError("malformed_json");
  }
  const event = rec(parsed);
  if (!event) throw new NormalizeError("bad_shape");

  if (event.api_version !== STRIPE_API_VERSION) throw new NormalizeError("api_version");

  const type = str(event.type);
  const eventId = str(event.id);
  if (!type || !eventId) throw new NormalizeError("bad_shape");

  const account = str(event.account);
  if (!account) throw new NormalizeError("missing_account");
  if (typeof event.livemode !== "boolean") throw new NormalizeError("bad_shape");
  if (expected && account !== expected.accountId) throw new NormalizeError("account_mismatch");
  if (expected && event.livemode !== expected.livemode) throw new NormalizeError("livemode_mismatch");

  const createdAt = seconds(event.created);
  const object = rec(rec(event.data)?.object);
  if (!object) throw new NormalizeError("bad_shape");

  switch (type) {
    case "checkout.session.completed":
      return checkoutCompleted(object, requireDate(createdAt));
    case "checkout.session.async_payment_succeeded":
      return checkoutAsync(object, requireDate(createdAt), "succeeded");
    case "checkout.session.async_payment_failed":
      return checkoutAsync(object, requireDate(createdAt), "failed");
    case "checkout.session.expired": {
      const sessionId = str(object.id);
      if (!sessionId) throw new NormalizeError("bad_shape");
      return [{ kind: "intent_expired", sessionId }];
    }
    case "invoice_payment.paid":
      return invoicePaymentPaid(object, createdAt);
    case "charge.succeeded":
      return chargeSucceeded(object);
    case "refund.created":
    case "refund.updated":
      return refund(object, type, createdAt);
    case "charge.dispute.created":
      return disputeCreated(object);
    case "charge.dispute.closed":
      return disputeClosed(object, createdAt);
    case "customer.subscription.deleted":
      return subscriptionDeleted(object, requireDate(createdAt));
    case "invoice.payment_failed":
      return invoicePaymentFailed(object, requireDate(createdAt));
    case "payout.paid":
      return payout(object, "paid");
    case "payout.failed":
      return payout(object, "failed");
    case "account.updated":
      return accountUpdated(object, account);
    case "account.application.deauthorized":
      return [{ kind: "connection_status", status: { ...NO_STATUS }, deauthorized: true }];
    default:
      return [];
  }
}

function requireDate(value: Date | null): Date {
  if (!value) throw new NormalizeError("bad_shape");
  return value;
}

// ---- Checkout --------------------------------------------------------------

function checkoutCompleted(session: Json, eventAt: Date): NormalizedEvent[] {
  const sessionId = str(session.id);
  if (!sessionId) throw new NormalizeError("bad_shape");
  const mode = str(session.mode);
  const customerId = idOf(session.customer);

  if (mode === "subscription") {
    const subscriptionId = idOf(session.subscription);
    if (!subscriptionId) throw new NormalizeError("bad_shape");
    return [
      {
        kind: "subscription",
        action: "started",
        sessionId,
        subscriptionId,
        donor: donorFrom(customerId, session.customer_details),
        at: eventAt,
      },
    ];
  }
  if (mode !== "payment") return []; // setup mode: not a gift

  const paymentStatus = str(session.payment_status);
  if (paymentStatus !== "paid" && paymentStatus !== "unpaid") return []; // no_payment_required
  if (!isUsd(session.currency)) return [];

  const paymentIntentId = idOf(session.payment_intent);
  if (!paymentIntentId) throw new NormalizeError("bad_shape");
  return [
    {
      kind: "gift",
      status: paymentStatus === "paid" ? "succeeded" : "pending",
      sessionId,
      subscriptionId: null,
      invoiceId: null,
      paymentIntentId,
      amountCents: cents(session.amount_total),
      authorizedAt: eventAt,
      failureCode: null,
      method: sessionMethod(session, paymentStatus),
      donor: donorFrom(customerId, session.customer_details),
    },
  ];
}

function checkoutAsync(session: Json, eventAt: Date, status: "succeeded" | "failed"): NormalizedEvent[] {
  const sessionId = str(session.id);
  if (!sessionId) throw new NormalizeError("bad_shape");
  if (str(session.mode) !== "payment") return [];
  if (!isUsd(session.currency)) return [];
  const paymentIntentId = idOf(session.payment_intent);
  if (!paymentIntentId) throw new NormalizeError("bad_shape");
  return [
    {
      kind: "gift",
      status,
      sessionId,
      subscriptionId: null,
      invoiceId: null,
      paymentIntentId,
      amountCents: cents(session.amount_total),
      authorizedAt: eventAt,
      failureCode: status === "failed" ? "async_payment_failed" : null,
      method: "us_bank_account", // only a delayed-notification method reaches an async event
      donor: donorFrom(idOf(session.customer), session.customer_details),
    },
  ];
}

// ---- Invoices (recurring gifts) --------------------------------------------

function invoicePaymentPaid(payment: Json, eventAt: Date | null): NormalizedEvent[] {
  const pay = rec(payment.payment);
  if (str(pay?.type) !== "payment_intent") return []; // out of band: not a card/ACH payment
  const paymentIntentId = idOf(pay?.payment_intent);
  const invoiceId = idOf(payment.invoice);
  if (!paymentIntentId || !invoiceId) throw new NormalizeError("bad_shape");
  if (!isUsd(payment.currency)) return [];
  const amountCents = cents(payment.amount_paid);
  if (amountCents === 0) return [];
  const paidAt = seconds(rec(payment.status_transitions)?.paid_at) ?? seconds(payment.created) ?? eventAt;
  return [
    {
      kind: "gift",
      status: "succeeded",
      sessionId: null,
      subscriptionId: null, // completed by retrieveInvoiceForPayment (P3-9)
      invoiceId,
      paymentIntentId,
      amountCents,
      authorizedAt: requireDate(paidAt),
      failureCode: null,
      method: null,
      donor: null,
    },
  ];
}

function invoicePaymentFailed(invoice: Json, eventAt: Date): NormalizedEvent[] {
  const parent = rec(rec(invoice.parent)?.subscription_details);
  const subscriptionId = idOf(parent?.subscription) ?? idOf(invoice.subscription);
  if (!subscriptionId) return []; // not a subscription invoice
  return [{ kind: "subscription", action: "payment_failed", sessionId: null, subscriptionId, donor: null, at: eventAt }];
}

function subscriptionDeleted(subscription: Json, eventAt: Date): NormalizedEvent[] {
  const subscriptionId = str(subscription.id);
  if (!subscriptionId) throw new NormalizeError("bad_shape");
  const at = seconds(subscription.ended_at) ?? seconds(subscription.canceled_at) ?? eventAt;
  return [{ kind: "subscription", action: "ended", sessionId: null, subscriptionId, donor: null, at }];
}

// ---- Fees ------------------------------------------------------------------

function chargeSucceeded(charge: Json): NormalizedEvent[] {
  const paymentIntentId = idOf(charge.payment_intent);
  const balanceTransactionId = idOf(charge.balance_transaction);
  // A charge with no PaymentIntent is not one of ours; a pending ACH charge has
  // no balance transaction yet and its fee arrives with the succeeded charge.
  if (!paymentIntentId || !balanceTransactionId) return [];
  const details = rec(charge.payment_method_details);
  const kind = str(details?.type);
  let method: GiftMethod | "wallet" | null = null;
  // `card.wallet` is an OBJECT (`{ type: "apple_pay", ... }`) when a wallet was used, else null.
  if (kind === "card") method = rec(rec(details?.card)?.wallet) ? "wallet" : "card";
  else if (kind === "us_bank_account") method = "us_bank_account";
  return [{ kind: "gift_fee", paymentIntentId, balanceTransactionId, method }];
}

// ---- Reversals -------------------------------------------------------------

function refund(
  object: Json,
  type: "refund.created" | "refund.updated",
  eventAt: Date | null,
): NormalizedEvent[] {
  const refundId = str(object.id);
  if (!refundId) throw new NormalizeError("bad_shape");
  const paymentIntentId = idOf(object.payment_intent);
  if (!paymentIntentId) return []; // a charge-only refund: no PaymentIntent to key a gift on
  if (!isUsd(object.currency)) return [];
  const status = str(object.status);
  const occurredAt = seconds(object.created);

  if (status === "succeeded") {
    return [
      {
        kind: "reversal",
        paymentIntentId,
        reversalKind: "refund",
        externalReversalId: refundId,
        amountCents: positive(object.amount),
        occurredAt: requireDate(occurredAt),
        offsetsExternalReversalId: null,
      },
    ];
  }
  if (type === "refund.updated" && (status === "failed" || status === "canceled")) {
    // A refund that was recorded as succeeded and then failed is reinstated.
    // One that never succeeded has nothing to offset; the processor ignores
    // that after a short grace (parked:no_reversal).
    return [
      {
        kind: "reversal",
        paymentIntentId,
        reversalKind: "reinstatement",
        externalReversalId: `${refundId}:failed`,
        amountCents: positive(object.amount),
        occurredAt: requireDate(eventAt ?? occurredAt),
        offsetsExternalReversalId: refundId,
      },
    ];
  }
  return [];
}

function disputeCreated(dispute: Json): NormalizedEvent[] {
  const disputeId = str(dispute.id);
  if (!disputeId) throw new NormalizeError("bad_shape");
  const paymentIntentId = idOf(dispute.payment_intent);
  if (!paymentIntentId) return [];
  if (!isUsd(dispute.currency)) return [];
  // A `warning_*` status is an inquiry: no funds have moved, so nothing is
  // recorded. (If it escalates, the money movement is a separate event the
  // endpoint is not subscribed to - tracked as an open question.)
  if ((str(dispute.status) ?? "").startsWith("warning_")) return [];
  const method = str(rec(dispute.payment_method_details)?.type);
  return [
    {
      kind: "reversal",
      paymentIntentId,
      reversalKind: method === "us_bank_account" ? "ach_return" : "dispute",
      externalReversalId: disputeId,
      amountCents: positive(dispute.amount),
      occurredAt: requireDate(seconds(dispute.created)),
      offsetsExternalReversalId: null,
    },
  ];
}

function disputeClosed(dispute: Json, eventAt: Date | null): NormalizedEvent[] {
  const disputeId = str(dispute.id);
  if (!disputeId) throw new NormalizeError("bad_shape");
  if (str(dispute.status) !== "won") return []; // lost: the reversal stands
  const paymentIntentId = idOf(dispute.payment_intent);
  if (!paymentIntentId) return [];
  if (!isUsd(dispute.currency)) return [];
  // The reinstatement happened when the dispute closed: the event's own time.
  return [
    {
      kind: "reversal",
      paymentIntentId,
      reversalKind: "reinstatement",
      externalReversalId: `${disputeId}:won`,
      amountCents: positive(dispute.amount),
      occurredAt: requireDate(eventAt),
      offsetsExternalReversalId: disputeId,
    },
  ];
}

function positive(value: unknown): number {
  const v = cents(value);
  if (v < 1) throw new NormalizeError("bad_amount");
  return v;
}

// ---- Payouts and the account -----------------------------------------------

function payout(object: Json, status: "paid" | "failed"): NormalizedEvent[] {
  const externalSettlementId = str(object.id);
  if (!externalSettlementId) throw new NormalizeError("bad_shape");
  if (!isUsd(object.currency)) return [];
  const arrival = seconds(object.arrival_date);
  return [
    {
      kind: "settlement",
      externalSettlementId,
      status,
      arrivalDate: arrival ? arrival.toISOString().slice(0, 10) : null,
      grossCents: cents(object.amount),
      automatic: object.automatic !== false,
    },
  ];
}

function accountUpdated(object: Json, eventAccount: string): NormalizedEvent[] {
  const id = str(object.id);
  if (id && id !== eventAccount) throw new NormalizeError("account_mismatch");
  return [
    {
      kind: "connection_status",
      status: mapAccountSnapshotToStatus(object as V1AccountSnapshot),
      deauthorized: false,
    },
  ];
}
