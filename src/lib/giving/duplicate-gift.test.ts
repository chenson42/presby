import { describe, expect, it } from "vitest";
import { findPossibleDuplicate, normalizeCheckNumber, type GiftFingerprint } from "./duplicate-gift";

const gift = (over: Partial<GiftFingerprint> = {}): GiftFingerprint => ({
  id: "g1",
  amountCents: 5000,
  checkNumber: null,
  voided: false,
  ...over,
});

describe("normalizeCheckNumber", () => {
  it("trims, collapses whitespace and case-folds; empty is null", () => {
    expect(normalizeCheckNumber(" 1042 ")).toBe("1042");
    expect(normalizeCheckNumber("AB  12")).toBe("ab 12");
    expect(normalizeCheckNumber("")).toBeNull();
    expect(normalizeCheckNumber("   ")).toBeNull();
    expect(normalizeCheckNumber(null)).toBeNull();
    expect(normalizeCheckNumber(undefined)).toBeNull();
  });
});

describe("findPossibleDuplicate", () => {
  it("finds the same amount with no check number on either side", () => {
    expect(findPossibleDuplicate([gift()], { amountCents: 5000, checkNumber: null })?.id).toBe("g1");
  });

  it("does not match a different amount", () => {
    expect(findPossibleDuplicate([gift()], { amountCents: 5001, checkNumber: null })).toBeUndefined();
  });

  it("matches a check only on the same check number (case and spacing ignored)", () => {
    const existing = [gift({ checkNumber: "1042" })];
    expect(findPossibleDuplicate(existing, { amountCents: 5000, checkNumber: " 1042 " })?.id).toBe("g1");
    expect(findPossibleDuplicate(existing, { amountCents: 5000, checkNumber: "1043" })).toBeUndefined();
  });

  it("treats a check number against none as different gifts", () => {
    expect(findPossibleDuplicate([gift({ checkNumber: "1042" })], { amountCents: 5000, checkNumber: null })).toBeUndefined();
    expect(findPossibleDuplicate([gift()], { amountCents: 5000, checkNumber: "1042" })).toBeUndefined();
  });

  it("ignores a voided gift", () => {
    expect(findPossibleDuplicate([gift({ voided: true })], { amountCents: 5000, checkNumber: null })).toBeUndefined();
  });

  it("returns the first live match among several", () => {
    const found = findPossibleDuplicate(
      [gift({ id: "a", voided: true }), gift({ id: "b" }), gift({ id: "c" })],
      { amountCents: 5000, checkNumber: null },
    );
    expect(found?.id).toBe("b");
  });

  it("is undefined for no candidates", () => {
    expect(findPossibleDuplicate([], { amountCents: 5000, checkNumber: null })).toBeUndefined();
  });
});
