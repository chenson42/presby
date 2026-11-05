import { formatDayHeading, formatLongDate, formatShortDate } from "@/lib/calendar/month";
import { dayKeyOf, formatTime } from "@/lib/calendar/wall-clock";

/**
 * Wall-clock text -> the words a worship page prints. Pure. A service's time is a
 * LABEL on the organization's calendar, not an instant, so no time zone is applied
 * and no `Date` is built (the same discipline `src/lib/calendar/wall-clock.ts` and
 * the worship emails follow; DECISION-113 ruling 3). `<FormattedDate>` is for
 * instants and for bare calendar dates; this is for the 'YYYY-MM-DDTHH:mm' text the
 * worship reads return.
 */

/** 'Sunday, November 16 at 9:00 AM'. */
export function formatWhen(wallClock: string): string {
  return `${formatDayHeading(dayKeyOf(wallClock))} at ${formatTime(wallClock)}`;
}

/** 'Sunday, November 16'. */
export function formatDay(wallClock: string): string {
  return formatDayHeading(dayKeyOf(wallClock));
}

/** 'Sunday, November 16, 2026' from a bare 'YYYY-MM-DD'. */
export function formatCalendarDay(dayKey: string): string {
  return formatLongDate(dayKey);
}

/** 'Sun, Nov 16' from a bare 'YYYY-MM-DD'. */
export function formatCalendarShort(dayKey: string): string {
  return formatShortDate(dayKey);
}

/** '10:00 AM' from a bare 'HH:MM' (a service type's usual start). A label: no zone, no `Date`. */
export function formatClockTime(hhmm: string): string {
  return formatTime(`2000-01-01T${hhmm}`);
}

/** Splits wall-clock text into the 'YYYY-MM-DD' and 'HH:MM' halves the date and time inputs hold. */
export function splitWallClock(wallClock: string | null): { date: string; time: string } {
  if (!wallClock) return { date: "", time: "" };
  return { date: wallClock.slice(0, 10), time: wallClock.slice(11, 16) };
}
