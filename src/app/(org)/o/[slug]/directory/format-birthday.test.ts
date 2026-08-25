import { describe, expect, it } from "vitest";
import { formatBirthdayMonthDay } from "./format-birthday";

describe("formatBirthdayMonthDay", () => {
  it("renders the month name and day, no year", () => {
    expect(formatBirthdayMonthDay("1958-04-11")).toBe("April 11");
  });

  it("does not shift by timezone — a single-digit day stays that day", () => {
    expect(formatBirthdayMonthDay("2011-03-08")).toBe("March 8");
  });

  it("handles December (month index boundary)", () => {
    expect(formatBirthdayMonthDay("1990-12-25")).toBe("December 25");
  });

  it("handles January (month index boundary)", () => {
    expect(formatBirthdayMonthDay("1990-01-01")).toBe("January 1");
  });

  it("falls back to the raw string for a malformed value rather than crashing", () => {
    expect(formatBirthdayMonthDay("not-a-date")).toBe("not-a-date");
  });
});
