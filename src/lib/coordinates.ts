/**
 * The one coordinate rule (DECISION-343, docs/work-log/2026-11-17-presbytery-dashboard-map.md).
 *
 * A congregation's map location is a latitude and a longitude, and four places
 * have to agree about what counts as one: the oversight write
 * (`src/lib/presbytery.ts`), the client form schema and the form itself
 * (`oversight/[aboutOrgId]/`), and the map's reader (`presbytery-reports/map-derive.ts`).
 * They all call the functions here, so a value the form accepts is a value the
 * reader will draw, and a value the reader would drop is a value the write refuses.
 *
 * NO IMPORTS, on purpose and pinned by `coordinates.test.ts`: this file is safe
 * for a client component, a server action and a pure derive alike, and it
 * cannot create an import cycle between `presbytery.ts` and
 * `presbytery-reports/` (which already imports `presbytery.ts`).
 *
 * The database columns are unconstrained `numeric`, so Postgres will store
 * 'NaN' and 'Infinity'. No CHECK is added: the reader is the authority and never
 * trusts a stored value (`parseCoordinateField` rejects both).
 */

export const COORDINATE_MESSAGES = {
  latitudeNumber: "Latitude must be a number.",
  latitudeRange: "Latitude must be between -90 and 90.",
  longitudeNumber: "Longitude must be a number.",
  longitudeRange: "Longitude must be between -180 and 180.",
  halfSet: "Enter both latitude and longitude, or leave both blank.",
  zeroZero:
    "0 and 0 is a point in the ocean, not a congregation. Enter its real latitude and longitude, or leave both blank.",
} as const;

export type CoordinateField =
  | { kind: "blank" }
  | { kind: "number"; value: number }
  | { kind: "invalid" };

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Strict decimal text: an optional sign, digits, and an optional fraction.
 * "", whitespace and null are blank. "NaN", "1e5", "Infinity", "0x1" and "39,9"
 * are invalid, and so is a digit string too long to be a finite number.
 */
export function parseCoordinateField(text: string | null | undefined): CoordinateField {
  if (text === null || text === undefined) return { kind: "blank" };
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "blank" };
  if (!DECIMAL.test(trimmed)) return { kind: "invalid" };
  const value = parseFloat(trimmed);
  if (!Number.isFinite(value)) return { kind: "invalid" };
  return { kind: "number", value };
}

function finiteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * The one rule. Both values `typeof number` and finite, latitude in -90..90,
 * longitude in -180..180, and not exactly 0 and 0 (-0 counts as 0). Anything
 * else is null. No regional plausibility check: a presbytery outside the
 * continental US must never have a correct pin hidden, so a sign error shows as
 * a pin in another country and the clerk sees it.
 */
export function mappablePair(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (!finiteNumber(lat) || !finiteNumber(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

export type CoordinatePairResult =
  | { ok: true; value: { lat: number; lng: number } | null }
  | { ok: false; field: "latitude" | "longitude"; message: string };

/**
 * The write's and the form's validator. null and undefined are blank; anything
 * else must be a finite number in range. Returns the first failure, or ok with
 * the pair (null when both are blank). The half-set error names the BLANK field;
 * 0 and 0 names latitude.
 */
export function validateCoordinatePair(lat: unknown, lng: unknown): CoordinatePairResult {
  const latBlank = lat === null || lat === undefined;
  const lngBlank = lng === null || lng === undefined;

  if (!latBlank) {
    if (!finiteNumber(lat)) {
      return { ok: false, field: "latitude", message: COORDINATE_MESSAGES.latitudeNumber };
    }
    if (lat < -90 || lat > 90) {
      return { ok: false, field: "latitude", message: COORDINATE_MESSAGES.latitudeRange };
    }
  }
  if (!lngBlank) {
    if (!finiteNumber(lng)) {
      return { ok: false, field: "longitude", message: COORDINATE_MESSAGES.longitudeNumber };
    }
    if (lng < -180 || lng > 180) {
      return { ok: false, field: "longitude", message: COORDINATE_MESSAGES.longitudeRange };
    }
  }

  if (latBlank && lngBlank) return { ok: true, value: null };
  if (latBlank) return { ok: false, field: "latitude", message: COORDINATE_MESSAGES.halfSet };
  if (lngBlank) return { ok: false, field: "longitude", message: COORDINATE_MESSAGES.halfSet };

  const pair = mappablePair(lat, lng);
  if (!pair) return { ok: false, field: "latitude", message: COORDINATE_MESSAGES.zeroZero };
  return { ok: true, value: pair };
}

const NUM = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))";
// Two decimals, a comma, semicolon or whitespace between them, an optional
// degree sign after each, and optional surrounding parentheses.
const PAIR = new RegExp(`^\\(?\\s*${NUM}\\s*°?\\s*(?:[,;]\\s*|\\s)\\s*${NUM}\\s*°?\\s*\\)?$`);

/**
 * "39.9612, -82.9988" -> { latitude: "39.9612", longitude: "-82.9988" }. Returns
 * the digit strings as typed (no reformatting, no rounding). Anything that is
 * not exactly two decimals is null, so an ordinary paste is left alone. The
 * range is not checked here: the fields' own validation reports it.
 */
export function splitPastedPair(text: string): { latitude: string; longitude: string } | null {
  const m = PAIR.exec(text.trim());
  if (!m) return null;
  return { latitude: m[1]!, longitude: m[2]! };
}
