/**
 * A UUID-shaped string — the form check, not a validity or existence check.
 *
 * Pure (no `server-only`, no imports) so the calendar's query-string parsers,
 * the event write path and tests share one definition. A malformed id from a
 * route param, a `?types=` entry or a form field must fail THIS before it can
 * reach Postgres as an `invalid input syntax for type uuid` (22P02) that would
 * surface as a 500 instead of the same "not found" a missing row gets.
 *
 * Case-insensitive on purpose: callers that need a canonical form lower-case it
 * themselves (see `parseTypesParam`).
 */
const UUID_SHAPE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidShaped(value: string): boolean {
  return typeof value === "string" && UUID_SHAPE_RE.test(value);
}
