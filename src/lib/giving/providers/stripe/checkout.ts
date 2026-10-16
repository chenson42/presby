import type Stripe from "stripe";
import { formatCents } from "../../money";

/**
 * The Checkout Session request - docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 allowlist (`createCheckoutSession`). PURE builder; `client.ts` sends
 * it with `{ stripeAccount, idempotencyKey }`.
 *
 * NOTHING here is an authority. The total, the covered fee and the fund name
 * arrive from the database (`presby_giving_create_intent_*` computes the total;
 * the fund name is the fund's own display text), and the metadata Stripe
 * returns is correlation only - a gift is recorded against presby's own intent
 * row, never against anything read back out of metadata (R9).
 *
 * One inline `price_data` line item, so no Stripe Product per fund exists.
 * `payment` mode: donation wording on the button, a Customer created for every
 * session (the donor's receipt and, later, their subscription history), the
 * intent id copied onto the PaymentIntent. `subscription` mode: the same line
 * item as a monthly recurring price, the intent id copied onto the subscription.
 */

export type CheckoutParams = Stripe.Checkout.SessionCreateParams;

export interface CheckoutInput {
  mode: "payment" | "subscription";
  /** Charged to the donor, in cents - the database's figure, not the form's. */
  totalCents: number;
  /** The part of `totalCents` that is the donor covering processing fees (0 if none). */
  coveredFeeCents: number;
  fundDisplayName: string;
  /** Which payment methods Checkout may offer; `bank` is Stripe's `us_bank_account`. */
  methods: ReadonlyArray<"card" | "bank">;
  intentId: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

/**
 * Stripe requires `expires_at` to be 30 minutes to 24 hours after the session
 * is CREATED, and the clock starts when Stripe receives the request, not when
 * we computed it. Phase 3 says "now + 30 min"; computed exactly that, a few
 * hundred milliseconds of latency makes it 29:59 and Stripe refuses. One extra
 * minute is the whole margin.
 */
export const CHECKOUT_TTL_MINUTES = 31;

export function checkoutExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + CHECKOUT_TTL_MINUTES * 60_000);
}

function methodTypes(methods: CheckoutInput["methods"]): Array<"card" | "us_bank_account"> {
  const out = new Set<"card" | "us_bank_account">();
  for (const method of methods) out.add(method === "bank" ? "us_bank_account" : "card");
  return [...out];
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function buildCheckoutParams(input: CheckoutInput): CheckoutParams {
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents < 100) {
    throw new RangeError("checkout: totalCents must be an integer of at least 100");
  }
  if (!Number.isSafeInteger(input.coveredFeeCents) || input.coveredFeeCents < 0) {
    throw new RangeError("checkout: coveredFeeCents must be a non-negative integer");
  }
  const types = methodTypes(input.methods);
  if (types.length === 0) throw new RangeError("checkout: at least one payment method is required");

  const name = input.fundDisplayName.replace(CONTROL_CHARS, " ").trim().slice(0, 250) || "Gift";
  const description =
    input.coveredFeeCents > 0
      ? `Includes ${formatCents(input.coveredFeeCents)} to cover processing fees`
      : undefined;

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: input.totalCents,
      product_data: { name, ...(description ? { description } : {}) },
      ...(input.mode === "subscription" ? { recurring: { interval: "month" as const } } : {}),
    },
  };

  const common: CheckoutParams = {
    line_items: [lineItem],
    billing_address_collection: "required",
    // `payment_method_types` was REMOVED from Checkout.SessionCreateParams in the
    // pinned API version (stripe-node 23.0.0 CHANGELOG); `allowed_payment_method_types`
    // replaces it as a FILTER over the methods the connected account's own
    // settings make eligible, which is exactly the "only what the treasurer
    // enabled and the donor chose" behaviour we need.
    allowed_payment_method_types: types,
    client_reference_id: input.intentId,
    metadata: { presby_intent_id: input.intentId },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    expires_at: Math.floor(input.expiresAt.getTime() / 1000),
  };

  if (input.mode === "payment") {
    return {
      ...common,
      mode: "payment",
      submit_type: "donate",
      customer_creation: "always",
      payment_intent_data: { metadata: { presby_intent_id: input.intentId } },
    };
  }
  return {
    ...common,
    mode: "subscription",
    subscription_data: { metadata: { presby_intent_id: input.intentId } },
  };
}
