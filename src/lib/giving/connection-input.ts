import { z } from "zod";

/**
 * Validation for the one editable part of a connection: the processor's fee
 * rates (G21). Pure - no `server-only`, no database - so the form (3b) and the
 * action share one definition. The bounds are `giving_connections_fee_bounds`
 * in `drizzle/0055` (the database CHECK is the backstop; this gives the
 * treasurer a field-level message instead of a constraint error):
 *
 *   card_fee_bps 0..1000   card_fee_fixed_cents 0..100
 *   ach_fee_bps  0..500    ach_fee_cap_cents    0..2000
 *
 * Rates are a DISPLAY and PRICING input only: they decide how much extra a
 * donor who chooses to cover fees is asked to add. They never change what
 * Stripe charges the congregation, and they are not secret.
 */

const whole = (label: string, min: number, max: number) =>
  z
    .number({
      // `undefined` (a missing key) is "required"; every other type failure -
      // NaN from an emptied number input, null, a string - is "whole number".
      error: (iss) =>
        iss.input === undefined ? `${label} is required.` : `${label} must be a whole number.`,
    })
    // Not `.int()`: zod 4's `.int()` also rejects integers beyond +/-2^53 as a
    // type failure, which would put "whole number" ahead of "between ..." for a
    // huge value. This keeps zod 3's first message (DECISION-224, F229).
    .refine((n) => Number.isInteger(n), { message: `${label} must be a whole number.` })
    .min(min, { message: `${label} must be between ${min} and ${max}.` })
    .max(max, { message: `${label} must be between ${min} and ${max}.` });

export const connectionRatesSchema = z.object({
  cardFeeBps: whole("Card percentage (basis points)", 0, 1000),
  cardFeeFixedCents: whole("Card fixed fee (cents)", 0, 100),
  achFeeBps: whole("Bank percentage (basis points)", 0, 500),
  achFeeCapCents: whole("Bank fee cap (cents)", 0, 2000),
});

export type ConnectionRates = z.infer<typeof connectionRatesSchema>;

export const CONNECTION_RATE_FIELDS = ["cardFeeBps", "cardFeeFixedCents", "achFeeBps", "achFeeCapCents"] as const;
