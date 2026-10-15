import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TIME_ZONES, useProcessTimeZone } from "@/lib/testing/time-zone";
import {
  WALL_CLOCK_TEXT_RE,
  dayKeyOf,
  describeWhen,
  formatTime,
  formatTimeCompact,
  formatTimeRange,
  minutesOfDay,
} from "./wall-clock";

describe.each(TEST_TIME_ZONES)("calendar/wall-clock under process TZ=%s", (zone) => {
  useProcessTimeZone(zone, { beforeAll, afterAll });

  it("formatTime: midnight, noon, evening, last minute, single-digit minutes", () => {
    expect(formatTime("2026-10-04T00:00")).toBe("12:00 AM");
    expect(formatTime("2026-10-04T00:30")).toBe("12:30 AM");
    expect(formatTime("2026-10-04T12:00")).toBe("12:00 PM");
    expect(formatTime("2026-10-04T19:05")).toBe("7:05 PM");
    expect(formatTime("2026-10-04T23:59")).toBe("11:59 PM");
    expect(formatTime("2026-10-04T09:00")).toBe("9:00 AM");
    expect(formatTime("2026-10-04T13:00")).toBe("1:00 PM");
  });

  it("formatTime shows a DST-gap time exactly as typed (a label, not an instant)", () => {
    expect(formatTime("2026-03-08T02:30")).toBe("2:30 AM");
    expect(formatTime("2026-11-01T01:30")).toBe("1:30 AM");
  });

  it("formatTimeCompact: 12a, 12p, 7:30p, 10a, 7p", () => {
    expect(formatTimeCompact("2026-10-04T00:00")).toBe("12a");
    expect(formatTimeCompact("2026-10-04T12:00")).toBe("12p");
    expect(formatTimeCompact("2026-10-04T19:30")).toBe("7:30p");
    expect(formatTimeCompact("2026-10-04T10:00")).toBe("10a");
    expect(formatTimeCompact("2026-10-04T19:00")).toBe("7p");
    expect(formatTimeCompact("2026-10-04T09:05")).toBe("9:05a");
  });

  it("formatTimeRange: same-day end shows the range with an en dash; next-day end shows the start only", () => {
    expect(formatTimeRange("2026-10-04T19:00", "2026-10-04T20:30")).toBe(
      "7:00 PM – 8:30 PM",
    );
    expect(formatTimeRange("2026-10-04T19:00", null)).toBe("7:00 PM");
    expect(formatTimeRange("2026-10-04T22:00", "2026-10-05T01:00")).toBe("10:00 PM");
  });

  it("describeWhen: no end, same day, different day", () => {
    expect(describeWhen("2026-10-04T19:00", null)).toEqual({
      start: "Sunday, October 4, 2026, 7:00 PM",
      end: null,
    });
    expect(describeWhen("2026-10-04T19:00", "2026-10-04T20:30")).toEqual({
      start: "Sunday, October 4, 2026, 7:00 PM – 8:30 PM",
      end: null,
    });
    expect(describeWhen("2026-10-04T19:00", "2026-10-05T09:00")).toEqual({
      start: "Sunday, October 4, 2026, 7:00 PM",
      end: "Ends Monday, October 5, 2026, 9:00 AM",
    });
  });

  it("dayKeyOf and minutesOfDay read the digits", () => {
    expect(dayKeyOf("2026-10-04T19:00")).toBe("2026-10-04");
    expect(minutesOfDay("2026-10-04T19:05")).toBe(19 * 60 + 5);
    expect(minutesOfDay("2026-10-04T00:00")).toBe(0);
  });

  it.each([
    "",
    "2026-10-04",
    "2026-10-04 19:00",
    "2026-10-04T19:00:00",
    "2026-10-04T19:00Z",
    "garbage",
    "2026-10-04T7:00",
  ])("throws on a malformed string %j", (bad) => {
    expect(() => dayKeyOf(bad)).toThrow();
    expect(() => minutesOfDay(bad)).toThrow();
    expect(() => formatTime(bad)).toThrow();
    expect(() => formatTimeCompact(bad)).toThrow();
    expect(WALL_CLOCK_TEXT_RE.test(bad)).toBe(false);
  });
});
