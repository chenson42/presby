import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TIME_ZONES, useProcessTimeZone } from "@/lib/testing/time-zone";
import {
  DEFAULT_ORG_TIME_ZONE,
  isValidTimeZone,
  todayInOrgZone,
  wallClockNow,
} from "./org-time";

// The module must not depend on the process zone at all: the same fixtures
// hold under UTC (Vercel), a DST zone and a no-DST zone.
describe.each(TEST_TIME_ZONES)("org-time under process TZ=%s", (processZone) => {
  useProcessTimeZone(processZone, { beforeAll, afterAll });

  describe("wallClockNow / todayInOrgZone", () => {
    it("2026-11-01T03:30Z in New York is still Oct 31, 23:30 (the month-end evening)", () => {
      const clock = wallClockNow(new Date("2026-11-01T03:30:00Z"), "America/New_York");
      expect(clock).toEqual({
        dayKey: "2026-10-31",
        year: 2026,
        month: 10,
        day: 31,
        hour: 23,
        minute: 30,
        second: 0,
      });
    });

    it("2026-11-01T04:30Z in New York is Nov 1, 00:30 (midnight is hour 0, never 24)", () => {
      const clock = wallClockNow(new Date("2026-11-01T04:30:00Z"), "America/New_York");
      expect(clock.dayKey).toBe("2026-11-01");
      expect(clock.hour).toBe(0);
      expect(clock.minute).toBe(30);
    });

    it("2026-11-01T09:59Z in Honolulu is Oct 31, 23:59", () => {
      const clock = wallClockNow(new Date("2026-11-01T09:59:00Z"), "Pacific/Honolulu");
      expect(clock.dayKey).toBe("2026-10-31");
      expect(clock.hour).toBe(23);
      expect(clock.minute).toBe(59);
    });

    it("2026-01-01T04:59:59Z in New York is 2025-12-31 23:59:59, and 05:00:00Z is 2026-01-01 00:00:00", () => {
      expect(wallClockNow(new Date("2026-01-01T04:59:59Z"), "America/New_York")).toMatchObject({
        dayKey: "2025-12-31",
        hour: 23,
        minute: 59,
        second: 59,
      });
      expect(wallClockNow(new Date("2026-01-01T05:00:00Z"), "America/New_York")).toMatchObject({
        dayKey: "2026-01-01",
        hour: 0,
        minute: 0,
        second: 0,
      });
    });

    it("todayInOrgZone is the dayKey of the same clock", () => {
      const now = new Date("2026-11-01T03:30:00Z");
      expect(todayInOrgZone(now, "America/New_York")).toBe("2026-10-31");
      expect(todayInOrgZone(now, "UTC")).toBe("2026-11-01");
      expect(todayInOrgZone(now, "Pacific/Honolulu")).toBe("2026-10-31");
    });

    it("follows the zone across the DST boundary (fall back: 01:30 happens twice)", () => {
      // 05:30Z is 01:30 EDT; 06:30Z is 01:30 EST — same wall-clock digits.
      expect(wallClockNow(new Date("2026-11-01T05:30:00Z"), "America/New_York")).toMatchObject({
        hour: 1,
        minute: 30,
      });
      expect(wallClockNow(new Date("2026-11-01T06:30:00Z"), "America/New_York")).toMatchObject({
        hour: 1,
        minute: 30,
      });
    });

    it("pads single-digit months and days in the day key", () => {
      expect(todayInOrgZone(new Date("2026-03-05T12:00:00Z"), "America/Chicago")).toBe("2026-03-05");
    });

    it("throws a RangeError for a zone ICU does not know", () => {
      expect(() => wallClockNow(new Date(), "Nope/Zone")).toThrow(RangeError);
    });
  });

  describe("isValidTimeZone", () => {
    it.each([
      ["America/New_York", true],
      ["America/Argentina/Buenos_Aires", true],
      ["Etc/GMT+5", true],
      ["Pacific/Honolulu", true],
      ["UTC+5", false],
      ["EST", false],
      ["UTC", false],
      ["Nope/Zone", false],
      ["", false],
      [null, false],
      [undefined, false],
      [42, false],
      [{}, false],
      ["America/New_York; drop table", false],
    ])("%j -> %s", (value, expected) => {
      expect(isValidTimeZone(value)).toBe(expected);
    });
  });
});

describe("DEFAULT_ORG_TIME_ZONE", () => {
  it("is a valid zone", () => {
    expect(isValidTimeZone(DEFAULT_ORG_TIME_ZONE)).toBe(true);
    expect(DEFAULT_ORG_TIME_ZONE).toBe("America/New_York");
  });
});
