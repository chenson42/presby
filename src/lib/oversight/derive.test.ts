/**
 * U2: the pure derivations (docs/work-log/2026-11-17-congregation-profile.md,
 * Phase 3 "Test plan"). `today` is an injected string, so no fake timers.
 */
import { describe, expect, it } from "vitest";
import {
  additionsLabel,
  buildingSummary,
  buildingsInUseLabel,
  centsToInputText,
  expiryState,
  formatBuildingType,
  formatCondition,
  formatInteger,
  formatMoney,
  formatTriState,
  insuranceExpiryCell,
  latestAppraisal,
  loanTotals,
  newestInsuranceExpiry,
} from "./derive";

describe("expiryState", () => {
  it("today is not expired; yesterday is; tomorrow is current; no date is none", () => {
    expect(expiryState("2026-06-15", "2026-06-15")).toBe("current");
    expect(expiryState("2026-06-14", "2026-06-15")).toBe("expired");
    expect(expiryState("2026-06-16", "2026-06-15")).toBe("current");
    expect(expiryState(null, "2026-06-15")).toBe("none");
  });
  it("compares across a year boundary as text, never as a Date", () => {
    expect(expiryState("2025-12-31", "2026-01-01")).toBe("expired");
    expect(expiryState("2026-01-01", "2025-12-31")).toBe("current");
  });
  it("the list cell carries the date and the state, or none", () => {
    expect(insuranceExpiryCell("2026-06-14", "2026-06-15")).toEqual({ kind: "expired", date: "2026-06-14" });
    expect(insuranceExpiryCell("2026-06-15", "2026-06-15")).toEqual({ kind: "current", date: "2026-06-15" });
    expect(insuranceExpiryCell(null, "2026-06-15")).toEqual({ kind: "none" });
  });
});

describe("newestInsuranceExpiry (T8)", () => {
  it("is the highest policy year's expiry, not the soonest of all years", () => {
    expect(
      newestInsuranceExpiry([
        { policyYear: 2024, policyExpiresOn: "2024-03-01" },
        { policyYear: 2026, policyExpiresOn: "2026-03-01" },
        { policyYear: 2025, policyExpiresOn: "2025-03-01" },
      ]),
    ).toBe("2026-03-01");
  });
  it("is null when the newest year has no expiry, even if an older year does", () => {
    expect(
      newestInsuranceExpiry([
        { policyYear: 2025, policyExpiresOn: "2025-03-01" },
        { policyYear: 2026, policyExpiresOn: null },
      ]),
    ).toBeNull();
  });
  it("is null for no rows", () => {
    expect(newestInsuranceExpiry([])).toBeNull();
  });
});

describe("latestAppraisal", () => {
  it("the newest assessed year wins, in any order", () => {
    const rows = [
      { id: "a", assessedYear: 2020 },
      { id: "c", assessedYear: 2024 },
      { id: "b", assessedYear: 2022 },
    ];
    expect(latestAppraisal(rows)?.id).toBe("c");
    expect(latestAppraisal([...rows].reverse())?.id).toBe("c");
    expect(latestAppraisal([])).toBeNull();
  });
});

describe("loanTotals", () => {
  const loan = (b: number | null, o: number | null, g: number | null) => ({ currentBalanceCents: b, originalAmountCents: o, grantsAmountCents: g });

  it("sums only what is recorded and counts what is not", () => {
    expect(loanTotals([loan(100, 1000, null), loan(250, null, 50), loan(null, null, null)])).toEqual({
      balanceCents: 350,
      originalCents: 1000,
      grantsCents: 50,
      balanceUnrecorded: 1,
      originalUnrecorded: 2,
      grantsUnrecorded: 2,
    });
  });
  it("is never a false zero: nothing recorded is null, a recorded $0 is 0", () => {
    expect(loanTotals([loan(null, null, null)])).toMatchObject({ balanceCents: null, originalCents: null, grantsCents: null, balanceUnrecorded: 1 });
    expect(loanTotals([loan(0, 0, 0)])).toMatchObject({ balanceCents: 0, originalCents: 0, grantsCents: 0, balanceUnrecorded: 0 });
    expect(loanTotals([])).toMatchObject({ balanceCents: null, balanceUnrecorded: 0 });
  });
});

describe("formatMoney / formatInteger / centsToInputText", () => {
  it("no cents when whole, two digits when not, thousands separators, $0 for zero", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(100)).toBe("$1");
    expect(formatMoney(125_000_000)).toBe("$1,250,000");
    expect(formatMoney(125_000_050)).toBe("$1,250,000.50");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(100_000_000_000)).toBe("$1,000,000,000");
    expect(formatMoney(99)).toBe("$0.99");
  });
  it("formatInteger", () => {
    expect(formatInteger(0)).toBe("0");
    expect(formatInteger(999)).toBe("999");
    expect(formatInteger(1000)).toBe("1,000");
    expect(formatInteger(5_000_000)).toBe("5,000,000");
  });
  it("centsToInputText is what a money field shows: no symbol, no commas", () => {
    expect(centsToInputText(null)).toBe("");
    expect(centsToInputText(0)).toBe("0");
    expect(centsToInputText(125_000_000)).toBe("1250000");
    expect(centsToInputText(125_000_050)).toBe("1250000.50");
    expect(centsToInputText(5)).toBe("0.05");
  });
});

describe("labels", () => {
  it("tri-state and condition: never a false value for not recorded", () => {
    expect(formatTriState(true)).toBe("Yes");
    expect(formatTriState(false)).toBe("No");
    expect(formatTriState(null)).toBe("Not recorded");
    expect(formatCondition("good")).toBe("Good");
    expect(formatCondition("fair")).toBe("Fair");
    expect(formatCondition("poor")).toBe("Poor");
    expect(formatCondition(null)).toBe("Not recorded");
  });
  it("building types", () => {
    expect(formatBuildingType("education_building")).toBe("Education building");
    expect(formatBuildingType("vacant_land")).toBe("Vacant land");
  });
  it("the buildings-in-use cell has three states: a count, None in use (all retired), or Not recorded; never 0", () => {
    expect(buildingsInUseLabel(0, 0)).toBe("Not recorded");
    expect(buildingsInUseLabel(0, 2)).toBe("None in use");
    expect(buildingsInUseLabel(1, 0)).toBe("1 building");
    expect(buildingsInUseLabel(2, 3)).toBe("2 buildings");
  });
  it("the card's optional lines appear only when recorded", () => {
    expect(buildingSummary({ yearBuilt: null, squareFeet: null })).toEqual([]);
    expect(buildingSummary({ yearBuilt: 1962, squareFeet: null })).toEqual(["Built 1962"]);
    expect(buildingSummary({ yearBuilt: 1962, squareFeet: 12500 })).toEqual(["Built 1962", "12,500 square feet"]);
  });
  it("additions", () => {
    expect(additionsLabel(null, null)).toBe("Not recorded");
    expect(additionsLabel(1975, null)).toBe("First addition 1975");
    expect(additionsLabel(1975, 1990)).toBe("First addition 1975; second addition 1990");
    expect(additionsLabel(null, 1990)).toBe("Second addition 1990");
  });
});
