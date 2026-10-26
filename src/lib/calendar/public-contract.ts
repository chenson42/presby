/**
 * The public events calendar's contract - pure, no `server-only`, no database,
 * safe for a client component, the slot, the model and the render path alike.
 *
 * docs/work-log/2026-10-25-public-events-calendar.md, Phase 3 "API Contract";
 * DECISION-238/239/241. The reader (`src/lib/public-calendar.ts`, server-only)
 * maps `presby_public_events_calendar()`'s one row onto these types.
 *
 * `PublicCalendarEvent` deliberately has NO `id`: the public page has no
 * per-event URL, so an id would be a handle with nothing to open and a way to
 * probe. React keys use the index (the structural precedent is DECISION-133's
 * `PersonCard`). Nothing else an anonymous visitor must not see is on it either:
 * no `allows_checkin`, `created_by`, series fields, `is_public`, `website_listed`.
 */
import type { EventTypeColor } from "../events/type-palette";
import type { MonthRef } from "./month";

/** The `liveSlot` block name a content author places (`{"type":"liveSlot","props":{"slot":"eventsCalendar"}}`). */
export const PUBLIC_CALENDAR_SLOT = "eventsCalendar";

/**
 * The per-org toggle the anonymous read composes in SQL. The catalog entry in
 * `src/lib/org-features.ts` repeats this string; `public-calendar.test.ts` pins
 * the two, and the migration, equal.
 */
export const PUBLIC_CALENDAR_FEATURE_KEY = "org_portal.public_calendar";

/** The window the definer serves: the month before the org's current month ... */
export const PUBLIC_CALENDAR_MONTHS_BEFORE = 1;
/** ... through this many months after it (14 months in all). */
export const PUBLIC_CALENDAR_MONTHS_AFTER = 12;
/** The row cap enforced in SQL; on truncation the window shrinks to the last complete month. */
export const PUBLIC_CALENDAR_ROW_CAP = 400;
/** The most months a window can span (before + current + after). */
export const PUBLIC_CALENDAR_MAX_SPAN =
  PUBLIC_CALENDAR_MONTHS_BEFORE + 1 + PUBLIC_CALENDAR_MONTHS_AFTER;

export interface PublicCalendarEvent {
  title: string;
  /** 'YYYY-MM-DDTHH:mm' wall clock; no zone is applied anywhere. */
  startsAt: string;
  /** null when absent or not after `startsAt` (imported bad data). */
  endsAt: string | null;
  /** `startsAt.slice(0, 10)` */
  dayKey: string;
  location: string | null;
  description: string | null;
  typeName: string | null;
  /** An unknown or absent colour is "neutral". */
  typeColor: EventTypeColor;
}

export type PublicCalendar =
  | { state: "unavailable" }
  | {
      state: "available";
      /** 'YYYY-MM-DD' in the organization's own zone, from SQL. */
      orgToday: string;
      firstMonth: MonthRef;
      lastMonth: MonthRef;
      /** The row cap shrank the window: `lastMonth` is the last COMPLETE month. */
      truncated: boolean;
      /** `org_portal.calendar` composed like the public toggle; drives the sign-in prompt. */
      memberCalendarOn: boolean;
      contactPhone: string | null;
      events: PublicCalendarEvent[];
    };

export type PublicCalendarView = "month" | "list";

/**
 * The marker's `filter` is untrusted author JSON. v1 honours at most
 * `view: "month" | "list"`, by exact value; anything else - a missing key, a
 * non-string, an unknown string, a non-object `raw` - is ignored and the
 * default is `"month"`. Never throws.
 */
export function parseCalendarFilter(raw: unknown): { view: PublicCalendarView } {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const view = (raw as Record<string, unknown>).view;
    if (view === "month" || view === "list") return { view };
  }
  return { view: "month" };
}
