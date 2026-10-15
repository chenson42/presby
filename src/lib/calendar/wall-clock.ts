/**
 * Wall-clock TEXT -> display. Pure, no `server-only`.
 *
 * Not the `Date` codec in `src/lib/events/wall-clock.ts`: the member read path
 * selects times as `to_char(starts_at, 'YYYY-MM-DD"T"HH24:MI')` text and this
 * file formats those digits directly. A time is a label, not an instant — no
 * time zone is applied, and nothing here constructs a `Date`.
 *
 * There is deliberately no all-day concept (out of scope): an event at 00:00
 * renders "12:00 AM".
 */
import { formatLongDate } from "./month";

export const WALL_CLOCK_TEXT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function assertWallClock(wallClock: string): void {
  if (typeof wallClock !== "string" || !WALL_CLOCK_TEXT_RE.test(wallClock)) {
    throw new Error(
      `calendar wall-clock: expected 'YYYY-MM-DDTHH:mm', got ${JSON.stringify(wallClock)}`,
    );
  }
}

/** 'YYYY-MM-DD'. Throws on a malformed string. */
export function dayKeyOf(wallClock: string): string {
  assertWallClock(wallClock);
  return wallClock.slice(0, 10);
}

/** Minutes since local midnight. Throws on a malformed string. */
export function minutesOfDay(wallClock: string): number {
  assertWallClock(wallClock);
  return Number(wallClock.slice(11, 13)) * 60 + Number(wallClock.slice(14, 16));
}

function clockParts(wallClock: string): { hour12: number; minute: number; pm: boolean } {
  const total = minutesOfDay(wallClock);
  const hour24 = Math.floor(total / 60);
  return {
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: total % 60,
    pm: hour24 >= 12,
  };
}

/** '7:00 PM', '12:00 AM', '12:00 PM', '11:59 PM' */
export function formatTime(wallClock: string): string {
  const { hour12, minute, pm } = clockParts(wallClock);
  return `${hour12}:${String(minute).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
}

/** '7p', '7:30p', '10a', '12p', '12a' (the clipboard) */
export function formatTimeCompact(wallClock: string): string {
  const { hour12, minute, pm } = clockParts(wallClock);
  const minutes = minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`;
  return `${hour12}${minutes}${pm ? "p" : "a"}`;
}

/**
 * '7:00 PM'; a same-day end -> '7:00 PM – 8:30 PM' (en dash); an end on
 * another day -> '7:00 PM' only (the entry sits on its start day).
 */
export function formatTimeRange(startsAt: string, endsAt: string | null): string {
  const start = formatTime(startsAt);
  if (endsAt && dayKeyOf(endsAt) === dayKeyOf(startsAt)) {
    return `${start} – ${formatTime(endsAt)}`;
  }
  return start;
}

/**
 * The detail page's "when". Same day: `start` = 'Sunday, October 4, 2026,
 * 7:00 PM – 8:30 PM', `end` null. A different end day: `start` carries only
 * the start and `end` is 'Ends Monday, October 5, 2026, 9:00 AM' (the caller
 * renders two lines).
 */
export function describeWhen(
  startsAt: string,
  endsAt: string | null,
): { start: string; end: string | null } {
  const dateLine = formatLongDate(dayKeyOf(startsAt));
  if (!endsAt) {
    return { start: `${dateLine}, ${formatTime(startsAt)}`, end: null };
  }
  if (dayKeyOf(endsAt) === dayKeyOf(startsAt)) {
    return { start: `${dateLine}, ${formatTimeRange(startsAt, endsAt)}`, end: null };
  }
  return {
    start: `${dateLine}, ${formatTime(startsAt)}`,
    end: `Ends ${formatLongDate(dayKeyOf(endsAt))}, ${formatTime(endsAt)}`,
  };
}
