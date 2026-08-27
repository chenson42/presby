import { describe, expect, it } from "vitest";
import {
  MAX_SERIES_TOTAL,
  buildDayOfWeekPattern,
  formatPattern,
  generateRecurringDates,
  getNextOccurrence,
  isChildEvent,
  isParentEvent,
  isRecurringEvent,
  parsePattern,
  seriesTotalWithinCap,
} from "./recurrence";

describe("parsePattern", () => {
  it("parses each simple pattern", () => {
    expect(parsePattern("weekly")).toEqual({ type: "simple", value: "weekly" });
    expect(parsePattern("biweekly")).toEqual({ type: "simple", value: "biweekly" });
    expect(parsePattern("monthly")).toEqual({ type: "simple", value: "monthly" });
  });

  it("parses a day-of-week pattern", () => {
    expect(parsePattern("2nd Tuesday")).toEqual({
      type: "dayofweek",
      value: { ordinal: "2nd", day: "Tuesday" },
    });
    expect(parsePattern("last Friday")).toEqual({
      type: "dayofweek",
      value: { ordinal: "last", day: "Friday" },
    });
  });

  it("is case-insensitive on the ordinal", () => {
    expect(parsePattern("1ST Monday")).toEqual({
      type: "dayofweek",
      value: { ordinal: "1st", day: "Monday" },
    });
  });

  it("throws on an unrecognized pattern", () => {
    expect(() => parsePattern("fortnightly")).toThrow(/Invalid recurrence pattern/);
    expect(() => parsePattern("6th Tuesday")).toThrow(/Invalid recurrence pattern/);
    expect(() => parsePattern("2nd Someday")).toThrow(/Invalid recurrence pattern/);
  });
});

describe("getNextOccurrence — simple patterns", () => {
  it("weekly adds 7 days", () => {
    const next = getNextOccurrence(new Date(2026, 8, 1, 19, 0), "weekly");
    expect(next).toEqual(new Date(2026, 8, 8, 19, 0));
  });

  it("biweekly adds 14 days", () => {
    const next = getNextOccurrence(new Date(2026, 8, 1, 19, 0), "biweekly");
    expect(next).toEqual(new Date(2026, 8, 15, 19, 0));
  });

  it("monthly advances the month, preserving time-of-day", () => {
    const next = getNextOccurrence(new Date(2026, 8, 1, 19, 0), "monthly");
    expect(next).toEqual(new Date(2026, 9, 1, 19, 0));
  });

  it("monthly rolls over into the following month when the day doesn't exist there (documented JS Date behavior, not clamped)", () => {
    // Jan 31 + 1 month → JS's setMonth() overflows into March, since
    // February has no 31st. Ported as-is from fpcw — not a defect this
    // pipeline introduces or fixes.
    const next = getNextOccurrence(new Date(2026, 0, 31, 9, 0), "monthly");
    expect(next).toEqual(new Date(2026, 2, 3, 9, 0));
  });
});

describe("getNextOccurrence — day-of-week patterns", () => {
  it("finds the 2nd Tuesday of the following month", () => {
    // 2026-09-01 is a Tuesday. "2nd Tuesday" starting from September should
    // land on the 2nd Tuesday of OCTOBER (next month), not September itself
    // — generateRecurringDates seeds the series' own first date directly;
    // getNextOccurrence always looks forward one month.
    const next = getNextOccurrence(new Date(2026, 8, 1, 19, 0), "2nd Tuesday");
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(9); // October
    expect(next.getDay()).toBe(2); // Tuesday
    expect(next.getDate()).toBe(13);
    expect(next.getHours()).toBe(19);
  });

  it("finds the last Friday of the following month, across a short month", () => {
    // From January, "last Friday" should land in February.
    const next = getNextOccurrence(new Date(2026, 0, 15, 18, 30), "last Friday");
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDay()).toBe(5); // Friday
    expect(next.getHours()).toBe(18);
    expect(next.getMinutes()).toBe(30);
  });

  it("wraps December into January of the following year", () => {
    const next = getNextOccurrence(new Date(2026, 11, 1, 10, 0), "1st Monday");
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0); // January
    expect(next.getDay()).toBe(1); // Monday
  });
});

describe("generateRecurringDates", () => {
  it("returns an empty array for count < 1", () => {
    expect(generateRecurringDates(new Date(2026, 8, 1), "weekly", 0)).toEqual([]);
  });

  it("returns exactly `count` dates, the first being the start date itself", () => {
    const start = new Date(2026, 8, 1, 19, 0);
    const dates = generateRecurringDates(start, "weekly", 4);
    expect(dates).toHaveLength(4);
    expect(dates[0]).toEqual(start);
    expect(dates[1]).toEqual(new Date(2026, 8, 8, 19, 0));
    expect(dates[2]).toEqual(new Date(2026, 8, 15, 19, 0));
    expect(dates[3]).toEqual(new Date(2026, 8, 22, 19, 0));
  });

  it("generates the full MAX_SERIES_TOTAL (52) weekly occurrences without error", () => {
    const start = new Date(2026, 0, 4, 9, 0); // a Sunday
    const dates = generateRecurringDates(start, "weekly", MAX_SERIES_TOTAL);
    expect(dates).toHaveLength(52);
    // 51 weeks later.
    const expectedLast = new Date(2026, 0, 4 + 51 * 7, 9, 0);
    expect(dates[51]).toEqual(expectedLast);
  });
});

describe("MAX_SERIES_TOTAL / seriesTotalWithinCap — the 52-occurrence series-total cap (DECISION-115)", () => {
  it("MAX_SERIES_TOTAL is 52", () => {
    expect(MAX_SERIES_TOTAL).toBe(52);
  });

  it("accepts a creation count of exactly 52", () => {
    expect(seriesTotalWithinCap(52)).toBe(true);
  });

  it("rejects a creation count of 53", () => {
    expect(seriesTotalWithinCap(53)).toBe(false);
  });

  it("accepts a creation count of 1 (a single, non-recurring occurrence)", () => {
    expect(seriesTotalWithinCap(1)).toBe(true);
  });

  it("rejects 0 and negative counts", () => {
    expect(seriesTotalWithinCap(0)).toBe(false);
    expect(seriesTotalWithinCap(-1)).toBe(false);
  });

  it("rejects a non-integer count", () => {
    expect(seriesTotalWithinCap(4.5)).toBe(false);
  });

  it("extension total at exactly the cap is accepted — existingCount 40 + additionalCount 12", () => {
    expect(seriesTotalWithinCap(40 + 12)).toBe(true);
  });

  it("extension total one past the cap is rejected — existingCount 50 + additionalCount 3, counted against the SERIES TOTAL, not per-call", () => {
    expect(seriesTotalWithinCap(50 + 3)).toBe(false);
  });

  it("a series already at the cap cannot be extended by even 1 more", () => {
    expect(seriesTotalWithinCap(52 + 1)).toBe(false);
  });
});

describe("formatPattern / buildDayOfWeekPattern", () => {
  it("formats every simple pattern via PATTERN_LABELS", () => {
    expect(formatPattern("weekly")).toBe("Weekly");
    expect(formatPattern("biweekly")).toBe("Every 2 weeks");
    expect(formatPattern("monthly")).toBe("Monthly (same date)");
  });

  it("passes a day-of-week pattern through unchanged (already human-readable)", () => {
    expect(formatPattern("2nd Tuesday")).toBe("2nd Tuesday");
  });

  it("builds a day-of-week pattern string", () => {
    expect(buildDayOfWeekPattern("last", "Friday")).toBe("last Friday");
  });
});

describe("isRecurringEvent / isParentEvent / isChildEvent", () => {
  it("a standalone event is neither a parent nor a child", () => {
    const standalone = { parentEventId: null, recurrencePattern: null };
    expect(isRecurringEvent(standalone)).toBe(false);
    expect(isParentEvent(standalone)).toBe(false);
    expect(isChildEvent(standalone)).toBe(false);
  });

  it("a series parent has a pattern and no parentEventId", () => {
    const parent = { parentEventId: null, recurrencePattern: "weekly" };
    expect(isRecurringEvent(parent)).toBe(true);
    expect(isParentEvent(parent)).toBe(true);
    expect(isChildEvent(parent)).toBe(false);
  });

  it("a generated child has a parentEventId and no pattern of its own", () => {
    const child = { parentEventId: "some-uuid", recurrencePattern: null };
    expect(isRecurringEvent(child)).toBe(true);
    expect(isParentEvent(child)).toBe(false);
    expect(isChildEvent(child)).toBe(true);
  });
});
