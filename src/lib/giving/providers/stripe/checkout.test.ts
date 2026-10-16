import { describe, expect, it } from "vitest";
import { buildCheckoutParams, checkoutExpiresAt, CHECKOUT_TTL_MINUTES, type CheckoutInput } from "./checkout";

const BASE: CheckoutInput = {
  mode: "payment",
  totalCents: 5181,
  coveredFeeCents: 181,
  fundDisplayName: "General Fund",
  methods: ["card"],
  intentId: "00000000-0000-4000-8000-000000000001",
  successUrl: "https://example.invalid/site/alder/give/return?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://example.invalid/site/alder/give",
  expiresAt: new Date(1790000000 * 1000),
};

describe("buildCheckoutParams - payment mode", () => {
  it("is exactly the Phase 3 shape", () => {
    expect(buildCheckoutParams(BASE)).toEqual({
      mode: "payment",
      submit_type: "donate",
      customer_creation: "always",
      payment_intent_data: { metadata: { presby_intent_id: BASE.intentId } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: 5181,
            product_data: { name: "General Fund", description: "Includes $1.81 to cover processing fees" },
          },
        },
      ],
      billing_address_collection: "required",
      allowed_payment_method_types: ["card"],
      client_reference_id: BASE.intentId,
      metadata: { presby_intent_id: BASE.intentId },
      success_url: BASE.successUrl,
      cancel_url: BASE.cancelUrl,
      expires_at: 1790000000,
    });
  });

  it("describes a covered fee only when there is one", () => {
    const params = buildCheckoutParams({ ...BASE, totalCents: 5000, coveredFeeCents: 0 });
    expect(params.line_items![0]!.price_data!.product_data).toEqual({ name: "General Fund" });
  });

  it("maps bank to Stripe's us_bank_account, de-duplicates, and keeps card", () => {
    expect(buildCheckoutParams({ ...BASE, methods: ["bank"] }).allowed_payment_method_types).toEqual(["us_bank_account"]);
    expect(buildCheckoutParams({ ...BASE, methods: ["card", "bank", "card"] }).allowed_payment_method_types).toEqual([
      "card",
      "us_bank_account",
    ]);
  });
});

describe("buildCheckoutParams - subscription mode", () => {
  it("is a monthly recurring price and puts the intent on the subscription, with no payment-only fields", () => {
    const params = buildCheckoutParams({ ...BASE, mode: "subscription" });
    expect(params.mode).toBe("subscription");
    expect(params.line_items![0]!.price_data!.recurring).toEqual({ interval: "month" });
    expect(params.subscription_data).toEqual({ metadata: { presby_intent_id: BASE.intentId } });
    expect(params).not.toHaveProperty("submit_type");
    expect(params).not.toHaveProperty("customer_creation");
    expect(params).not.toHaveProperty("payment_intent_data");
  });
});

describe("buildCheckoutParams - refusals and hygiene", () => {
  it.each([0, 99, 12.5, -100, Number.NaN, Number.MAX_SAFE_INTEGER + 2])("refuses a total of %s", (totalCents) => {
    expect(() => buildCheckoutParams({ ...BASE, totalCents })).toThrow(RangeError);
  });

  it("refuses a negative or fractional covered fee, and an empty method list", () => {
    expect(() => buildCheckoutParams({ ...BASE, coveredFeeCents: -1 })).toThrow(RangeError);
    expect(() => buildCheckoutParams({ ...BASE, coveredFeeCents: 1.5 })).toThrow(RangeError);
    expect(() => buildCheckoutParams({ ...BASE, methods: [] })).toThrow(RangeError);
  });

  it("strips control characters from, and bounds, the fund name Stripe shows", () => {
    const params = buildCheckoutParams({ ...BASE, fundDisplayName: `Mis\u0000sions\n${"x".repeat(400)}` });
    const name = params.line_items![0]!.price_data!.product_data!.name;
    expect(name).not.toMatch(/[\u0000-\u001f]/);
    expect(name.length).toBeLessThanOrEqual(250);
  });

  it("falls back to 'Gift' for a name that is only control characters", () => {
    expect(buildCheckoutParams({ ...BASE, fundDisplayName: "\u0001\u0002" }).line_items![0]!.price_data!.product_data!.name).toBe("Gift");
  });

  it("uses no payment_method_types (removed from the pinned API version) and no Stripe Product ids", () => {
    const json = JSON.stringify(buildCheckoutParams(BASE));
    expect(json).not.toContain('"payment_method_types"');
    expect(json).not.toContain('"product":');
    expect(json).not.toContain('"price":');
  });
});

describe("checkoutExpiresAt", () => {
  it("is comfortably past Stripe's 30-minute minimum, measured from when Stripe receives the request", () => {
    expect(CHECKOUT_TTL_MINUTES).toBeGreaterThan(30);
    const now = new Date("2026-10-15T12:00:00.000Z");
    expect(checkoutExpiresAt(now).toISOString()).toBe("2026-10-15T12:31:00.000Z");
  });

  it("is below Stripe's 24-hour maximum", () => {
    expect(CHECKOUT_TTL_MINUTES).toBeLessThan(24 * 60);
  });
});
