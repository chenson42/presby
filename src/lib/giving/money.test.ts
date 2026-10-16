/**
 * Pure unit tests for src/lib/giving/money.ts — parse to the digit, format,
 * and the TS gross-up against the exact values `scripts/giving/test-rls-46.sql`
 * (46l) pins for presby_giving_gross_up(). The DB-backed grid that proves
 * TS == SQL over every amount x method x rate set is `money.db.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AMOUNT_BOUNDS,
  DEFAULT_RATES,
  formatCents,
  grossUp,
  parseAmountToCents,
} from "./money";

describe("parseAmountToCents — accepted shapes (online)", () => {
  it.each([
    ["1", 100],
    ["1.00", 100],
    ["1.0", 100],
    ["1.5", 150],
    ["50", 5000],
    ["50.25", 5025],
    ["0.99", null], // below the $1.00 online floor
    ["  25  ", 2500],
    ["007", 700],
    ["25000", 2_500_000],
    ["25000.00", 2_500_000],
    ["99999", null], // above the $25,000 online ceiling
  ])("%j", (input, expected) => {
    const r = parseAmountToCents(input);
    if (expected === null) expect(r.ok).toBe(false);
    else expect(r).toEqual({ ok: true, cents: expected });
  });

  it("is exact on the boundaries: $1.00 in, $0.99 too_small, $25,000.00 in, $25,000.01 too_large", () => {
    expect(parseAmountToCents("1.00")).toEqual({ ok: true, cents: 100 });
    expect(parseAmountToCents("0.99")).toEqual({ ok: false, reason: "too_small" });
    expect(parseAmountToCents("25000.00")).toEqual({ ok: true, cents: 2_500_000 });
    expect(parseAmountToCents("25000.01")).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("parseAmountToCents — rejections", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["\t\n", "empty"],
    ["1e3", "format"],
    ["1E3", "format"],
    ["-5", "format"],
    ["+5", "format"],
    ["１２", "format"], // fullwidth digits
    ["١٢", "format"], // Arabic-Indic digits
    ["10.999", "format"],
    ["10.", "format"],
    [".5", "format"],
    ["1,000", "format"],
    ["1 000", "format"],
    ["$5", "format"],
    ["5 dollars", "format"],
    ["NaN", "format"],
    ["Infinity", "format"],
    ["0x10", "format"],
    ["5.5.5", "format"],
    ["0", "too_small"],
    ["0.00", "too_small"],
    ["000", "too_small"],
    ["250001", "too_large"],
    ["25000.01", "too_large"],
    ["99999999999999999999", "too_large"],
    ["1".repeat(5000), "too_large"],
  ])("%j -> %s", (input, reason) => {
    expect(parseAmountToCents(input)).toEqual({ ok: false, reason });
  });

  it("treats a non-string as empty, never throws", () => {
    expect(parseAmountToCents(undefined as unknown as string)).toEqual({ ok: false, reason: "empty" });
    expect(parseAmountToCents(null as unknown as string)).toEqual({ ok: false, reason: "empty" });
    expect(parseAmountToCents(12 as unknown as string)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("parseAmountToCents — offline kind", () => {
  it("accepts one cent through $1,000,000.00", () => {
    expect(parseAmountToCents("0.01", "offline")).toEqual({ ok: true, cents: 1 });
    expect(parseAmountToCents("0.00", "offline")).toEqual({ ok: false, reason: "too_small" });
    expect(parseAmountToCents("25000.01", "offline")).toEqual({ ok: true, cents: 2_500_001 });
    expect(parseAmountToCents("1000000", "offline")).toEqual({ ok: true, cents: 100_000_000 });
    expect(parseAmountToCents("1000000.01", "offline")).toEqual({ ok: false, reason: "too_large" });
  });

  it("applies the same shape rules as online", () => {
    expect(parseAmountToCents("1e3", "offline")).toEqual({ ok: false, reason: "format" });
    expect(parseAmountToCents("-5", "offline")).toEqual({ ok: false, reason: "format" });
    expect(parseAmountToCents("10.999", "offline")).toEqual({ ok: false, reason: "format" });
  });

  it("pins the bounds to the database's own limits (0055: online 100..2500000 via presby_public_giving_config, offline 1..100000000)", () => {
    expect(AMOUNT_BOUNDS).toEqual({
      online: { min: 100, max: 2_500_000 },
      offline: { min: 1, max: 100_000_000 },
    });
    const ddl = readFileSync(path.resolve(__dirname, "../../../drizzle/0055_presby_giving.sql"), "utf8");
    expect(ddl).toContain("p_amount_cents > 100000000");
    expect(ddl).toMatch(/v_names, v_conn\.card_enabled[\s\S]{0,400}100, 2500000/);
  });
});

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [1, "$0.01"],
    [9, "$0.09"],
    [100, "$1.00"],
    [5025, "$50.25"],
    [123456, "$1,234.56"],
    [100_000_000, "$1,000,000.00"],
    [-500, "-$5.00"],
    [-5, "-$0.05"],
  ])("%d -> %s", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });

  it("refuses a non-integer, NaN or an unsafe integer", () => {
    expect(() => formatCents(1.5)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
    expect(() => formatCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe("grossUp — pinned to the values 46l asserts against presby_giving_gross_up()", () => {
  it("card $50.00 -> 5181 (covered 181)", () => {
    expect(grossUp(5000, "card")).toEqual({ totalCents: 5181, coveredCents: 181 });
  });
  it("bank $100.00 -> 10081 (covered 81)", () => {
    expect(grossUp(10000, "bank")).toEqual({ totalCents: 10081, coveredCents: 81 });
  });
  it("bank $1000.00 -> 100500: the $5 cap binds", () => {
    expect(grossUp(100000, "bank")).toEqual({ totalCents: 100500, coveredCents: 500 });
  });
  it("is always >= the gift, and covers exactly total - gift", () => {
    for (const g of [100, 101, 999, 1000, 2500, 9999, 10000, 123456, 2_500_000]) {
      for (const method of ["card", "bank"] as const) {
        const { totalCents, coveredCents } = grossUp(g, method);
        expect(totalCents).toBeGreaterThanOrEqual(g);
        expect(coveredCents).toBe(totalCents - g);
      }
    }
  });
  it("a zero-rate set charges exactly the gift", () => {
    const zero = { cardBps: 0, cardFixedCents: 0, achBps: 0, achCapCents: 0 };
    expect(grossUp(1234, "card", zero)).toEqual({ totalCents: 1234, coveredCents: 0 });
    expect(grossUp(1234, "bank", zero)).toEqual({ totalCents: 1234, coveredCents: 0 });
  });
  it("refuses a rate set with a non-positive divisor and a negative or fractional amount", () => {
    expect(() => grossUp(100, "card", { ...DEFAULT_RATES, cardBps: 10000 })).toThrow(RangeError);
    expect(() => grossUp(100, "bank", { ...DEFAULT_RATES, achBps: 10000 })).toThrow(RangeError);
    expect(() => grossUp(-1, "card")).toThrow(RangeError);
    expect(() => grossUp(1.5, "card")).toThrow(RangeError);
  });
});

describe("DEFAULT_RATES — pinned to the 0055 column defaults", () => {
  const ddl = readFileSync(path.resolve(__dirname, "../../../drizzle/0055_presby_giving.sql"), "utf8");
  it.each([
    ["card_fee_bps", "cardBps"],
    ["card_fee_fixed_cents", "cardFixedCents"],
    ["ach_fee_bps", "achBps"],
    ["ach_fee_cap_cents", "achCapCents"],
  ] as const)("%s default equals DEFAULT_RATES.%s", (column, field) => {
    const m = new RegExp(`${column} integer not null default (\\d+)`).exec(ddl);
    expect(m, column).not.toBeNull();
    expect(Number(m![1])).toBe(DEFAULT_RATES[field]);
  });
});
