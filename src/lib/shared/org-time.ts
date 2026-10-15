/**
 * The organization's wall clock — "what day is it THERE" (DECISION-160, R2).
 *
 * PURE: no `server-only`, no database. One of only two files allowed to touch
 * `Intl` (the other is `src/lib/format-date.ts`), and the only one that may do
 * so for the calendar. The ban on `toLocale*` (ui-standards.md, eslint) is
 * about locale-dependent STRING output; this file asks Intl for exactly one
 * thing, the numeric parts of "now" in a named zone, under three fixed
 * options: an explicit "en-US" locale, an explicit `timeZone`, and
 * `hourCycle: "h23"` (without it midnight formats as "24"). Month and weekday
 * NAMES never come from Intl — they are static arrays in
 * `src/lib/calendar/month.ts`.
 *
 * The zone is the one in which "now" is read: today's highlight, the default
 * month, the Today link, the home card's "upcoming" test. It is NEVER used to
 * convert a stored `events.starts_at`, which is wall-clock text and stays that
 * way (DECISION-113 ruling 3, F134).
 */

export const DEFAULT_ORG_TIME_ZONE = "America/New_York";

/** The same shape rule as the `organization_settings_time_zone_valid` CHECK. */
const TIME_ZONE_SHAPE_RE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws RangeError for a zone ICU does not know.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * True when `value` has the IANA shape the database enforces AND Node's ICU
 * accepts it. Postgres accepts POSIX `UTC+5` and bare `EST`, which Intl
 * handles differently or not at all — hence the shape rule first.
 */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !TIME_ZONE_SHAPE_RE.test(value)) {
    return false;
  }
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

export interface OrgClock {
  /** 'YYYY-MM-DD' in the org's zone. */
  dayKey: string;
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
  second: number;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/**
 * The org-local wall clock at `now`. Throws RangeError for an invalid zone —
 * callers hold only values that passed `isValidTimeZone`.
 */
export function wallClockNow(now: Date, timeZone: string): OrgClock {
  const parts = formatterFor(timeZone).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : Number.NaN;
  };
  const year = read("year");
  const month = read("month");
  const day = read("day");
  // Belt and braces: h23 never yields 24, but a mis-resolving runtime must not
  // turn midnight into "the end of yesterday".
  const hour = read("hour") % 24;
  const minute = read("minute");
  const second = read("second");
  return {
    dayKey: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

/**
 * `wallClockNow(now, timeZone).dayKey` — the one helper the calendar, the home
 * card and (later) the greeting consume.
 */
export function todayInOrgZone(now: Date, timeZone: string): string {
  return wallClockNow(now, timeZone).dayKey;
}
