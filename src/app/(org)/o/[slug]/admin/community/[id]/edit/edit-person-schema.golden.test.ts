/**
 * Characterization tests for `editPersonSchema`, written on zod 3.25.76 before
 * the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests" 1).
 * Through the real `zodResolver`; nested paths are dotted.
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { editPersonSchema } from "./edit-person-schema";

const valid = {
  identity: { firstName: "Imogen", lastName: "Thackeray" },
  contact: { emails: [] },
  address: {},
  household: { mode: "none" },
};

describe("editPersonSchema", () => {
  it("returns a valid value unchanged, with optional keys absent", async () => {
    expect(await resolveForm(editPersonSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
  });

  it("returns every optional value when given", async () => {
    const full = {
      identity: { firstName: "Imogen", lastName: "Thackeray", middleName: "R", preferredName: "Immy", suffix: "Jr" },
      contact: { emails: [], phone: "555-0100" },
      address: { line1: "1 Mill Rd", city: "Dover", region: "DE", postalCode: "19901" },
      household: { mode: "existing", householdId: "d9100000-0000-0000-0000-000000000010" },
    };
    expect(await resolveForm(editPersonSchema, full)).toEqual({ values: full, errors: {}, failed: false });
  });

  it("pins the required-name messages", async () => {
    expect(
      (await resolveForm(editPersonSchema, { ...valid, identity: { firstName: "", lastName: "" } })).errors,
    ).toEqual({
      "identity.firstName": "First name is required",
      "identity.lastName": "Last name is required",
    });
  });

  it("pins the household rules by path", async () => {
    expect(
      (await resolveForm(editPersonSchema, { ...valid, household: { mode: "new", name: "   " } })).errors,
    ).toEqual({ "household.name": "Household name is required" });
    expect((await resolveForm(editPersonSchema, { ...valid, household: { mode: "new" } })).errors).toEqual({
      "household.name": "Household name is required",
    });
    expect(
      (await resolveForm(editPersonSchema, { ...valid, household: { mode: "existing" } })).errors,
    ).toEqual({ "household.householdId": "Choose a household" });
    expect(
      (await resolveForm(editPersonSchema, { ...valid, household: { mode: "new", name: "The Thackerays" } })).failed,
    ).toBe(false);
  });

  it("reports the household rule together with a field-level failure", async () => {
    expect(
      (
        await resolveForm(editPersonSchema, {
          ...valid,
          identity: { firstName: "", lastName: "Thackeray" },
          household: { mode: "existing" },
        })
      ).errors,
    ).toEqual({
      "identity.firstName": "First name is required",
      "household.householdId": "Choose a household",
    });
  });

  it("fails (path only: enum with no message is tamper-only) on an unknown household mode", async () => {
    expect(
      Object.keys((await resolveForm(editPersonSchema, { ...valid, household: { mode: "shared" } })).errors),
    ).toEqual(["household.mode"]);
  });
});
