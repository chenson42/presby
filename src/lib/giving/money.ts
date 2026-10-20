/**
 * Money, in integer cents — docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "Pure helpers" and the amount-tampering row of the adversarial table.
 *
 * PURE: no imports, no `server-only`, safe in the client bundle. A user-typed
 * amount is a STRING that is parsed exactly once, here; the database
 * recomputes everything that matters (`presby_giving_gross_up()` for the
 * charged total) and the server action uses the database's numbers. Nothing in
 * this file is an authority — `grossUp()` is DISPLAY ONLY (the give form's
 * live "gift + fees = total" line), pinned digit-for-digit to the SQL function
 * by `money.db.test.ts`.
 */

export type AmountKind = "online" | "offline";

/** Inclusive bounds, in cents. Online: $1.00 to $25,000.00 (the intent CHECKs
 * and `presby_public_giving_config`'s min/max). Offline: 1 cent to
 * $1,000,000.00 (`presby_giving_record_offline_gift`'s range check). */
export const AMOUNT_BOUNDS: Record<AmountKind, { min: number; max: number }> = {
  online: { min: 100, max: 2_500_000 },
  offline: { min: 1, max: 100_000_000 },
};

/** The most integer digits an amount of each kind can have and still be in
 * range. Anything longer is "too_large", not "format" (a donor who typed
 * 250001 deserves "that is more than we can take", not "that isn't a number"). */
const MAX_INTEGER_DIGITS = 12;

export type ParseAmountResult =
  | { ok: true; cents: number }
  | { ok: false; reason: "empty" | "format" | "too_small" | "too_large" };

// ASCII digits only: `\d` without the `u` flag is exactly [0-9], so a
// fullwidth or Arabic-Indic digit is a "format" rejection, never a parse.
const AMOUNT_SHAPE = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parses what a person typed into integer cents, or says why not.
 *
 * Accepts, after trimming, ONLY `digits` or `digits.d` or `digits.dd`.
 * Rejects (as "format"): signs, exponents (`1e3`), thousands separators,
 * currency symbols, a bare `.5` or `5.`, three-plus decimals (`10.999` — the
 * cent is never rounded for a donor), Unicode digits, and anything else.
 * Bounds depend on `kind` and are checked on the CENTS value; an out-of-range
 * but well-formed amount is "too_small" / "too_large".
 */
export function parseAmountToCents(
  input: string,
  kind: AmountKind = "online",
): ParseAmountResult {
  if (typeof input !== "string") return { ok: false, reason: "empty" };
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  const match = AMOUNT_SHAPE.exec(trimmed);
  if (!match) return { ok: false, reason: "format" };

  const whole = match[1]!.replace(/^0+(?=\d)/, "");
  if (whole.length > MAX_INTEGER_DIGITS) return { ok: false, reason: "too_large" };

  const fraction = (match[2] ?? "").padEnd(2, "0");
  // At most 12 integer digits => whole * 100 + fraction < 1e14, well inside
  // Number.MAX_SAFE_INTEGER (9.007e15): exact integer arithmetic.
  const cents = Number(whole) * 100 + Number(fraction);

  const { min, max } = AMOUNT_BOUNDS[kind];
  if (cents < min) return { ok: false, reason: "too_small" };
  if (cents > max) return { ok: false, reason: "too_large" };
  return { ok: true, cents };
}

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

/** `123456` -> `$1,234.56`; `-500` -> `-$5.00`. Cents must be a safe integer.
 * Built from the integer dollar and cent parts, so a binary float never
 * touches a digit. (Money only; never `toLocaleString` on a Date.) */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("formatCents: cents must be a safe integer");
  }
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const text = `$${WHOLE_DOLLARS.format(dollars)}.${String(remainder).padStart(2, "0")}`;
  return cents < 0 ? `-${text}` : text;
}

// ---------------------------------------------------------------------------
// Gross-up (DISPLAY ONLY) — mirrors presby_giving_gross_up() in
// drizzle/0055_presby_giving.sql, section 17a.
// ---------------------------------------------------------------------------

export type FeeRates = {
  /** Card percentage, in basis points (290 = 2.90%). */
  cardBps: number;
  /** Card fixed fee, cents. */
  cardFixedCents: number;
  /** ACH (bank) percentage, in basis points (80 = 0.80%). */
  achBps: number;
  /** ACH fee cap, cents. */
  achCapCents: number;
};

/** The column defaults on `giving_provider_connections` (card 2.9% + 30c, ACH
 * 0.8% capped at $5). `money.test.ts` reads 0055 and pins these to the DDL. */
export const DEFAULT_RATES: FeeRates = {
  cardBps: 290,
  cardFixedCents: 30,
  achBps: 80,
  achCapCents: 500,
};

export type GrossUpMethod = "card" | "bank";

/** BigInt ceiling division, for non-negative numerator and positive divisor. */
function ceilDiv(numerator: bigint, divisor: bigint): bigint {
  return (numerator + divisor - 1n) / divisor;
}

/**
 * The TOTAL to charge so that, after the processor's fee, the congregation
 * receives `amountCents`; and the covered fee (`total - amount`).
 *
 *   card: ceil((G + fixed) * 10^4 / (10^4 - bps))
 *   bank: least(ceil(G * 10^4 / (10^4 - bps)), G + cap)
 *
 * Exact integer arithmetic via BigInt (the SQL uses `numeric`; both are exact,
 * so they agree for every input — proven by the grid test). Throws on a rate
 * set the schema's CHECKs would never allow (a divisor <= 0).
 */
export function grossUp(
  amountCents: number,
  method: GrossUpMethod,
  rates: FeeRates = DEFAULT_RATES,
): { totalCents: number; coveredCents: number } {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RangeError("grossUp: amountCents must be a non-negative safe integer");
  }
  const G = BigInt(amountCents);
  let total: bigint;
  if (method === "card") {
    const divisor = 10000n - BigInt(rates.cardBps);
    if (divisor <= 0n) throw new RangeError("grossUp: cardBps must be below 10000");
    total = ceilDiv((G + BigInt(rates.cardFixedCents)) * 10000n, divisor);
  } else {
    const divisor = 10000n - BigInt(rates.achBps);
    if (divisor <= 0n) throw new RangeError("grossUp: achBps must be below 10000");
    const uncapped = ceilDiv(G * 10000n, divisor);
    const capped = G + BigInt(rates.achCapCents);
    total = uncapped < capped ? uncapped : capped;
  }
  return {
    totalCents: Number(total),
    coveredCents: Number(total - G),
  };
}
