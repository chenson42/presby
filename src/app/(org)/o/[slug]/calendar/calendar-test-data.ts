/**
 * Fixture builders shared by the calendar route's component and page tests.
 * Test support only - nothing in the app imports this file. Invented data
 * (CLAUDE.md -> No Real Data).
 */
import type { CalendarEntry, MemberEventType, MonthCalendarData } from "@/lib/calendar";

export const WORSHIP_TYPE: MemberEventType = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Worship",
  colorToken: "teal",
  iconKey: "Church",
};
export const STUDY_TYPE: MemberEventType = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Study",
  colorToken: "sky",
  iconKey: "BookOpen",
};
export const GENERAL_TYPE: MemberEventType = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "General",
  colorToken: "neutral",
  iconKey: "CalendarDays",
};

export function makeEntry(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  const startsAtWallClock = overrides.startsAtWallClock ?? "2026-10-04T10:00";
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Sunday worship",
    startsAtWallClock,
    endsAtWallClock: null,
    dayKey: startsAtWallClock.slice(0, 10),
    location: "Sanctuary",
    isPublic: true,
    eventType: WORSHIP_TYPE,
    ...overrides,
  };
}

export function makeMonthData(overrides: Partial<MonthCalendarData> = {}): MonthCalendarData {
  const entries = overrides.entries ?? [makeEntry()];
  return {
    month: { year: 2026, month: 10 },
    isCurrentMonth: true,
    timeZone: "America/New_York",
    todayKey: "2026-10-14",
    entries,
    types: [WORSHIP_TYPE, STUDY_TYPE, GENERAL_TYPE],
    activeTypeIds: [],
    inMonthCount: entries.length,
    unfilteredInMonthCount: entries.length,
    orgHasEvents: true,
    canManage: false,
    ...overrides,
  };
}
