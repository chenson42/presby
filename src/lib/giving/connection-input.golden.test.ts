/**
 * Characterization tests for `connectionRatesSchema`, written on zod 3.25.76
 * before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 B, F229).
 * The first message per field is what the treasurer sees, so it is pinned for
 * every kind of input, including the huge integers where a plain port of
 * `.int()` would change the first message.
 */
import { describe, expect, it } from "vitest";
import { connectionRatesSchema } from "./connection-input";
import { zodFieldErrors } from "./field-errors";

const OK = { cardFeeBps: 290, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 };

const FIELDS = [
  { key: "cardFeeBps", label: "Card percentage (basis points)", min: 0, max: 1000 },
  { key: "cardFeeFixedCents", label: "Card fixed fee (cents)", min: 0, max: 100 },
  { key: "achFeeBps", label: "Bank percentage (basis points)", min: 0, max: 500 },
  { key: "achFeeCapCents", label: "Bank fee cap (cents)", min: 0, max: 2000 },
] as const;

function first(input: Record<string, unknown>, key: string): string | undefined {
  const result = connectionRatesSchema.safeParse(input);
  if (result.success) return undefined;
  return zodFieldErrors(result.error)[key];
}

describe("connectionRatesSchema", () => {
  it("accepts valid rates and returns them unchanged", () => {
    expect(connectionRatesSchema.parse(OK)).toEqual(OK);
  });

  it("is idempotent over its own output", () => {
    const first = connectionRatesSchema.parse(OK);
    expect(connectionRatesSchema.parse(first)).toEqual(first);
  });

  describe.each(FIELDS)("$key", ({ key, label, min, max }) => {
    const whole = `${label} must be a whole number.`;
    const between = `${label} must be between ${min} and ${max}.`;
    const at = (value: unknown) => first({ ...OK, [key]: value }, key);

    it("accepts the exact bounds", () => {
      expect(at(min)).toBeUndefined();
      expect(at(max)).toBeUndefined();
    });

    it("says it is required when the key is missing or undefined", () => {
      const { [key]: _omitted, ...rest } = OK as Record<string, number>;
      expect(first(rest, key)).toBe(`${label} is required.`);
      expect(at(undefined)).toBe(`${label} is required.`);
    });

    it.each([
      ["NaN (an emptied number input)", Number.NaN],
      ["null", null],
      ['"3"', "3"],
      ['""', ""],
      ["{}", {}],
      ["[]", []],
      ["true", true],
    ])("says whole number for a non-number: %s", (_name, value) => {
      expect(at(value)).toBe(whole);
    });

    it.each([
      ["1.5", 1.5],
      ["-1.5", -1.5],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
    ])("says whole number for %s", (_name, value) => {
      expect(at(value)).toBe(whole);
    });

    it("says between for an out-of-range integer", () => {
      expect(at(min - 1)).toBe(between);
      expect(at(max + 1)).toBe(between);
    });

    it.each([
      ["1e20", 1e20],
      ["-1e20", -1e20],
      ["2 ** 53", 2 ** 53],
      ["2 ** 60", 2 ** 60],
      ["-(2 ** 60)", -(2 ** 60)],
      ["Number.MAX_VALUE", Number.MAX_VALUE],
    ])("says between (not whole number) for the huge integer %s", (_name, value) => {
      expect(at(value)).toBe(between);
    });

    it("reports the whole-number check first for a fractional value, in or out of range", () => {
      expect(at(max + 0.5)).toBe(whole);
      expect(at(min - 0.5)).toBe(whole);
      expect(at(min + 0.5)).toBe(whole);
    });
  });

  it("reports every failing field together, one message each", () => {
    const result = connectionRatesSchema.safeParse({
      cardFeeBps: 1001,
      cardFeeFixedCents: Number.NaN,
      achFeeBps: undefined,
      achFeeCapCents: 2000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodFieldErrors(result.error)).toEqual({
        cardFeeBps: "Card percentage (basis points) must be between 0 and 1000.",
        cardFeeFixedCents: "Card fixed fee (cents) must be a whole number.",
        achFeeBps: "Bank percentage (basis points) is required.",
      });
    }
  });
});
