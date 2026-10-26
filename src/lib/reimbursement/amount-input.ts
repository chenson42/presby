import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS } from "./limits";

/**
 * Money in, money out - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * P3-10 and EC3. PURE.
 *
 * Money is INTEGER CENTS end to end. The amount field is a digit-entry control
 * (`digitsToCents`: typing 1, 2, 5, 0 reads $12.50); a pasted string goes
 * through `pastedAmountToCents`, which is deliberately strict - it either reads
 * the pasted text exactly or says no. Nothing here ever rounds: "12.345",
 * "1e5", "-5", "$1,2" and "٣" (Arabic-Indic three) are all `null`, never a
 * quietly wrong amount. The server accepts only an integer in range
 * (`isAmountInRange`, the zod schema, and drizzle/0073's CHECK).
 */

/** True for an integer number of cents the database will accept. */
export function isAmountInRange(cents: unknown): cents is number {
  return Number.isSafeInteger(cents) && (cents as number) >= MIN_AMOUNT_CENTS && (cents as number) <= MAX_AMOUNT_CENTS;
}

/** Longest digit string the entry control accepts: MAX_AMOUNT_CENTS has eight digits. */
const MAX_DIGITS = String(MAX_AMOUNT_CENTS).length;

/**
 * The digit-entry control's string (ASCII 0-9 only, as typed) to cents. `""`
 * is zero. `null` for any other character, or for more digits than any legal
 * amount has. The result is NOT range-checked (zero reads as 0): the caller
 * decides whether an empty field is "not yet entered" or an error.
 */
export function digitsToCents(digits: string): number | null {
  if (!/^[0-9]*$/.test(digits)) return null;
  const trimmed = digits.replace(/^0+/, "");
  if (trimmed.length > MAX_DIGITS) return null;
  return trimmed === "" ? 0 : Number(trimmed);
}

/**
 * A pasted amount to cents, or `null` when it is not EXACTLY a dollar amount:
 *   - an optional leading "$" (and spaces after it);
 *   - whole dollars in plain digits, or with correctly-placed thousands commas
 *     ("1,234" yes; "1,2" and "12,34" no);
 *   - optionally a decimal point and ONE or TWO digits ("12.5" is $12.50;
 *     "12.345" is null - it would need rounding; "12." and ".5" are null).
 * No sign, no exponent, no letters, no non-ASCII digits. The result is not
 * range-checked.
 */
export function pastedAmountToCents(text: string): number | null {
  const match = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const whole = match[1]!.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (whole.length > MAX_DIGITS) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = Number(whole) * 100 + Number(fraction || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Cents to the text an input shows: "12.50", no symbol, no grouping. */
export function centsToInputText(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError("centsToInputText: non-negative safe integer required");
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Cents to display money: "$1,234.50". */
export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError("formatMoney: non-negative safe integer required");
  const dollars = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${dollars}.${String(cents % 100).padStart(2, "0")}`;
}
