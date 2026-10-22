import { describe, expect, it } from "vitest";
import { memberWizardSchema, WIZARD_DEFAULT_VALUES } from "./member-wizard-schema";

const VALID_NEW_IDENTITY = {
  ...WIZARD_DEFAULT_VALUES,
  search: { firstName: "Nora", lastName: "Ashgrove", dateOfBirth: "", email: "", phone: "" },
  identityMode: "new" as const,
  identity: {
    firstName: "Nora",
    lastName: "Ashgrove",
    middleName: "",
    preferredName: "",
    suffix: "",
    dateOfBirth: "",
  },
  household: { mode: "none" as const, name: "", householdId: "" },
  rollAction: {
    kind: "profession_of_faith" as const,
    effectiveDate: "2026-06-01",
    minuteReference: "",
  },
};

describe("memberWizardSchema — cross-field rules", () => {
  it("accepts a valid 'new' identity + 'none' household + a valid effective date", () => {
    const result = memberWizardSchema.safeParse(VALID_NEW_IDENTITY);
    expect(result.success).toBe(true);
  });

  it("rejects 'new' identity mode with a blank first/last name", () => {
    const result = memberWizardSchema.safeParse({
      ...VALID_NEW_IDENTITY,
      identity: { ...VALID_NEW_IDENTITY.identity, firstName: "", lastName: "" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("identity.firstName");
      expect(paths).toContain("identity.lastName");
    }
  });

  it("does NOT require identity.firstName/lastName when identityMode is 'existing'", () => {
    const result = memberWizardSchema.safeParse({
      ...VALID_NEW_IDENTITY,
      identityMode: "existing",
      matchedPersonId: "p-1",
      matchedDisplayName: "N. Ashgrove",
      identity: { firstName: "", lastName: "", middleName: "", preferredName: "", suffix: "", dateOfBirth: "" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects household.mode 'new' with a blank household name", () => {
    const result = memberWizardSchema.safeParse({
      ...VALID_NEW_IDENTITY,
      household: { mode: "new" as const, name: "", householdId: "" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("household.name");
    }
  });

  it("rejects household.mode 'existing' with no householdId chosen", () => {
    const result = memberWizardSchema.safeParse({
      ...VALID_NEW_IDENTITY,
      household: { mode: "existing" as const, name: "", householdId: "" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("household.householdId");
    }
  });

  it("rejects a malformed rollAction.effectiveDate", () => {
    const result = memberWizardSchema.safeParse({
      ...VALID_NEW_IDENTITY,
      rollAction: { ...VALID_NEW_IDENTITY.rollAction, effectiveDate: "06/01/2026" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("rollAction.effectiveDate");
    }
  });

  it("rejects a blank rollAction.effectiveDate", () => {
    const result = memberWizardSchema.safeParse({
      ...VALID_NEW_IDENTITY,
      rollAction: { ...VALID_NEW_IDENTITY.rollAction, effectiveDate: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed identity.dateOfBirth in 'new' mode", () => {
    const result = memberWizardSchema.safeParse({
      ...VALID_NEW_IDENTITY,
      identity: { ...VALID_NEW_IDENTITY.identity, dateOfBirth: "not-a-date" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects search.firstName/lastName left blank", () => {
    const result = memberWizardSchema.safeParse({
      ...VALID_NEW_IDENTITY,
      search: { ...VALID_NEW_IDENTITY.search, firstName: "", lastName: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a rollAction.kind outside WIZARD_ROLL_ACTION_KINDS, e.g. 'death' — regression for wizard-select-full-kind-map (docs/work-log/2026-08-26-member-roll-on-edit.md)", () => {
    const result = memberWizardSchema.safeParse({
      ...VALID_NEW_IDENTITY,
      rollAction: { ...VALID_NEW_IDENTITY.rollAction, kind: "death" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("rollAction.kind");
    }
  });
});
