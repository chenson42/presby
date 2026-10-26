import { describe, expect, it } from "vitest";
import {
  centsToInputText,
  digitsToCents,
  formatMoney,
  isAmountInRange,
  pastedAmountToCents,
} from "./amount-input";
import { MAX_AMOUNT_CENTS } from "./limits";

describe("digitsToCents (the digit-entry control)", () => {
  it("reads typed digits as cents", () => {
    expect(digitsToCents("")).toBe(0);
    expect(digitsToCents("5")).toBe(5);
    expect(digitsToCents("1250")).toBe(1250);
    expect(digitsToCents("10000000")).toBe(10_000_000);
  });

  it("ignores leading zeros", () => {
    expect(digitsToCents("0001250")).toBe(1250);
    expect(digitsToCents("000")).toBe(0);
  });

  it("refuses anything that is not ASCII 0-9 (EC3: hostile strings never become a wrong amount)", () => {
    for (const hostile of ["1e5", "12.5", "-5", "+5", "$12", "1,2", "1 2", "٣", "１２", "0x10", " 5", "5 "]) {
      expect(digitsToCents(hostile), hostile).toBeNull();
    }
  });

  it("refuses more digits than any legal amount has", () => {
    expect(digitsToCents("100000000")).toBeNull();
    expect(digitsToCents("99999999")).toBe(99_999_999); // not range-checked; isAmountInRange decides
  });
});

describe("pastedAmountToCents (strict, never rounds)", () => {
  it("reads exactly a dollar amount", () => {
    expect(pastedAmountToCents("12")).toBe(1200);
    expect(pastedAmountToCents("12.5")).toBe(1250);
    expect(pastedAmountToCents("12.50")).toBe(1250);
    expect(pastedAmountToCents("0.01")).toBe(1);
    expect(pastedAmountToCents("$12.34")).toBe(1234);
    expect(pastedAmountToCents("$ 12.34")).toBe(1234);
    expect(pastedAmountToCents(" 1,234.56 ")).toBe(123_456);
    expect(pastedAmountToCents("100,000.00")).toBe(10_000_000);
  });

  it("is null for hostile or ambiguous text (EC3): exponent, sign, rounding, misplaced commas, non-ASCII digits", () => {
    for (const hostile of [
      "",
      " ",
      "1e5",
      "1E5",
      "-5",
      "+5",
      "12.345",
      "12.",
      ".5",
      "$1,2",
      "1,23",
      "12,34",
      "1234,567",
      "1,234,5",
      "٣",
      "１２",
      "$$5",
      "5$",
      "12 34",
      "12.34.56",
      "abc",
      "NaN",
      "Infinity",
    ]) {
      expect(pastedAmountToCents(hostile), JSON.stringify(hostile)).toBeNull();
    }
  });

  it("does not produce an unsafe number from a very long paste", () => {
    expect(pastedAmountToCents("9".repeat(40))).toBeNull();
  });
});

describe("isAmountInRange", () => {
  it("accepts 1 through 10,000,000 cents and only integers", () => {
    expect(isAmountInRange(1)).toBe(true);
    expect(isAmountInRange(MAX_AMOUNT_CENTS)).toBe(true);
    expect(isAmountInRange(0)).toBe(false);
    expect(isAmountInRange(MAX_AMOUNT_CENTS + 1)).toBe(false);
    expect(isAmountInRange(12.5)).toBe(false);
    expect(isAmountInRange(-1)).toBe(false);
    expect(isAmountInRange("100")).toBe(false);
    expect(isAmountInRange(NaN)).toBe(false);
  });
});

describe("display", () => {
  it("centsToInputText has no symbol or grouping", () => {
    expect(centsToInputText(0)).toBe("0.00");
    expect(centsToInputText(5)).toBe("0.05");
    expect(centsToInputText(123_456)).toBe("1234.56");
  });

  it("formatMoney groups thousands", () => {
    expect(formatMoney(1)).toBe("$0.01");
    expect(formatMoney(123_456)).toBe("$1,234.56");
    expect(formatMoney(MAX_AMOUNT_CENTS)).toBe("$100,000.00");
  });

  it("refuses a negative or fractional number rather than rendering it", () => {
    expect(() => formatMoney(-1)).toThrow(RangeError);
    expect(() => formatMoney(1.5)).toThrow(RangeError);
    expect(() => centsToInputText(-1)).toThrow(RangeError);
  });

  it("round-trips: what the input shows, a paste reads back", () => {
    for (const cents of [1, 99, 100, 1250, 99_999, 10_000_000]) {
      expect(pastedAmountToCents(centsToInputText(cents))).toBe(cents);
      expect(pastedAmountToCents(formatMoney(cents))).toBe(cents);
    }
  });
});
