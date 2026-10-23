/**
 * Pure 'YYYY-MM-DD' helpers (no `server-only`, no database): shared by the
 * server actions, the zod schemas and the library's defensive throws
 * (docs/work-log/2026-10-22-founding-admin-directory.md, Phase 3 "Pure shared
 * modules").
 *
 * The roll functions bound dates by the DATABASE's `current_date`, which is
 * UTC (the roll sync trigger and `presby_roll_changes` use the same clock), so
 * `todayUtcYmd()` must agree with it: a row can then never be future-dated by
 * this code's own clock and `presby_roll_cache_drift()` stays clean.
 */

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a real calendar date in 'YYYY-MM-DD' form: the shape AND a
 * round-trip through `Date.UTC`, so `2026-02-30` and `2026-13-01` are refused
 * (a bare regex accepts both and Postgres then raises a raw error).
 */
export function isRealYmd(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = YMD_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` maps years 0-99 onto 1900-1999; a four-digit year below 100 is
  // not a date any roll can carry, and the round trip below would disagree.
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Today's date in UTC as 'YYYY-MM-DD' (the database's `current_date`). */
export function todayUtcYmd(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
