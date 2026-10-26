/**
 * Date predicates for postings - pure, built on the calendar's UTC-only day-key
 * helpers (`src/lib/calendar/month.ts`). Every value is a 'YYYY-MM-DD' KEY; no
 * `Date` is read from the process clock and no zone is applied here. "Today" is
 * always the organization's own date, supplied by `presby_careers_org_today()`.
 */
import { addDays, isDayKey } from "@/lib/calendar/month";
import { CLOSING_DATE_MAX, CLOSING_DATE_MIN, STALE_AFTER_DAYS } from "./contract";

/**
 * A closing date is the LAST day applications are accepted, inclusive: it has
 * passed once the organization's today is after it.
 */
export function closingDatePassed(closingDate: string | null, orgToday: string): boolean {
  return closingDate !== null && closingDate < orgToday;
}

/** True when `closingDate` is a real calendar day inside the database's window. */
export function isValidClosingDate(closingDate: string): boolean {
  return isDayKey(closingDate) && closingDate >= CLOSING_DATE_MIN && closingDate <= CLOSING_DATE_MAX;
}

/**
 * Whether the public can read the posting right now: published, and no closing
 * date or one that has not passed. The derived predicate the definer applies;
 * the sweep is housekeeping, not the gate.
 */
export function isVisibleToPublic(
  status: "draft" | "published" | "closed",
  closingDate: string | null,
  orgToday: string,
): boolean {
  return status === "published" && !closingDatePassed(closingDate, orgToday);
}

/**
 * A posting that has been public for `STALE_AFTER_DAYS` or more with no closing
 * date: the list nudges its managers to close it if it has been filled. False
 * when it has a closing date (that date will close it) or was never posted.
 */
export function isStale(
  postedOn: string | null,
  closingDate: string | null,
  orgToday: string,
): boolean {
  if (postedOn === null || closingDate !== null) return false;
  if (!isDayKey(postedOn) || !isDayKey(orgToday)) return false;
  return addDays(postedOn, STALE_AFTER_DAYS) <= orgToday;
}
