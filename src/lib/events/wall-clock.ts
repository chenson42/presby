/**
 * The wall-clock codec for `timestamp` (no zone) columns — the one place a
 * typed 'YYYY-MM-DDTHH:mm[:ss]' string becomes a `Date` and back.
 *
 * Why UTC fields (F134): drizzle-orm's `timestamp` (no zone) column WRITES
 * `value.toISOString()` and READS by appending "+0000"
 * (node_modules/drizzle-orm/pg-core/columns/timestamp.js). A `Date` is
 * therefore a faithful carrier of wall-clock digits only when its UTC fields
 * hold them. Building the Date from LOCAL fields stored the typed digits only
 * when the server process ran in UTC (Vercel does; a laptop in New York does
 * not). Nothing here depends on the process time zone, and nothing here is a
 * real instant — a value that came out of one of these functions must never be
 * treated as one. `eslint.config.mjs` bans local Date getters/setters in the
 * wall-clock modules so the discipline is mechanical, not remembered.
 */

export const WALL_CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * `'YYYY-MM-DDTHH:mm'` or `'YYYY-MM-DDTHH:mm:ss'` (a native `<input
 * type="datetime-local">`'s own value shape) → a `Date` whose UTC fields are
 * the typed digits. Throws on a malformed string — a genuine call-shape
 * defect (the UI always sends this exact shape), not a user-facing denial.
 */
export function parseWallClock(value: string): Date {
  if (!WALL_CLOCK_RE.test(value)) {
    throw new Error(
      `parseWallClock: expected 'YYYY-MM-DDTHH:mm[:ss]', got ${JSON.stringify(value)}`,
    );
  }
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second ?? 0, 0));
}

/**
 * The inverse of `parseWallClock` — a `Date` (read back from a `timestamp`,
 * no-tz column) → `'YYYY-MM-DDTHH:mm:ss'`, from the UTC fields. Not
 * `.toISOString()`: that would append a "Z" the value has no zone to justify.
 */
export function formatWallClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}
