import { describe, expect, it } from "vitest";
import { formatAge } from "./format-age";

describe("formatAge", () => {
  it("renders nothing-waiting as a dash", () => {
    expect(formatAge(null)).toBe("–");
    expect(formatAge(undefined)).toBe("–");
    expect(formatAge(-5)).toBe("–");
    expect(formatAge(Number.NaN)).toBe("–");
  });
  it("renders minutes, hours and days in plain words", () => {
    expect(formatAge(0)).toBe("under a minute");
    expect(formatAge(59)).toBe("under a minute");
    expect(formatAge(60)).toBe("1 min");
    expect(formatAge(3599)).toBe("59 min");
    expect(formatAge(3600)).toBe("1 h");
    expect(formatAge(3600 + 20 * 60)).toBe("1 h 20 min");
    expect(formatAge(86400)).toBe("1 day");
    expect(formatAge(86400 * 3 + 5000)).toBe("3 days");
  });
});
