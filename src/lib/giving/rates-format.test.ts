import { describe, expect, it } from "vitest";
import {
  describeBankRate,
  describeCardRate,
  formatBpsAsPercent,
  formatCentsAsDollars,
  parseDollarsToCents,
  parsePercentToBps,
} from "./rates-format";

describe("rates-format", () => {
  it("parses percent to basis points exactly", () => {
    expect(parsePercentToBps("2.9")).toBe(290);
    expect(parsePercentToBps("0.80")).toBe(80);
    expect(parsePercentToBps(" 10 ")).toBe(1000);
    expect(parsePercentToBps("0.29")).toBe(29); // a float multiply would give 28.999...
    expect(parsePercentToBps("0")).toBe(0);
  });

  it("parses dollars to cents exactly", () => {
    expect(parseDollarsToCents("0.30")).toBe(30);
    expect(parseDollarsToCents("5")).toBe(500);
    expect(parseDollarsToCents("20.00")).toBe(2000);
  });

  it("rejects everything but digits and at most two decimals", () => {
    for (const bad of ["", ".5", "5.", "1e2", "-1", "1,5", "2.999", "$5", "１２", "abc", "1 2"]) {
      expect(parsePercentToBps(bad), bad).toBeNull();
      expect(parseDollarsToCents(bad), bad).toBeNull();
    }
  });

  it("formats back to the entry form", () => {
    expect(formatBpsAsPercent(290)).toBe("2.9");
    expect(formatBpsAsPercent(80)).toBe("0.8");
    expect(formatBpsAsPercent(1000)).toBe("10");
    expect(formatBpsAsPercent(5)).toBe("0.05");
    expect(formatCentsAsDollars(30)).toBe("0.30");
    expect(formatCentsAsDollars(500)).toBe("5.00");
    expect(formatCentsAsDollars(0)).toBe("0.00");
  });

  it("round-trips every value in the schema's bounds", () => {
    for (let bps = 0; bps <= 1000; bps += 1) expect(parsePercentToBps(formatBpsAsPercent(bps))).toBe(bps);
    for (let cents = 0; cents <= 2000; cents += 1) expect(parseDollarsToCents(formatCentsAsDollars(cents))).toBe(cents);
  });

  it("describes the defaults the way a treasurer says them", () => {
    expect(describeCardRate(290, 30)).toBe("2.9% + $0.30");
    expect(describeBankRate(80, 500)).toBe("0.8%, capped at $5.00");
  });
});
