/**
 * A UUID-shaped string. A malformed id fails this BEFORE any SQL runs: an
 * invalid-uuid Postgres cast error is a genuine failure (throws), which is the
 * wrong shape for a client-supplied id that should read as "not found".
 * Pure (no `server-only`): the server actions and the lib share it.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
