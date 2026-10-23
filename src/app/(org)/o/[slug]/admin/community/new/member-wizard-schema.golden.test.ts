/**
 * Characterization tests for `memberWizardSchema`, written on zod 3.25.76
 * before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests"
 * 1). Through the real `zodResolver`. The identity, household and relationship
 * enums carry no message, so an unknown value is tamper-only: path only.
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { memberWizardSchema, WIZARD_DEFAULT_VALUES } from "./member-wizard-schema";

const base = {
  ...WIZARD_DEFAULT_VALUES,
  search: { firstName: "Imogen", lastName: "Thackeray" },
  identity: { firstName: "Imogen", lastName: "Thackeray" },
};

const errorsOf = async (over: Record<string, unknown>) =>
  (await resolveForm(memberWizardSchema, { ...base, ...over })).errors;

describe("memberWizardSchema", () => {
  it("returns a valid visitor unchanged", async () => {
    const out = await resolveForm(memberWizardSchema, base);
    expect(out.failed).toBe(false);
    expect(out.values).toEqual(base);
  });

  it("accepts a valid participant with a real effective date", async () => {
    const input = {
      ...base,
      relationship: "participant",
      rollAction: { effectiveDate: "2026-05-01", minuteReference: "Minutes 5/1" },
    };
    const out = await resolveForm(memberWizardSchema, input);
    expect(out.failed).toBe(false);
    expect(out.values).toEqual(input);
  });

  it("accepts an existing identity with no identity names", async () => {
    const out = await resolveForm(memberWizardSchema, {
      ...base,
      identityMode: "existing",
      matchedPersonId: "d9100000-0000-0000-0000-000000000010",
      identity: {},
    });
    expect(out.failed).toBe(false);
  });

  it("pins the search-name messages", async () => {
    expect(await errorsOf({ search: { firstName: "", lastName: "" } })).toEqual({
      "search.firstName": "First name is required",
      "search.lastName": "Last name is required",
    });
  });

  it("pins the new-identity rules by path", async () => {
    expect(await errorsOf({ identity: { firstName: "  ", lastName: "" } })).toEqual({
      "identity.firstName": "First name is required",
      "identity.lastName": "Last name is required",
    });
    expect(await errorsOf({ identity: { firstName: "A", lastName: "B", dateOfBirth: "1/2/1950" } })).toEqual({
      "identity.dateOfBirth": "Enter a valid date",
    });
    expect((await resolveForm(memberWizardSchema, { ...base, identity: { firstName: "A", lastName: "B", dateOfBirth: "1950-01-02" } })).failed).toBe(false);
  });

  it("does not check the identity names for an existing person", async () => {
    expect(await errorsOf({ identityMode: "existing", identity: { dateOfBirth: "bad" } })).toEqual({});
  });

  it("pins the household rules by path", async () => {
    expect(await errorsOf({ household: { mode: "new", name: " " } })).toEqual({
      "household.name": "Household name is required",
    });
    expect(await errorsOf({ household: { mode: "existing" } })).toEqual({
      "household.householdId": "Choose a household",
    });
  });

  it("pins the visitor and roll-action date rules", async () => {
    expect(await errorsOf({ visit: { firstVisitDate: "June 1" } })).toEqual({
      "visit.firstVisitDate": "Enter a valid date",
    });
    expect(await errorsOf({ relationship: "member", rollAction: { effectiveDate: "" } })).toEqual({
      "rollAction.effectiveDate": "Effective date is required",
    });
    expect(await errorsOf({ relationship: "member", rollAction: {} })).toEqual({
      "rollAction.effectiveDate": "Effective date is required",
    });
    expect(await errorsOf({ relationship: "participant", rollAction: { effectiveDate: "5/1/26" } })).toEqual({
      "rollAction.effectiveDate": "Enter a valid date",
    });
    // A visitor's roll-action date is not checked.
    expect(await errorsOf({ relationship: "visitor", rollAction: { effectiveDate: "nonsense" } })).toEqual({});
  });

  it("pins the 200-character messages", async () => {
    expect(await errorsOf({ visit: { howHeard: "h".repeat(201) } })).toEqual({
      "visit.howHeard": "Keep this under 200 characters",
    });
    expect(
      await errorsOf({
        relationship: "member",
        rollAction: { effectiveDate: "2026-05-01", minuteReference: "m".repeat(201) },
      }),
    ).toEqual({ "rollAction.minuteReference": "Keep this under 200 characters" });
    expect((await resolveForm(memberWizardSchema, { ...base, visit: { howHeard: "h".repeat(200) } })).failed).toBe(false);
  });

  it("reports the cross-field rules together with a field-level failure", async () => {
    expect(
      await errorsOf({
        search: { firstName: "", lastName: "Thackeray" },
        household: { mode: "new", name: "" },
        visit: { howHeard: "h".repeat(201) },
        relationship: "visitor",
        identity: { firstName: "", lastName: "B" },
      }),
    ).toEqual({
      "search.firstName": "First name is required",
      "visit.howHeard": "Keep this under 200 characters",
      "identity.firstName": "First name is required",
      "household.name": "Household name is required",
    });
  });

  it("fails (path only: enum with no message is tamper-only) on unknown enum values", async () => {
    expect(Object.keys(await errorsOf({ identityMode: "maybe" }))).toEqual(["identityMode"]);
    expect(Object.keys(await errorsOf({ relationship: "friend" }))).toEqual(["relationship"]);
    expect(Object.keys(await errorsOf({ household: { mode: "shared" } }))).toEqual(["household.mode"]);
  });
});
