/**
 * Characterization tests for the per-capita and statistics form schemas,
 * written on zod 3.25.76 before the zod 4 upgrade
 * (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests" 1).
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { perCapitaRateSchema, recordPaymentSchema } from "./per-capita-schema";
import { NUMERIC_STAT_FIELDS, statisticsSchema } from "./statistics-schema";

describe("perCapitaRateSchema", () => {
  const valid = { billingYear: "2026", basisYear: "2025", ratePerMember: "10.5" };

  it("returns a valid value unchanged, with an empty basis year", async () => {
    expect(await resolveForm(perCapitaRateSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
    expect((await resolveForm(perCapitaRateSchema, { ...valid, basisYear: "" })).failed).toBe(false);
    expect((await resolveForm(perCapitaRateSchema, { ...valid, ratePerMember: "0" })).failed).toBe(false);
  });

  it("pins the messages", async () => {
    for (const billingYear of ["", "26", "20266", "year"]) {
      expect((await resolveForm(perCapitaRateSchema, { ...valid, billingYear })).errors).toEqual({
        billingYear: "Enter a 4-digit year",
      });
    }
    expect((await resolveForm(perCapitaRateSchema, { ...valid, basisYear: "25" })).errors).toEqual({
      basisYear: "Enter a 4-digit year",
    });
    for (const ratePerMember of ["", "-1", "abc"]) {
      expect((await resolveForm(perCapitaRateSchema, { ...valid, ratePerMember })).errors).toEqual({
        ratePerMember: "Enter a non-negative rate",
      });
    }
  });
});

describe("recordPaymentSchema", () => {
  const valid = { recordId: "d9100000-0000-0000-0000-000000000010", paidAmount: "125.00", paidAt: "2026-03-01" };

  it("returns a valid value unchanged", async () => {
    expect(await resolveForm(recordPaymentSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
  });

  it("pins the messages", async () => {
    expect((await resolveForm(recordPaymentSchema, { recordId: "", paidAmount: "", paidAt: "" })).errors).toEqual({
      recordId: "Choose a congregation",
      paidAmount: "Enter a non-negative amount",
      paidAt: "Payment date is required",
    });
    expect((await resolveForm(recordPaymentSchema, { ...valid, paidAmount: "-5" })).errors).toEqual({
      paidAmount: "Enter a non-negative amount",
    });
  });
});

describe("statisticsSchema", () => {
  const counts = Object.fromEntries(NUMERIC_STAT_FIELDS.map((key) => [key, ""]));
  const valid = {
    aboutOrgId: "d9100000-0000-0000-0000-000000000010",
    year: "2026",
    minuteReference: "",
    ...counts,
  };

  it("returns a valid value unchanged, for blank and numeric counts", async () => {
    expect(await resolveForm(statisticsSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
    const filled = { ...valid, endingActive: "120", officersDeaconCount: "0" };
    expect(await resolveForm(statisticsSchema, filled)).toEqual({ values: filled, errors: {}, failed: false });
  });

  it("pins the congregation, year and minute-reference messages", async () => {
    expect((await resolveForm(statisticsSchema, { ...valid, aboutOrgId: "" })).errors).toEqual({
      aboutOrgId: "Choose a congregation",
    });
    for (const year of ["", "26", "20266"]) {
      expect((await resolveForm(statisticsSchema, { ...valid, year })).errors).toEqual({ year: "Enter a 4-digit year" });
    }
    expect((await resolveForm(statisticsSchema, { ...valid, minuteReference: "m".repeat(501) })).errors).toEqual({
      minuteReference: "Must be 500 characters or fewer",
    });
  });

  it("pins the whole-number message on every count field", async () => {
    for (const key of NUMERIC_STAT_FIELDS) {
      for (const bad of ["-1", "1.5", "abc"]) {
        expect((await resolveForm(statisticsSchema, { ...valid, [key]: bad })).errors).toEqual({
          [key]: "Must be a non-negative whole number",
        });
      }
    }
  });

  it("reports several failures together", async () => {
    expect((await resolveForm(statisticsSchema, { ...valid, year: "x", endingActive: "-3", lossesDeaths: "1.5" })).errors).toEqual({
      year: "Enter a 4-digit year",
      endingActive: "Must be a non-negative whole number",
      lossesDeaths: "Must be a non-negative whole number",
    });
  });
});
