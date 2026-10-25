/**
 * The public events calendar's view model - PURE (no `server-only`, no React,
 * no database, no `Date` getters of the local clock), built once on the server
 * from the reader's `PublicCalendar` and handed to the panels
 * (docs/work-log/2026-10-25-public-events-calendar.md, Phase 3 "Component /
 * Page Plan"; DECISION-239/241).
 *
 * "Today" is `calendar.orgToday`, which SQL computed in the organization's own
 * zone; nothing here reads a clock, so the server render, the hydrated page and
 * a visitor in another zone all agree.
 */
import {
  buildMonthGrid,
  formatLongDate,
  formatDayHeading,
  groupByDay,
  isSameMonth,
  monthKey,
  monthLabel,
  monthOfDayKey,
  nextMonth,
  type MonthRef,
} from "@/lib/calendar/month";
import type { PublicCalendar, PublicCalendarEvent } from "@/lib/calendar/public-contract";
import type { EventTypeColor } from "@/lib/events/type-palette";

export type AvailableCalendar = Extract<PublicCalendar, { state: "available" }>;

export interface LegendEntry {
  name: string;
  color: EventTypeColor;
}

export interface DayModel {
  /** 'YYYY-MM-DD' */
  key: string;
  /** Day of the month, 1-31. */
  day: number;
  /** 0 = Sunday */
  weekday: number;
  events: PublicCalendarEvent[];
  isToday: boolean;
  /** A day of the CURRENT month before today (hidden in the list layouts until asked for). */
  isEarlier: boolean;
  /** 'Sunday, November 1' */
  heading: string;
  /** 'Sunday, November 1, 2026' */
  longLabel: string;
}

export interface MonthModel {
  /** 'YYYY-MM' */
  key: string;
  ref: MonthRef;
  /** 'November 2026' */
  label: string;
  /** Every day of the month, in order (empty days included: the desktop grid shows them). */
  days: DayModel[];
  /** The weekday of day 1 (0 = Sunday): how many empty cells lead the first grid row. */
  leadingSpacers: number;
  eventCount: number;
  /** Types present in THIS month, sorted by name. */
  legend: LegendEntry[];
  /** Current month only: some event falls on a day before today. */
  hasEarlierEvents: boolean;
  /** Current month only: earlier events exist and nothing is on or after today. */
  noMoreThisMonth: boolean;
}

export interface CalendarModel {
  months: MonthModel[];
  /** Where the island opens: the org's current month, else the nearest month in the window. */
  initialIndex: number;
  /** The index of the org's current month, or null when the window does not hold it. */
  currentIndex: number | null;
  /** The current month has earlier-day events to offer behind "Show earlier this month". */
  hasEarlierInCurrent: boolean;
  /** P6 - shown on the window's last month: what the calendar covers. */
  edgeNote: string;
}

/** The months from `first` to `last` inclusive; empty when `last` precedes `first`. */
export function monthsBetween(first: MonthRef, last: MonthRef): MonthRef[] {
  const out: MonthRef[] = [];
  let cursor: MonthRef | null = first;
  // The window is at most 14 months; the bound only protects against a bad pair.
  while (cursor && out.length < 120) {
    if (monthKey(cursor) > monthKey(last)) break;
    out.push(cursor);
    cursor = nextMonth(cursor);
  }
  return out;
}

export function buildCalendarModel(calendar: AvailableCalendar): CalendarModel {
  const todayRef = monthOfDayKey(calendar.orgToday);
  const byDay = groupByDay(calendar.events);

  const months: MonthModel[] = monthsBetween(calendar.firstMonth, calendar.lastMonth).map((ref) => {
    const isCurrent = isSameMonth(ref, todayRef);
    const grid = buildMonthGrid(ref);
    const inMonth = grid.weeks.flat().filter((d) => d.inMonth);

    const days: DayModel[] = inMonth.map((d) => ({
      key: d.key,
      day: d.day,
      weekday: d.weekday,
      events: byDay.get(d.key) ?? [],
      isToday: d.key === calendar.orgToday,
      isEarlier: isCurrent && d.key < calendar.orgToday,
      heading: formatDayHeading(d.key),
      longLabel: formatLongDate(d.key),
    }));

    const legendByName = new Map<string, LegendEntry>();
    for (const day of days) {
      for (const event of day.events) {
        if (event.typeName && !legendByName.has(event.typeName)) {
          legendByName.set(event.typeName, { name: event.typeName, color: event.typeColor });
        }
      }
    }
    const legend = [...legendByName.values()].sort((a, b) => a.name.localeCompare(b.name));

    const eventCount = days.reduce((n, d) => n + d.events.length, 0);
    const earlierWithEvents = days.some((d) => d.isEarlier && d.events.length > 0);
    const laterWithEvents = days.some((d) => !d.isEarlier && d.events.length > 0);

    return {
      key: monthKey(ref),
      ref,
      label: monthLabel(ref),
      days,
      leadingSpacers: days[0]?.weekday ?? 0,
      eventCount,
      legend,
      hasEarlierEvents: isCurrent && earlierWithEvents,
      noMoreThisMonth: isCurrent && earlierWithEvents && !laterWithEvents,
    };
  });

  const found = months.findIndex((m) => isSameMonth(m.ref, todayRef));
  const currentIndex = found === -1 ? null : found;
  // The org's month fell outside the window (a truncation can drop it): open on the nearest end.
  const initialIndex =
    currentIndex ?? (months.length > 0 && monthKey(todayRef) > months[months.length - 1]!.key ? months.length - 1 : 0);

  return {
    months,
    initialIndex,
    currentIndex,
    hasEarlierInCurrent: currentIndex !== null && months[currentIndex]!.hasEarlierEvents,
    edgeNote: `This calendar shows events through ${monthLabel(calendar.lastMonth)}.`,
  };
}
