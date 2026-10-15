import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TIME_ZONES, useProcessTimeZone } from "@/lib/testing/time-zone";
import {
  MAX_CALENDAR_YEAR,
  MIN_CALENDAR_YEAR,
  MONTH_NAMES,
  WEEKDAY_ABBREVIATIONS,
  WEEKDAY_NAMES,
  addDays,
  buildMonthGrid,
  formatClipboardDay,
  formatDayHeading,
  formatLongDate,
  formatShortDate,
  isDayKey,
  isSameMonth,
  monthKey,
  monthLabel,
  monthOfDayKey,
  nextMonth,
  parseMonthParam,
  prevMonth,
} from "./month";

describe.each(TEST_TIME_ZONES)("calendar/month under process TZ=%s", (zone) => {
  useProcessTimeZone(zone, { beforeAll, afterAll });

  describe("buildMonthGrid fixtures", () => {
    it("October 2026: 2026-09-27 .. 2026-10-31, 5 weeks, half-open bound 2026-11-01", () => {
      const grid = buildMonthGrid({ year: 2026, month: 10 });
      expect(grid.firstKey).toBe("2026-09-27");
      expect(grid.lastKey).toBe("2026-10-31");
      expect(grid.dayAfterLastKey).toBe("2026-11-01");
      expect(grid.weeks).toHaveLength(5);
      expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    });

    it("February 2026: exactly four weeks, 2026-02-01 .. 2026-02-28", () => {
      const grid = buildMonthGrid({ year: 2026, month: 2 });
      expect(grid.firstKey).toBe("2026-02-01");
      expect(grid.lastKey).toBe("2026-02-28");
      expect(grid.weeks).toHaveLength(4);
    });

    it("December 2026 crosses into the next year: 2026-11-29 .. 2027-01-02", () => {
      const grid = buildMonthGrid({ year: 2026, month: 12 });
      expect(grid.firstKey).toBe("2026-11-29");
      expect(grid.lastKey).toBe("2027-01-02");
      expect(grid.dayAfterLastKey).toBe("2027-01-03");
    });

    it("January 2000 (the first month) is six weeks: 1999-12-26 .. 2000-02-05", () => {
      const grid = buildMonthGrid({ year: 2000, month: 1 });
      expect(grid.firstKey).toBe("1999-12-26");
      expect(grid.lastKey).toBe("2000-02-05");
      expect(grid.weeks).toHaveLength(6);
    });

    it("December 2100 (the last month): 2100-11-28 .. 2101-01-01", () => {
      const grid = buildMonthGrid({ year: 2100, month: 12 });
      expect(grid.firstKey).toBe("2100-11-28");
      expect(grid.lastKey).toBe("2101-01-01");
      expect(grid.dayAfterLastKey).toBe("2101-01-02");
    });

    it("flags in-month days, numbers weekdays Sunday=0, and keys are consecutive", () => {
      const grid = buildMonthGrid({ year: 2026, month: 10 });
      const flat = grid.weeks.flat();
      expect(flat.filter((d) => d.inMonth)).toHaveLength(31);
      expect(flat[0]).toEqual({ key: "2026-09-27", day: 27, inMonth: false, weekday: 0 });
      expect(flat.find((d) => d.key === "2026-10-01")).toMatchObject({ inMonth: true, weekday: 4 });
      flat.forEach((d, i) => {
        if (i > 0) expect(d.key).toBe(addDays(flat[i - 1].key, 1));
        expect(d.weekday).toBe(i % 7);
      });
    });

    it("covers every month 2000-01 .. 2100-12 with whole weeks (4-6 rows) and no gaps", () => {
      for (let year = MIN_CALENDAR_YEAR; year <= MAX_CALENDAR_YEAR; year += 1) {
        for (let month = 1; month <= 12; month += 1) {
          const grid = buildMonthGrid({ year, month });
          expect(grid.weeks.length).toBeGreaterThanOrEqual(4);
          expect(grid.weeks.length).toBeLessThanOrEqual(6);
          expect(grid.weeks[0][0].weekday).toBe(0);
          expect(grid.weeks.flat().filter((d) => d.inMonth).length).toBeGreaterThanOrEqual(28);
        }
      }
    });
  });

  describe("parseMonthParam", () => {
    it.each([
      ["2026-10", { year: 2026, month: 10 }],
      ["2000-01", { year: 2000, month: 1 }],
      ["2100-12", { year: 2100, month: 12 }],
    ])("accepts %s", (raw, expected) => {
      expect(parseMonthParam(raw)).toEqual(expected);
    });

    it.each(["0000-01", "1999-12", "2101-01", "2026-13", "2026-00", "2026-1", "", "2026-10-01", " 2026-10", "garbage"])(
      "rejects %j",
      (raw) => {
        expect(parseMonthParam(raw)).toBeNull();
      },
    );

    it("rejects undefined and uses the first element of an array", () => {
      expect(parseMonthParam(undefined)).toBeNull();
      expect(parseMonthParam(["junk", "2026-10"])).toBeNull();
      expect(parseMonthParam(["2026-10", "junk"])).toEqual({ year: 2026, month: 10 });
      expect(parseMonthParam([])).toBeNull();
    });
  });

  describe("navigation", () => {
    it("prev/next cross year boundaries", () => {
      expect(prevMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
      expect(nextMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
      expect(prevMonth({ year: 2026, month: 10 })).toEqual({ year: 2026, month: 9 });
      expect(nextMonth({ year: 2026, month: 10 })).toEqual({ year: 2026, month: 11 });
    });

    it("are null at the ends of the supported range", () => {
      expect(prevMonth({ year: 2000, month: 1 })).toBeNull();
      expect(nextMonth({ year: 2100, month: 12 })).toBeNull();
      expect(prevMonth({ year: 2000, month: 2 })).toEqual({ year: 2000, month: 1 });
      expect(nextMonth({ year: 2100, month: 11 })).toEqual({ year: 2100, month: 12 });
    });
  });

  describe("keys and labels", () => {
    it("monthKey pads; monthOfDayKey inverts; monthLabel names", () => {
      expect(monthKey({ year: 2026, month: 3 })).toBe("2026-03");
      expect(monthOfDayKey("2026-10-31")).toEqual({ year: 2026, month: 10 });
      expect(monthLabel({ year: 2026, month: 10 })).toBe("October 2026");
      expect(isSameMonth({ year: 2026, month: 10 }, { year: 2026, month: 10 })).toBe(true);
      expect(isSameMonth({ year: 2026, month: 10 }, { year: 2025, month: 10 })).toBe(false);
    });

    it("has twelve months and seven weekdays with three-letter abbreviations", () => {
      expect(MONTH_NAMES).toHaveLength(12);
      expect(WEEKDAY_NAMES).toHaveLength(7);
      expect(WEEKDAY_ABBREVIATIONS).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    });
  });

  describe("addDays", () => {
    it("crosses month and year ends in both directions", () => {
      expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
      expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
      expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
      expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
      expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
      expect(addDays("2026-10-04", 0)).toBe("2026-10-04");
    });

    it("steps over a DST change by whole days (no hour drift)", () => {
      expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
      expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
      expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    });
  });

  describe("isDayKey", () => {
    it("accepts real dates only", () => {
      expect(isDayKey("2026-10-04")).toBe(true);
      expect(isDayKey("2028-02-29")).toBe(true);
      expect(isDayKey("2026-02-29")).toBe(false);
      expect(isDayKey("2026-02-30")).toBe(false);
      expect(isDayKey("2026-13-01")).toBe(false);
      expect(isDayKey("2026-00-10")).toBe(false);
      expect(isDayKey("2026-10-00")).toBe(false);
      expect(isDayKey("2026-1-04")).toBe(false);
      expect(isDayKey("")).toBe(false);
      expect(isDayKey("2026-10-04T10:00")).toBe(false);
    });
  });

  describe("formatters", () => {
    it("formatDayHeading / formatShortDate / formatLongDate / formatClipboardDay", () => {
      expect(formatDayHeading("2026-10-04")).toBe("Sunday, October 4");
      expect(formatShortDate("2026-10-04")).toBe("Sun, Oct 4");
      expect(formatLongDate("2026-10-04")).toBe("Sunday, October 4, 2026");
      expect(formatClipboardDay("2026-10-04")).toBe("Sun Oct 4");
      expect(formatShortDate("2026-12-31")).toBe("Thu, Dec 31");
      expect(formatLongDate("2027-01-01")).toBe("Friday, January 1, 2027");
    });

    it("never shifts a date because of the process zone (month ends and the DST days)", () => {
      expect(formatLongDate("2026-11-01")).toBe("Sunday, November 1, 2026");
      expect(formatLongDate("2026-03-08")).toBe("Sunday, March 8, 2026");
      expect(formatShortDate("2026-10-31")).toBe("Sat, Oct 31");
    });
  });
});
