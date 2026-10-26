import { MAX_EXPENSE_DAYS_BACK } from "./limits";

/**
 * `YYYY-MM-DD` arithmetic for the expense-date window (P3-18, EC35). PURE.
 *
 * "Today" is the ORGANIZATION'S local date (America/New_York when its settings
 * row is missing, F132), which only the database knows
 * (`presby_reimbursement_org_today()`); callers pass it in. Everything here is
 * calendar arithmetic on date strings through UTC, so it cannot be moved by the
 * server's own time zone.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date typed as YYYY-MM-DD (rejects 2026-02-30). */
export function isRealIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `ymd` plus `days` (negative goes back), as YYYY-MM-DD. */
export function addDays(ymd: string, days: number): string {
  if (!isRealIsoDate(ymd)) throw new RangeError(`addDays: not a date: ${ymd}`);
  const [year, month, day] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The earliest expense date allowed when `today` is the organization's local date. */
export function expenseDateFloor(today: string): string {
  return addDays(today, -MAX_EXPENSE_DAYS_BACK);
}

/** The latest expense date allowed: today. */
export function expenseDateCeiling(today: string): string {
  if (!isRealIsoDate(today)) throw new RangeError(`expenseDateCeiling: not a date: ${today}`);
  return today;
}

/**
 * Whether `expenseDate` is inside the window. The database applies this when a
 * date is first set or edited, NOT when an unchanged date is resubmitted
 * (P3-18); the form uses it for the `min` and `max` of the date input.
 */
export function isExpenseDateInWindow(expenseDate: string, today: string): boolean {
  if (!isRealIsoDate(expenseDate)) return false;
  return expenseDate >= expenseDateFloor(today) && expenseDate <= expenseDateCeiling(today);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * A calendar date in words ("October 25, 2026"), for the one place a date sits
 * inside a message the SERVER writes (an action's `already decided on <date>`
 * text). Built from the digits alone: no `Date`, no locale, no server time zone,
 * so the day it names is the day the database stamped. A page renders dates
 * with `<FormattedDate>` instead; the action also returns the raw `YYYY-MM-DD`.
 */
export function formatCalendarDate(ymd: string): string {
  if (!isRealIsoDate(ymd)) throw new RangeError(`formatCalendarDate: not a date: ${ymd}`);
  const [year, month, day] = ymd.split("-").map(Number) as [number, number, number];
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}
