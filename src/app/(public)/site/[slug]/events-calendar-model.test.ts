import { describe, expect, it } from "vitest";
import type { PublicCalendarEvent } from "@/lib/calendar/public-contract";
import {
  buildCalendarModel,
  monthsBetween,
  type AvailableCalendar,
} from "./events-calendar-model";

function ev(over: Partial<PublicCalendarEvent> & { startsAt: string }): PublicCalendarEvent {
  return {
    title: "Event",
    endsAt: null,
    dayKey: over.startsAt.slice(0, 10),
    location: null,
    description: null,
    typeName: null,
    typeColor: "neutral",
    ...over,
  };
}

function cal(over: Partial<AvailableCalendar> = {}): AvailableCalendar {
  return {
    state: "available",
    orgToday: "2026-11-10",
    firstMonth: { year: 2026, month: 10 },
    lastMonth: { year: 2027, month: 11 },
    truncated: false,
    memberCalendarOn: false,
    contactPhone: null,
    events: [],
    ...over,
  };
}

describe("monthsBetween", () => {
  it("lists every month inclusive across a year boundary", () => {
    const m = monthsBetween({ year: 2026, month: 11 }, { year: 2027, month: 2 });
    expect(m.map((r) => `${r.year}-${r.month}`)).toEqual(["2026-11", "2026-12", "2027-1", "2027-2"]);
  });

  it("is one month when first equals last, and empty when last precedes first", () => {
    expect(monthsBetween({ year: 2026, month: 5 }, { year: 2026, month: 5 })).toHaveLength(1);
    expect(monthsBetween({ year: 2026, month: 5 }, { year: 2026, month: 4 })).toEqual([]);
  });
});

describe("buildCalendarModel - months and today", () => {
  it("enumerates the whole 14-month window and opens on the org's current month", () => {
    const model = buildCalendarModel(cal());
    expect(model.months).toHaveLength(14);
    expect(model.months[0]!.key).toBe("2026-10");
    expect(model.months[13]!.key).toBe("2027-11");
    expect(model.currentIndex).toBe(1);
    expect(model.initialIndex).toBe(1);
    expect(model.months[1]!.label).toBe("November 2026");
    expect(model.edgeNote).toBe("This calendar shows events through November 2027.");
  });

  it("marks exactly one day as today, from the SQL orgToday", () => {
    const model = buildCalendarModel(cal());
    const todays = model.months.flatMap((m) => m.days.filter((d) => d.isToday));
    expect(todays.map((d) => d.key)).toEqual(["2026-11-10"]);
  });

  it("clamps to the nearest end when truncation drops the current month", () => {
    const model = buildCalendarModel(
      cal({ orgToday: "2026-12-05", firstMonth: { year: 2026, month: 11 }, lastMonth: { year: 2026, month: 11 }, truncated: true }),
    );
    expect(model.months).toHaveLength(1);
    expect(model.currentIndex).toBeNull();
    expect(model.initialIndex).toBe(0);
    expect(model.hasEarlierInCurrent).toBe(false);
  });

  it("clamps to the LAST month when the org's month is past the window's end", () => {
    const model = buildCalendarModel(
      cal({ orgToday: "2027-03-05", firstMonth: { year: 2026, month: 11 }, lastMonth: { year: 2027, month: 1 }, truncated: true }),
    );
    expect(model.currentIndex).toBeNull();
    expect(model.initialIndex).toBe(2);
  });
});

describe("buildCalendarModel - the days of a month", () => {
  const WEEKDAY_OF_FIRST: Array<[string, number, number]> = [
    // month, expected leading spacers (weekday of day 1; 0 = Sunday)
    ["2026-11", 0, 30], // Sunday
    ["2026-12", 2, 31], // Tuesday
    ["2027-02", 1, 28], // Monday
    ["2027-05", 6, 31], // Saturday
    ["2027-06", 2, 30], // Tuesday
    ["2027-07", 4, 31], // Thursday
    ["2027-09", 3, 30], // Wednesday
    ["2027-10", 5, 31], // Friday
  ];

  for (const [key, spacers, length] of WEEKDAY_OF_FIRST) {
    it(`${key}: ${spacers} leading spacers and ${length} days`, () => {
      const [y, m] = key.split("-").map(Number);
      const model = buildCalendarModel(
        cal({ orgToday: `${key}-01`, firstMonth: { year: y!, month: m! }, lastMonth: { year: y!, month: m! } }),
      );
      const month = model.months[0]!;
      expect(month.leadingSpacers).toBe(spacers);
      expect(month.days).toHaveLength(length);
      expect(month.days[0]!.weekday).toBe(spacers);
      expect(month.days.every((d) => d.key.startsWith(key))).toBe(true);
    });
  }

  it("handles February in a leap year (2028 has 29 days) and not in 2027 (28)", () => {
    const feb = (y: number) =>
      buildCalendarModel(
        cal({ orgToday: `${y}-02-01`, firstMonth: { year: y, month: 2 }, lastMonth: { year: y, month: 2 } }),
      ).months[0]!.days.length;
    expect(feb(2028)).toBe(29);
    expect(feb(2027)).toBe(28);
  });

  it("groups events onto their start day, keeping arrival order, and counts them", () => {
    const model = buildCalendarModel(
      cal({
        events: [
          ev({ title: "First", startsAt: "2026-11-12T09:00" }),
          ev({ title: "Second", startsAt: "2026-11-12T18:00" }),
          ev({ title: "Other", startsAt: "2026-11-20T10:00" }),
        ],
      }),
    );
    const nov = model.months[1]!;
    expect(nov.eventCount).toBe(3);
    expect(nov.days.find((d) => d.key === "2026-11-12")!.events.map((e) => e.title)).toEqual(["First", "Second"]);
    expect(nov.days.find((d) => d.key === "2026-11-11")!.events).toEqual([]);
    expect(model.months[0]!.eventCount).toBe(0);
  });

  it("gives each day a full heading and a long label", () => {
    const model = buildCalendarModel(cal());
    const first = model.months[1]!.days[0]!;
    expect(first.heading).toBe("Sunday, November 1");
    expect(first.longLabel).toBe("Sunday, November 1, 2026");
  });
});

describe("buildCalendarModel - the legend", () => {
  it("lists each type present THIS month once, sorted by name, ignoring untyped events", () => {
    const model = buildCalendarModel(
      cal({
        events: [
          ev({ startsAt: "2026-11-12T09:00", typeName: "Worship", typeColor: "teal" }),
          ev({ startsAt: "2026-11-13T09:00", typeName: "Fellowship", typeColor: "amber" }),
          ev({ startsAt: "2026-11-14T09:00", typeName: "Worship", typeColor: "teal" }),
          ev({ startsAt: "2026-11-15T09:00", typeName: null }),
          ev({ startsAt: "2026-12-02T09:00", typeName: "Study", typeColor: "sky" }),
        ],
      }),
    );
    expect(model.months[1]!.legend).toEqual([
      { name: "Fellowship", color: "amber" },
      { name: "Worship", color: "teal" },
    ]);
    expect(model.months[2]!.legend).toEqual([{ name: "Study", color: "sky" }]);
    expect(model.months[0]!.legend).toEqual([]);
  });
});

describe("buildCalendarModel - earlier days of the current month", () => {
  it("marks days before today in the current month only, and reports earlier events", () => {
    const model = buildCalendarModel(
      cal({
        events: [
          ev({ startsAt: "2026-11-03T09:00" }),
          ev({ startsAt: "2026-11-18T09:00" }),
          ev({ startsAt: "2026-10-20T09:00" }),
        ],
      }),
    );
    const nov = model.months[1]!;
    expect(nov.days.filter((d) => d.isEarlier).map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(nov.hasEarlierEvents).toBe(true);
    expect(nov.noMoreThisMonth).toBe(false);
    expect(model.hasEarlierInCurrent).toBe(true);
    // The previous month has no "earlier" notion at all.
    expect(model.months[0]!.days.some((d) => d.isEarlier)).toBe(false);
    expect(model.months[0]!.hasEarlierEvents).toBe(false);
  });

  it("says nothing remains when every event this month is before today", () => {
    const model = buildCalendarModel(cal({ events: [ev({ startsAt: "2026-11-03T09:00" })] }));
    expect(model.months[1]!.noMoreThisMonth).toBe(true);
  });

  it("an event today is not earlier", () => {
    const model = buildCalendarModel(cal({ events: [ev({ startsAt: "2026-11-10T07:00" })] }));
    expect(model.months[1]!.hasEarlierEvents).toBe(false);
    expect(model.months[1]!.noMoreThisMonth).toBe(false);
    expect(model.hasEarlierInCurrent).toBe(false);
  });

  it("with no events at all there is nothing to offer", () => {
    const model = buildCalendarModel(cal());
    expect(model.hasEarlierInCurrent).toBe(false);
    expect(model.months.every((m) => !m.noMoreThisMonth)).toBe(true);
  });
});
