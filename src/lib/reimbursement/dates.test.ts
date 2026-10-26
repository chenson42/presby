import { describe, expect, it } from "vitest";
import { addDays, expenseDateCeiling, expenseDateFloor, formatCalendarDate, isExpenseDateInWindow, isRealIsoDate } from "./dates";

describe("isRealIsoDate", () => {
  it("accepts real dates and rejects shapes and impossible days", () => {
    expect(isRealIsoDate("2026-02-28")).toBe(true);
    expect(isRealIsoDate("2028-02-29")).toBe(true);
    expect(isRealIsoDate("2026-02-29")).toBe(false);
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("2026-1-1")).toBe(false);
    expect(isRealIsoDate("10/25/2026")).toBe(false);
    expect(isRealIsoDate("")).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses month, year and leap boundaries without the server's time zone mattering", () => {
    expect(addDays("2026-10-25", 7)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // a US DST change day
  });

  it("throws on a non-date", () => {
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });
});

describe("the expense-date window (P3-18, EC35)", () => {
  const today = "2026-10-25";

  it("floor is 365 days back; ceiling is today", () => {
    expect(expenseDateFloor(today)).toBe("2025-10-25");
    expect(expenseDateCeiling(today)).toBe(today);
  });

  it("admits today and 365 days back; refuses tomorrow and 366 days back", () => {
    expect(isExpenseDateInWindow("2026-10-25", today)).toBe(true);
    expect(isExpenseDateInWindow("2025-10-25", today)).toBe(true);
    expect(isExpenseDateInWindow("2026-10-26", today)).toBe(false);
    expect(isExpenseDateInWindow("2025-10-24", today)).toBe(false);
  });

  it("refuses a non-date", () => {
    expect(isExpenseDateInWindow("2026-02-30", today)).toBe(false);
  });

  it("uses the ORGANIZATION'S date: a UTC-evening request is not 'future' when the org-local date is still yesterday", () => {
    // 02:00 UTC on the 26th is still the 25th in America/New_York; the caller passes the org-local 'today'.
    expect(isExpenseDateInWindow("2026-10-25", "2026-10-25")).toBe(true);
    expect(isExpenseDateInWindow("2026-10-25", "2026-10-24")).toBe(false);
  });
});

describe("formatCalendarDate (the date inside an action's message)", () => {
  it("writes a calendar date in words, from the digits alone, so no server zone or locale can move it", () => {
    expect(formatCalendarDate("2026-10-25")).toBe("October 25, 2026");
    expect(formatCalendarDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatCalendarDate("2028-02-29")).toBe("February 29, 2028");
    expect(formatCalendarDate("2026-12-31")).toBe("December 31, 2026");
  });

  it("throws on anything that is not a real date", () => {
    expect(() => formatCalendarDate("2026-02-30")).toThrow(RangeError);
    expect(() => formatCalendarDate("10/25/2026")).toThrow(RangeError);
  });
});
