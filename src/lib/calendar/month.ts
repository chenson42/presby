/**
 * Month arithmetic and the month grid — pure, no `server-only`, no database.
 *
 * Every date here is a 'YYYY-MM-DD' KEY built from padded integers. `Date` is
 * used only as `new Date(Date.UTC(...))` read through `getUTC*`, so nothing
 * depends on the server's (or the test runner's) time zone; eslint (S1) bans a
 * local getter, setter or multi-argument constructor in this directory. Month
 * and weekday names are static arrays — `toLocale*` and `Intl` are banned for
 * display strings (ui-standards.md).
 */

export const MIN_CALENDAR_YEAR = 2000;
export const MAX_CALENDAR_YEAR = 2100;

export const MONTH_NAMES: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const WEEKDAY_NAMES: readonly string[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const WEEKDAY_ABBREVIATIONS: readonly string[] = WEEKDAY_NAMES.map(
  (name) => name.slice(0, 3),
);

const MONTH_ABBREVIATIONS: readonly string[] = MONTH_NAMES.map((name) =>
  name.slice(0, 3),
);

export interface MonthRef {
  year: number;
  /** 1-12 */
  month: number;
}

export interface GridDay {
  /** 'YYYY-MM-DD' */
  key: string;
  day: number;
  inMonth: boolean;
  /** 0 = Sunday */
  weekday: number;
}

export interface MonthGrid {
  /** 4-6 rows of 7, Sunday-first. */
  weeks: GridDay[][];
  /** First grid day. */
  firstKey: string;
  /** Last grid day (inclusive). */
  lastKey: string;
  /** The HALF-OPEN upper bound handed to SQL. */
  dayAfterLastKey: string;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function dayKeyFromUtc(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

function utcFromDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Year 0-99 would be mapped to 1900+ by Date.UTC; the calendar range never goes there, but guard the helper. */
function utcFromParts(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

const MONTH_PARAM_RE = /^(\d{4})-(\d{2})$/;

/**
 * 'YYYY-MM' with a year in 2000-2100 inclusive; anything else (including
 * `0000-01`, `2026-13`, `2026-1`, `""`, `undefined`) -> null. An array uses its
 * first element. NEVER `new Date(y, m - 1, 1)`.
 */
export function parseMonthParam(
  raw: string | string[] | undefined,
): MonthRef | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const match = MONTH_PARAM_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < MIN_CALENDAR_YEAR || year > MAX_CALENDAR_YEAR) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** '2026-10' */
export function monthKey(ref: MonthRef): string {
  return `${pad(ref.year, 4)}-${pad(ref.month, 2)}`;
}

/** '2026-10-31' -> { year: 2026, month: 10 } */
export function monthOfDayKey(dayKey: string): MonthRef {
  const [year, month] = dayKey.split("-").map(Number);
  return { year, month };
}

/** 'October 2026' */
export function monthLabel(ref: MonthRef): string {
  return `${MONTH_NAMES[ref.month - 1]} ${ref.year}`;
}

/** null at 2000-01 (the calendar has no earlier month). */
export function prevMonth(ref: MonthRef): MonthRef | null {
  const prev: MonthRef =
    ref.month === 1
      ? { year: ref.year - 1, month: 12 }
      : { year: ref.year, month: ref.month - 1 };
  return prev.year < MIN_CALENDAR_YEAR ? null : prev;
}

/** null at 2100-12 (the calendar has no later month). */
export function nextMonth(ref: MonthRef): MonthRef | null {
  const next: MonthRef =
    ref.month === 12
      ? { year: ref.year + 1, month: 1 }
      : { year: ref.year, month: ref.month + 1 };
  return next.year > MAX_CALENDAR_YEAR ? null : next;
}

export function isSameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.year === b.year && a.month === b.month;
}

/** 'YYYY-MM-DD' plus `days` (negative allowed), via Date.UTC. */
export function addDays(dayKey: string, days: number): string {
  const date = utcFromDayKey(dayKey);
  return dayKeyFromUtc(new Date(date.getTime() + days * 86_400_000));
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** /^\d{4}-\d{2}-\d{2}$/ AND a real calendar date (2026-02-30 is not). */
export function isDayKey(value: string): boolean {
  if (typeof value !== "string" || !DAY_KEY_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = utcFromParts(year, month, day);
  return dayKeyFromUtc(date) === value && date.getUTCFullYear() === year;
}

/**
 * Items grouped by their `dayKey`, in the order they arrived. Generic so the
 * member calendar's entries and the public calendar's events share one grouper
 * (the public view never imports an `(org)` route file, DECISION-239).
 */
export function groupByDay<T extends { dayKey: string }>(
  items: readonly T[],
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const list = byDay.get(item.dayKey);
    if (list) list.push(item);
    else byDay.set(item.dayKey, [item]);
  }
  return byDay;
}

/** The Sunday-first grid covering `ref`: whole weeks, 4-6 of them. */
export function buildMonthGrid(ref: MonthRef): MonthGrid {
  const first = utcFromParts(ref.year, ref.month, 1);
  const lastOfMonth = utcFromParts(ref.year, ref.month + 1, 0);
  const leading = first.getUTCDay();
  const trailing = 6 - lastOfMonth.getUTCDay();
  const start = new Date(first.getTime() - leading * 86_400_000);
  const totalDays = leading + lastOfMonth.getUTCDate() + trailing;

  const weeks: GridDay[][] = [];
  let cursor = start.getTime();
  for (let w = 0; w < totalDays / 7; w += 1) {
    const week: GridDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(cursor);
      week.push({
        key: dayKeyFromUtc(date),
        day: date.getUTCDate(),
        inMonth:
          date.getUTCFullYear() === ref.year &&
          date.getUTCMonth() + 1 === ref.month,
        weekday: d,
      });
      cursor += 86_400_000;
    }
    weeks.push(week);
  }

  const firstKey = weeks[0][0].key;
  const lastKey = weeks[weeks.length - 1][6].key;
  return { weeks, firstKey, lastKey, dayAfterLastKey: addDays(lastKey, 1) };
}

function partsOf(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = utcFromParts(year, month, day).getUTCDay();
  return { year, month, day, weekday };
}

/** 'Sunday, October 4' */
export function formatDayHeading(dayKey: string): string {
  const { month, day, weekday } = partsOf(dayKey);
  return `${WEEKDAY_NAMES[weekday]}, ${MONTH_NAMES[month - 1]} ${day}`;
}

/** 'Sun, Oct 4' (also consumed by the home card) */
export function formatShortDate(dayKey: string): string {
  const { month, day, weekday } = partsOf(dayKey);
  return `${WEEKDAY_ABBREVIATIONS[weekday]}, ${MONTH_ABBREVIATIONS[month - 1]} ${day}`;
}

/** 'Sunday, October 4, 2026' */
export function formatLongDate(dayKey: string): string {
  const { year, month, day, weekday } = partsOf(dayKey);
  return `${WEEKDAY_NAMES[weekday]}, ${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

/** 'Sun Oct 4' — the plain-text clipboard's day line (no comma). */
export function formatClipboardDay(dayKey: string): string {
  const { month, day, weekday } = partsOf(dayKey);
  return `${WEEKDAY_ABBREVIATIONS[weekday]} ${MONTH_ABBREVIATIONS[month - 1]} ${day}`;
}
