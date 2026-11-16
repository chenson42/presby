/**
 * Strict query-parameter parsing for the presbytery reports (Phase 1 "Query-
 * parameter handling", F447). PURE. A year is exactly four digits and 1900 to
 * 2100; absent is the default; present-but-bad is `{ ok: false }` (a page
 * falls back to the default, a route answers 400). Unknown keys are never read
 * here. `Number("")` is 0 and finite, which is how the old page turned a blank
 * `?year=` into 1900 - nothing here goes through bare `Number()`.
 */

export const YEAR_MIN = 1900;
export const YEAR_MAX = 2100;
/** The widest trend window, in years (inclusive of both ends). */
export const TREND_MAX_SPAN = 10;
/** The default trend window, in years. */
export const TREND_DEFAULT_SPAN = 5;

export type Parsed<T> = { ok: true; value: T } | { ok: false };

/** What a search parameter may be: absent, one string, or a repeated key. */
export type RawParam = string | string[] | undefined | null;

const FOUR_DIGITS = /^\d{4}$/;

function bad<T>(): Parsed<T> {
  return { ok: false };
}

function good<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

/** `undefined` when absent; `null` when present but not a valid year; else the year. */
function readYear(raw: RawParam): number | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return null; // a repeated key
  if (!FOUR_DIGITS.test(raw)) return null;
  const year = Number.parseInt(raw, 10);
  if (year < YEAR_MIN || year > YEAR_MAX) return null;
  return year;
}

/** A required-when-present year; absent is invalid (use a `parseXxx` with a default instead). */
export function parseYear(raw: RawParam): Parsed<number> {
  const year = readYear(raw);
  return typeof year === "number" ? good(year) : bad();
}

/** `billingYear`: absent is `now`'s UTC year. */
export function parseBillingYear(raw: RawParam, now: Date): Parsed<number> {
  const year = readYear(raw);
  if (year === undefined) {
    const current = now.getUTCFullYear();
    return current >= YEAR_MIN && current <= YEAR_MAX ? good(current) : bad();
  }
  return year === null ? bad() : good(year);
}

/**
 * The trend window. Both absent: `to` is last year and `from` is four years
 * earlier. Only `to`: `from = to - 4`. Only `from`: `to = from + 4`. `from`
 * after `to`, a span over ten years, or a derived year outside 1900 to 2100 is
 * invalid.
 */
export function parseTrendWindow(
  rawFrom: RawParam,
  rawTo: RawParam,
  now: Date,
): Parsed<{ from: number; to: number }> {
  const from = readYear(rawFrom);
  const to = readYear(rawTo);
  if (from === null || to === null) return bad();

  let start: number;
  let end: number;
  const back = TREND_DEFAULT_SPAN - 1;
  if (from === undefined && to === undefined) {
    end = now.getUTCFullYear() - 1;
    start = end - back;
  } else if (from === undefined) {
    end = to as number;
    start = end - back;
  } else if (to === undefined) {
    start = from;
    end = start + back;
  } else {
    start = from;
    end = to;
  }

  if (start < YEAR_MIN || end > YEAR_MAX || start > end) return bad();
  if (end - start + 1 > TREND_MAX_SPAN) return bad();
  return good({ from: start, to: end });
}

/** `allYears`: absent is false; the only accepted present value is exactly `"1"`. */
export function parseAllYears(raw: RawParam): Parsed<boolean> {
  if (raw === undefined || raw === null) return good(false);
  return raw === "1" ? good(true) : bad();
}
