import { describe, expect, it } from "vitest";
import { formatDateUTC } from "./format-date";

/**
 * `formatDateUTC()` exists to guarantee exactly the property `toLocale*()`
 * violates — a fixed instant renders identically no matter which server (or
 * developer laptop) process's `TZ` happens to run it. This spec proves that
 * by actually flipping `process.env.TZ` between two real runs, not by
 * mocking `Intl` — `Intl.DateTimeFormat` reads `TZ` at call time in Node, so
 * this is a genuine determinism check, not a tautology.
 */
describe("formatDateUTC()", () => {
  const FIXED = new Date("2026-03-14T23:30:00Z");

  it("formats a fixed instant as its UTC calendar date", () => {
    expect(formatDateUTC(FIXED)).toBe("Mar 14, 2026");
  });

  it("is deterministic across different process TZ values — regression for statistics-grants.ts:362 SSR-timezone lint violation", () => {
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const west = formatDateUTC(FIXED);

      process.env.TZ = "Pacific/Kiritimati"; // UTC+14 — the instant lands on a different local calendar day than LA
      const east = formatDateUTC(FIXED);

      expect(west).toBe(east);
      expect(west).toBe("Mar 14, 2026");
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });
});
