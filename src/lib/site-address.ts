/**
 * The organization profile's free-text postal address (DECISION-340). Stored
 * LF-separated, one postal line per line; nothing parses it into fields.
 * Pure, so the form, the action and tests share one rule.
 */

export const MAX_ADDRESS_LEN = 500;
export const MAX_ADDRESS_LINES = 6;

// Every line terminator a textarea or a paste can carry.
const LINE_BREAK = /\r\n|\r|\n|\u2028|\u2029|\u0085/;
// Other control characters (tab included) never belong in an address line.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export type NormalizedAddress =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Trims each line, drops blank lines, and joins with LF. */
export function normalizeAddress(raw: string): NormalizedAddress {
  const lines = raw
    .split(LINE_BREAK)
    .map((line) => line.replace(CONTROL, " ").replace(/ {2,}/g, " ").trim())
    .filter((line) => line.length > 0);
  const value = lines.join("\n");
  if (lines.length > MAX_ADDRESS_LINES) {
    return { ok: false, error: `Address can have up to ${MAX_ADDRESS_LINES} lines.` };
  }
  if (value.length > MAX_ADDRESS_LEN) {
    return { ok: false, error: `Address is too long (up to ${MAX_ADDRESS_LEN} characters).` };
  }
  return { ok: true, value };
}
