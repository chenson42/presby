/**
 * Fee-rate entry for people: percent and dollars in, basis points and cents
 * out (the schema's units - `giving_connections_fee_bounds`, 0055). Pure; the
 * rates form and its tests use it, and the server action's zod schema is still
 * the authority on the bounds.
 *
 * A treasurer thinks "2.9%" and "30 cents", not "290 basis points". Parsing is
 * exact string arithmetic, never a float multiply (`0.29 * 100` is
 * `28.999999999999996`): the shape is `digits` or `digits.d` or `digits.dd`
 * (percent: at most two decimals), nothing else.
 */

const SHAPE = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** "2.9" -> 290, "0.80" -> 80, "10" -> 1000. Null when malformed. */
export function parsePercentToBps(input: string): number | null {
  const match = SHAPE.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** "0.30" -> 30, "5" -> 500. Null when malformed. */
export function parseDollarsToCents(input: string): number | null {
  const match = SHAPE.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** 290 -> "2.9", 80 -> "0.8", 1000 -> "10". Shortest exact form. */
export function formatBpsAsPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** 30 -> "0.30", 500 -> "5.00". Always two decimals (it is money). */
export function formatCentsAsDollars(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "2.9% + $0.30" for the card line of the summary. */
export function describeCardRate(bps: number, fixedCents: number): string {
  return `${formatBpsAsPercent(bps)}% + $${formatCentsAsDollars(fixedCents)}`;
}

/** "0.8%, capped at $5.00" for the bank line of the summary. */
export function describeBankRate(bps: number, capCents: number): string {
  return `${formatBpsAsPercent(bps)}%, capped at $${formatCentsAsDollars(capCents)}`;
}
