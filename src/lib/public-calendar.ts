import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { isDayKey, monthKey, parseMonthParam, type MonthRef } from "@/lib/calendar/month";
import {
  PUBLIC_CALENDAR_MAX_SPAN,
  PUBLIC_CALENDAR_ROW_CAP,
  type PublicCalendar,
  type PublicCalendarEvent,
} from "@/lib/calendar/public-contract";
import { WALL_CLOCK_TEXT_RE } from "@/lib/calendar/wall-clock";
import { parseSiteKey } from "@/lib/domains/host";
import { isEventTypeColor } from "@/lib/events/type-palette";

/**
 * The public events calendar's one read - `presby_public_events_calendar(slug)`
 * (drizzle/0067) on the anonymous `db` connection with NO org context and NO
 * session. docs/work-log/2026-10-25-public-events-calendar.md, Phase 3 "API
 * Contract"; DECISION-238, DECISION-154.
 *
 * Same shape as `src/lib/giving/public-config.ts`: one SECURITY DEFINER function
 * that ALWAYS returns exactly one row, one `try/catch`, a failure logged with
 * the slug only (never the error or its message) and collapsed to the neutral
 * answer. Here the neutral answer is `unavailable`, which the slot renders as
 * the same words for "the toggle is off", "the site is not live" and "the read
 * failed" - so the page can never claim "no events" when it does not know. An
 * EMPTY event list is reachable only through a successful read.
 *
 * NO `unstable_cache` / `"use cache"`: freshness after an unpublish rests on the
 * `force-dynamic` site layout (G11). React `cache()` only dedupes two markers on
 * one page within one render. `getPlatformDb()` is not used anywhere here.
 */

const UNAVAILABLE: PublicCalendar = { state: "unavailable" };

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Months from `a` to `b` inclusive of both ends; negative when `b` precedes `a`. */
function monthSpan(a: MonthRef, b: MonthRef): number {
  return (b.year - a.year) * 12 + (b.month - a.month) + 1;
}

function mapEvent(raw: unknown): PublicCalendarEvent | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const title = text(r.title);
  const startsAt = text(r.starts_at);
  if (!title || !startsAt || !WALL_CLOCK_TEXT_RE.test(startsAt)) return null;
  const dayKey = startsAt.slice(0, 10);
  if (!isDayKey(dayKey)) return null;

  // An end that is not a well-formed wall clock, or not after the start, is no
  // end at all (imported bad data, G13) - tolerated, not fatal.
  const endsRaw = text(r.ends_at);
  const endsAt =
    endsRaw && WALL_CLOCK_TEXT_RE.test(endsRaw) && endsRaw > startsAt ? endsRaw : null;

  // Optional text must be absent (null) or a string; any other type is a
  // malformed row, not "absent".
  for (const key of ["location", "description", "type_name"] as const) {
    if (r[key] !== null && r[key] !== undefined && typeof r[key] !== "string") return null;
  }

  return {
    title,
    startsAt,
    endsAt,
    dayKey,
    location: text(r.location),
    description: text(r.description),
    typeName: text(r.type_name),
    typeColor: isEventTypeColor(r.type_color) ? r.type_color : "neutral",
  };
}

/**
 * Maps the function's one row to the union. Exported for the unit test. A
 * malformed row, a string where the driver should have parsed jsonb, a month
 * out of order or over the span, an event outside the window, or more events
 * than the cap all map to `unavailable` - NEVER to an empty list.
 */
export function mapPublicCalendarRow(row: Record<string, unknown> | undefined): PublicCalendar {
  if (!row || row.state !== "available") return UNAVAILABLE;

  const orgToday = text(row.org_today);
  const firstMonth = typeof row.first_month === "string" ? parseMonthParam(row.first_month) : null;
  const lastMonth = typeof row.last_month === "string" ? parseMonthParam(row.last_month) : null;
  if (
    !orgToday ||
    !isDayKey(orgToday) ||
    !firstMonth ||
    !lastMonth ||
    typeof row.truncated !== "boolean" ||
    typeof row.member_calendar_on !== "boolean"
  ) {
    return UNAVAILABLE;
  }
  const span = monthSpan(firstMonth, lastMonth);
  if (span < 1 || span > PUBLIC_CALENDAR_MAX_SPAN) return UNAVAILABLE;

  // The driver parses jsonb; a string is refused rather than re-parsed.
  if (!Array.isArray(row.events_json) || row.events_json.length > PUBLIC_CALENDAR_ROW_CAP) {
    return UNAVAILABLE;
  }
  if (row.contact_phone !== null && row.contact_phone !== undefined && typeof row.contact_phone !== "string") {
    return UNAVAILABLE;
  }

  const first = monthKey(firstMonth);
  const last = monthKey(lastMonth);
  const events: PublicCalendarEvent[] = [];
  for (const raw of row.events_json) {
    const event = mapEvent(raw);
    if (!event) return UNAVAILABLE;
    const month = event.dayKey.slice(0, 7);
    if (month < first || month > last) return UNAVAILABLE;
    events.push(event);
  }

  return {
    state: "available",
    orgToday,
    firstMonth,
    lastMonth,
    truncated: row.truncated,
    memberCalendarOn: row.member_calendar_on,
    contactPhone: text(row.contact_phone),
    events,
  };
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] } | null)?.rows ?? []) as Record<
    string,
    unknown
  >[];
}

/**
 * The slot's one read. `slug` is the DATABASE-RETURNED slug (the render path's
 * closure), never a request value; a string that is not slug-shaped never
 * reaches the database. Never throws.
 */
export const readPublicCalendar = cache(async function readPublicCalendar(
  slug: string,
): Promise<PublicCalendar> {
  if (parseSiteKey(slug).kind !== "slug") return UNAVAILABLE;
  try {
    const result = await db.execute(
      sql`select * from presby_public_events_calendar(${slug}::text)`,
    );
    return mapPublicCalendarRow(rowsOf(result)[0]);
  } catch {
    console.error("[public-calendar] readPublicCalendar read failed; treating as unavailable", {
      slug,
    });
    return UNAVAILABLE;
  }
});
