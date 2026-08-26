/**
 * Tests for `officerTermSchema` — groups-and-officers Phase 3, commit 3/3.
 *
 * The single highest-value case here is the deacon/org_unit "iff" rule,
 * client-side, first of the three layers named in Phase 3's API-contract
 * table (this schema, `startOfficerTerm`'s own re-check, and the DB's
 * `officer_terms_org_unit_deacon_check` as a last-resort backstop).
 */
import { describe, expect, it } from "vitest";
import { officerTermSchema } from "./officer-term-schema";

const BASE = {
  personId: "person-1",
  office: "ruling_elder" as const,
  startsOn: "2026-01-08",
  electedOn: "",
  installedOn: "",
  classYear: "",
  minuteReference: "",
  orgUnitId: "",
};

describe("officerTermSchema — the deacon/org_unit iff rule", () => {
  it("rejects a deacon term with no district selected", () => {
    const result = officerTermSchema.safeParse({
      ...BASE,
      office: "deacon",
      orgUnitId: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "orgUnitId",
      );
      expect(issue?.message).toMatch(/needs a district/i);
    }
  });

  it("accepts a deacon term WITH a district selected", () => {
    const result = officerTermSchema.safeParse({
      ...BASE,
      office: "deacon",
      orgUnitId: "org-unit-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-deacon office WITH a district selected", () => {
    const result = officerTermSchema.safeParse({
      ...BASE,
      office: "clerk_of_session",
      orgUnitId: "org-unit-1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "orgUnitId",
      );
      expect(issue?.message).toMatch(/only deacon terms/i);
    }
  });

  it("accepts a non-deacon office with no district selected", () => {
    const result = officerTermSchema.safeParse({
      ...BASE,
      office: "ruling_elder",
      orgUnitId: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("officerTermSchema — required fields", () => {
  it("rejects an empty personId", () => {
    const result = officerTermSchema.safeParse({ ...BASE, personId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty startsOn", () => {
    const result = officerTermSchema.safeParse({ ...BASE, startsOn: "" });
    expect(result.success).toBe(false);
  });
});

describe("officerTermSchema — class year", () => {
  it("accepts an empty class year (optional)", () => {
    const result = officerTermSchema.safeParse({ ...BASE, classYear: "" });
    expect(result.success).toBe(true);
  });

  it("accepts a four-digit class year", () => {
    const result = officerTermSchema.safeParse({ ...BASE, classYear: "2028" });
    expect(result.success).toBe(true);
  });

  it("rejects a non-four-digit class year", () => {
    const result = officerTermSchema.safeParse({ ...BASE, classYear: "28" });
    expect(result.success).toBe(false);
  });
});
