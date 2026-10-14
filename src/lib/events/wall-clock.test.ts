import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TIME_ZONES, useProcessTimeZone } from "../testing/time-zone";
import { formatWallClock, parseWallClock } from "./wall-clock";
import { generateRecurringDates } from "./recurrence";

/**
 * F134 regression. drizzle-orm writes a `timestamp` (no zone) column with
 * `value.toISOString()` and reads it back by appending "+0000", so a `Date` is
 * a faithful carrier of wall-clock digits only if its UTC fields hold them.
 * These assertions sit at the driver boundary on purpose: a within-process
 * round trip passes with the old symmetric LOCAL code, which is exactly why
 * the bug hid.
 */

/** What Drizzle sends for a `timestamp` (no zone) column. */
const sentToDriver = (d: Date) => d.toISOString();
/** What Drizzle hands back for a raw 'YYYY-MM-DD HH:MM:SS' read. */
const readFromDriver = (raw: string) => new Date(raw + "+0000");

describe.each(TEST_TIME_ZONES)("wall-clock codec under TZ=%s (F134)", (tz) => {
  useProcessTimeZone(tz, { beforeAll, afterAll });

  it("stores the typed digits: parseWallClock's driver value carries them verbatim — regression for typed event times shifting off-UTC", () => {
    expect(sentToDriver(parseWallClock("2026-10-14T19:00"))).toBe(
      "2026-10-14T19:00:00.000Z",
    );
    expect(sentToDriver(parseWallClock("2026-01-05T00:00:30"))).toBe(
      "2026-01-05T00:00:30.000Z",
    );
  });

  it("round-trips through the driver's own read, including a nonexistent and a doubled local time", () => {
    for (const typed of [
      "2026-10-14T19:00",
      "2026-11-01T01:30", // doubled in America/New_York
      "2026-03-08T02:30", // nonexistent in America/New_York
      "2026-12-31T23:59",
    ]) {
      const written = sentToDriver(parseWallClock(typed))
        .replace("T", " ")
        .replace(".000Z", "");
      expect(formatWallClock(readFromDriver(written))).toBe(`${typed}:00`);
    }
  });

  it("a weekly series across the US DST end keeps the same digits (the F134 drift) — regression for one-hour-off recurring events", () => {
    const dates = generateRecurringDates(
      parseWallClock("2026-10-25T19:00"),
      "weekly",
      3,
    );
    expect(dates.map(sentToDriver)).toEqual([
      "2026-10-25T19:00:00.000Z",
      "2026-11-01T19:00:00.000Z",
      "2026-11-08T19:00:00.000Z",
    ]);
  });

  it("rejects a malformed string", () => {
    expect(() => parseWallClock("2026-10-14 19:00")).toThrow(/parseWallClock/);
  });
});
