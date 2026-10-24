/**
 * Characterization tests for `officerTermSchema`, written on zod 3.25.76
 * before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests"
 * 1). `office` is an enum with no message: tamper-only, path only.
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { OFFICER_OFFICES } from "./office-labels";
import { officerTermSchema } from "./officer-term-schema";

const valid = {
  personId: "00000000-0000-0000-0000-000000000005",
  office: "ruling_elder",
  startsOn: "2026-01-04",
  electedOn: "",
  installedOn: "",
  classYear: "",
  minuteReference: "",
  orgUnitId: "",
};

describe("officerTermSchema", () => {
  it("returns valid values unchanged, with every office", async () => {
    expect(await resolveForm(officerTermSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
    expect(OFFICER_OFFICES).toContain("ruling_elder");
    expect(OFFICER_OFFICES).toContain("deacon");
    const deacon = { ...valid, office: "deacon", orgUnitId: "d9100000-0000-0000-0000-000000000010" };
    expect(await resolveForm(officerTermSchema, deacon)).toEqual({ values: deacon, errors: {}, failed: false });
  });

  it("accepts the optional fields absent", async () => {
    const required = { personId: valid.personId, office: "ruling_elder", startsOn: valid.startsOn };
    expect(await resolveForm(officerTermSchema, required)).toEqual({ values: required, errors: {}, failed: false });
  });

  it("pins the field messages", async () => {
    expect((await resolveForm(officerTermSchema, { ...valid, personId: "", startsOn: "" })).errors).toEqual({
      personId: "Choose a person",
      startsOn: "Start date is required",
    });
  });

  it("pins the cross-field messages by path", async () => {
    expect((await resolveForm(officerTermSchema, { ...valid, office: "deacon" })).errors).toEqual({
      orgUnitId: "A deacon term needs a district selected.",
    });
    expect(
      (await resolveForm(officerTermSchema, { ...valid, office: "ruling_elder", orgUnitId: "d9100000-0000-0000-0000-000000000010" })).errors,
    ).toEqual({ orgUnitId: "Only deacon terms take a district." });
    for (const classYear of ["26", "20266", "abcd"]) {
      expect((await resolveForm(officerTermSchema, { ...valid, classYear })).errors).toEqual({
        classYear: "Class year must be a four-digit year.",
      });
    }
    expect((await resolveForm(officerTermSchema, { ...valid, classYear: "2026" })).failed).toBe(false);
  });

  it("reports the cross-field rules together with a field-level failure", async () => {
    expect(
      (await resolveForm(officerTermSchema, { ...valid, personId: "", office: "deacon", classYear: "x" })).errors,
    ).toEqual({
      personId: "Choose a person",
      orgUnitId: "A deacon term needs a district selected.",
      classYear: "Class year must be a four-digit year.",
    });
  });

  it("fails (path only: enum with no message is tamper-only) on an unknown office", async () => {
    expect(Object.keys((await resolveForm(officerTermSchema, { ...valid, office: "bishop" })).errors)).toEqual(["office"]);
  });
});
