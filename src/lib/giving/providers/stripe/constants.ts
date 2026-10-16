/**
 * Constants shared by the Stripe adapter's pure modules and by the webhook
 * route. NO imports - this file must stay loadable without the `stripe`
 * package (the route reads the handled-type set before it ever touches the
 * SDK, and `normalize.ts` is pure).
 */

/**
 * The Stripe API version presby is written against (DECISION-169). The SDK
 * (`stripe@23.0.0`) pins the same value; `client.test.ts` asserts the two are
 * equal and fails if a dependency bump moves the SDK. The webhook endpoint
 * must be created at this version (docs/deployment.md) - a body whose
 * `api_version` differs is finished dead with `api_version`.
 */
export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

/**
 * The event types the webhook endpoint is subscribed to, and the only ones the
 * route stores. Anything else is acknowledged and dropped before the inbox
 * (Phase 3 "Event-type -> kind map"). The deployment runbook lists exactly
 * these sixteen; `constants.test.ts` pins the list against that runbook.
 */
export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "invoice_payment.paid",
  "charge.succeeded",
  "refund.created",
  "refund.updated",
  "charge.dispute.created",
  "charge.dispute.closed",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "payout.paid",
  "payout.failed",
  "account.updated",
  "account.application.deauthorized",
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

const HANDLED_SET: ReadonlySet<string> = new Set(HANDLED_EVENT_TYPES);

export function isHandledEventType(type: string): type is HandledEventType {
  return HANDLED_SET.has(type);
}

/** Signature tolerance (seconds) for `constructEvent` - Stripe's own default. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
