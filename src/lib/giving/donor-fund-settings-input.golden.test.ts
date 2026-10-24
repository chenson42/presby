/**
 * Characterization tests for the donor, fund and giving-settings schemas,
 * written on zod 3.25.76 before the zod 4 upgrade
 * (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests" 1 and 2). Parsed output
 * is checked with every optional key ABSENT, not just null. Tamper-only paths
 * (id with no message, enum with no message, missing-key type messages) assert
 * failure and path only.
 */
import { describe, expect, it } from "vitest";
import { createDonorSchema, updateDonorContactSchema } from "./donor-input";
import { fundSchema, updateFundSchema } from "./fund-input";
import { givingSettingsSchema } from "./settings-input";
import { zodFieldErrors } from "./field-errors";

const NON_RFC_ROLE_ID = "00000000-0000-0000-0000-000000000005";
const NON_RFC_FIXTURE_ID = "d9100000-0000-0000-0000-000000000010";

type Parsable = { safeParse: (v: unknown) => { success: true; data: unknown } | { success: false; error: import("zod").ZodError } };

function errs(schema: Parsable, input: unknown): Record<string, string> {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected a failure");
  return zodFieldErrors(result.error);
}

describe("createDonorSchema", () => {
  it("applies every default when optional keys are absent", () => {
    expect(createDonorSchema.parse({ displayName: "  Cordelia Wren " })).toEqual({
      displayName: "Cordelia Wren",
      email: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
      country: "US",
    });
  });

  it("normalizes null and empty optionals, lower-cases the email and upper-cases the country", () => {
    expect(
      createDonorSchema.parse({
        displayName: "A",
        email: "  Pat@Example.INVALID ",
        addressLine1: "  1 Mill Rd ",
        addressLine2: "",
        city: null,
        region: "  ",
        postalCode: " 19901 ",
        country: " ca ",
      }),
    ).toEqual({
      displayName: "A",
      email: "pat@example.invalid",
      addressLine1: "1 Mill Rd",
      addressLine2: null,
      city: null,
      region: null,
      postalCode: "19901",
      country: "CA",
    });
    expect(createDonorSchema.parse({ displayName: "A", email: null, country: null }).country).toBe("US");
    expect(createDonorSchema.parse({ displayName: "A", email: "", country: "" })).toMatchObject({
      email: null,
      country: "US",
    });
  });

  it("is idempotent over its own output", () => {
    const first = createDonorSchema.parse({ displayName: "A", email: "a@example.invalid" });
    expect(createDonorSchema.parse(first)).toEqual(first);
  });

  it("pins every user-reachable message", () => {
    expect(errs(createDonorSchema, { displayName: "  " })).toEqual({ displayName: "Enter the donor's name" });
    expect(errs(createDonorSchema, { displayName: "x".repeat(121) })).toEqual({
      displayName: "A name must be 120 characters or fewer",
    });
    expect(errs(createDonorSchema, { displayName: "bad\u0007name" })).toEqual({
      displayName: "That name has a character we can't store",
    });
    expect(errs(createDonorSchema, { displayName: "A", email: "nope" })).toEqual({
      email: "Enter an email address like name@example.org, or leave it blank",
    });
    expect(errs(createDonorSchema, { displayName: "A", email: `${"x".repeat(250)}@example.invalid` })).toEqual({
      email: "Enter an email address like name@example.org, or leave it blank",
    });
    expect(errs(createDonorSchema, { displayName: "A", addressLine1: "x".repeat(121) })).toEqual({
      addressLine1: "Address must be 120 characters or fewer",
    });
    expect(errs(createDonorSchema, { displayName: "A", addressLine2: "x".repeat(121) })).toEqual({
      addressLine2: "Address line 2 must be 120 characters or fewer",
    });
    expect(errs(createDonorSchema, { displayName: "A", city: "x".repeat(121) })).toEqual({
      city: "City must be 120 characters or fewer",
    });
    expect(errs(createDonorSchema, { displayName: "A", region: "x".repeat(121) })).toEqual({
      region: "State or region must be 120 characters or fewer",
    });
    expect(errs(createDonorSchema, { displayName: "A", postalCode: "x".repeat(121) })).toEqual({
      postalCode: "ZIP or postal code must be 120 characters or fewer",
    });
    expect(errs(createDonorSchema, { displayName: "A", city: "bad\u0007city" })).toEqual({
      city: "City has a character we can't store",
    });
    expect(errs(createDonorSchema, { displayName: "A", country: "USA" })).toEqual({
      country: "Use a two-letter country code, like US",
    });
  });

  it("fails (path only, missing-key wording is tamper-only) without a display name", () => {
    expect(Object.keys(errs(createDonorSchema, {}))).toEqual(["displayName"]);
  });
});

describe("updateDonorContactSchema", () => {
  it.each([NON_RFC_ROLE_ID, NON_RFC_FIXTURE_ID])("accepts the non-RFC donor id %s", (donorId) => {
    expect(updateDonorContactSchema.safeParse({ donorId, displayName: "A" }).success).toBe(true);
  });

  it("rejects a malformed or missing donor id (path only: tamper-only wording)", () => {
    expect(Object.keys(errs(updateDonorContactSchema, { donorId: "not-a-uuid", displayName: "A" }))).toEqual([
      "donorId",
    ]);
    expect(Object.keys(errs(updateDonorContactSchema, { displayName: "A" }))).toEqual(["donorId"]);
  });

  it("returns the id and the defaulted contact fields", () => {
    expect(updateDonorContactSchema.parse({ donorId: NON_RFC_FIXTURE_ID, displayName: "A" })).toEqual({
      donorId: NON_RFC_FIXTURE_ID,
      displayName: "A",
      email: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
      country: "US",
    });
  });

  it("reports a failing id and a failing name together, each at its own path", () => {
    const errors = errs(updateDonorContactSchema, { donorId: "not-a-uuid", displayName: "" });
    expect(Object.keys(errors).sort()).toEqual(["displayName", "donorId"]);
    expect(errors.displayName).toBe("Enter the donor's name");
  });
});

const FUND = { name: "General Fund", restrictionClass: "unrestricted", offeredOnline: false };

describe("fundSchema", () => {
  it("applies the null defaults when optional keys are absent", () => {
    expect(fundSchema.parse(FUND)).toEqual({
      name: "General Fund",
      onlineDisplayName: null,
      description: null,
      restrictionClass: "unrestricted",
      offeredOnline: false,
    });
  });

  it("trims and keeps the optional text", () => {
    expect(
      fundSchema.parse({
        ...FUND,
        name: "  Building Fund ",
        onlineDisplayName: " Building ",
        description: " roof ",
        offeredOnline: true,
        restrictionClass: "temporarily_restricted",
      }),
    ).toEqual({
      name: "Building Fund",
      onlineDisplayName: "Building",
      description: "roof",
      restrictionClass: "temporarily_restricted",
      offeredOnline: true,
    });
  });

  it("pins every user-reachable message", () => {
    expect(errs(fundSchema, { ...FUND, name: "" })).toEqual({ name: "Enter a name for the fund" });
    expect(errs(fundSchema, { ...FUND, name: "x".repeat(81) })).toEqual({
      name: "That is longer than 80 characters",
    });
    expect(errs(fundSchema, { ...FUND, name: "bad\u0007name" })).toEqual({
      name: "That has a character we can't store",
    });
    expect(errs(fundSchema, { ...FUND, onlineDisplayName: "x".repeat(81) })).toEqual({
      onlineDisplayName: "That is longer than 80 characters",
    });
    expect(errs(fundSchema, { ...FUND, description: "x".repeat(501) })).toEqual({
      description: "A description must be 500 characters or fewer",
    });
    expect(errs(fundSchema, { ...FUND, offeredOnline: true })).toEqual({
      onlineDisplayName: "Enter the name donors will see to offer this fund online",
    });
  });

  it("reports the offered-online rule together with a field-level failure", () => {
    expect(errs(fundSchema, { ...FUND, name: "", offeredOnline: true })).toEqual({
      name: "Enter a name for the fund",
      onlineDisplayName: "Enter the name donors will see to offer this fund online",
    });
  });

  it("fails (path only: tamper-only wording) on an unknown restriction class and a missing flag", () => {
    expect(Object.keys(errs(fundSchema, { ...FUND, restrictionClass: "sometimes" }))).toEqual(["restrictionClass"]);
    const { offeredOnline: _omitted, ...rest } = FUND;
    expect(Object.keys(errs(fundSchema, rest))).toEqual(["offeredOnline"]);
  });
});

describe("updateFundSchema (the .and() intersection)", () => {
  it.each([NON_RFC_ROLE_ID, NON_RFC_FIXTURE_ID])("accepts the non-RFC fund id %s", (fundId) => {
    expect(updateFundSchema.safeParse({ fundId, ...FUND }).success).toBe(true);
  });

  it("returns the merged object", () => {
    expect(updateFundSchema.parse({ fundId: NON_RFC_FIXTURE_ID, ...FUND })).toEqual({
      fundId: NON_RFC_FIXTURE_ID,
      name: "General Fund",
      onlineDisplayName: null,
      description: null,
      restrictionClass: "unrestricted",
      offeredOnline: false,
    });
  });

  it("is idempotent over its own output", () => {
    const first = updateFundSchema.parse({ fundId: NON_RFC_FIXTURE_ID, ...FUND });
    expect(updateFundSchema.parse(first)).toEqual(first);
  });

  it("reports a failing fund id and a failing name together, with their paths", () => {
    const result = updateFundSchema.safeParse({ fundId: "not-a-uuid", ...FUND, name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = zodFieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(["fundId", "name"]);
      expect(errors.name).toBe("Enter a name for the fund");
    }
  });

  it("rejects a missing fund id (path only)", () => {
    expect(Object.keys(errs(updateFundSchema, FUND))).toEqual(["fundId"]);
  });
});

describe("givingSettingsSchema", () => {
  it("returns every field null for an empty form", () => {
    expect(givingSettingsSchema.parse({})).toEqual({
      doneeLegalName: null,
      doneeAddressLine1: null,
      doneeAddressLine2: null,
      doneeCity: null,
      doneeRegion: null,
      doneePostalCode: null,
      doneeEin: null,
      signatoryName: null,
      signatoryTitle: null,
      greetingText: null,
      closingText: null,
    });
  });

  it("normalizes a filled form", () => {
    expect(
      givingSettingsSchema.parse({
        doneeLegalName: " Alder Creek Church ",
        doneeRegion: " oh ",
        doneePostalCode: " 43215-1234 ",
        doneeEin: " 00-0000000 ",
        greetingText: "Dear {donor_name},",
        closingText: "",
      }),
    ).toMatchObject({
      doneeLegalName: "Alder Creek Church",
      doneeRegion: "OH",
      doneePostalCode: "43215-1234",
      doneeEin: "00-0000000",
      greetingText: "Dear {donor_name},",
      closingText: null,
    });
  });

  it("pins every message", () => {
    expect(errs(givingSettingsSchema, { doneeLegalName: "x".repeat(201) })).toEqual({
      doneeLegalName: "The legal name must be 200 characters or fewer",
    });
    expect(errs(givingSettingsSchema, { doneeAddressLine1: "x".repeat(121) })).toEqual({
      doneeAddressLine1: "Address must be 120 characters or fewer",
    });
    expect(errs(givingSettingsSchema, { doneeCity: "bad\u0007city" })).toEqual({
      doneeCity: "City has a character we can't store",
    });
    expect(errs(givingSettingsSchema, { doneeRegion: "Ohio" })).toEqual({
      doneeRegion: "Use the two-letter state code, like OH",
    });
    expect(errs(givingSettingsSchema, { doneePostalCode: "4321" })).toEqual({
      doneePostalCode: "Use a ZIP code like 43215 or 43215-1234",
    });
    expect(errs(givingSettingsSchema, { doneeEin: "123456789" })).toEqual({
      doneeEin: "Write the EIN like 12-3456789",
    });
    expect(errs(givingSettingsSchema, { signatoryName: "x".repeat(121) })).toEqual({
      signatoryName: "The signatory's name must be 120 characters or fewer",
    });
    expect(errs(givingSettingsSchema, { signatoryTitle: "x".repeat(121) })).toEqual({
      signatoryTitle: "The signatory's title must be 120 characters or fewer",
    });
    expect(errs(givingSettingsSchema, { greetingText: "x".repeat(501) })).toEqual({
      greetingText: "The greeting must be 500 characters or fewer",
    });
    expect(errs(givingSettingsSchema, { greetingText: "Dear {first_name}," })).toEqual({
      greetingText: "The only placeholder you can use is {donor_name}",
    });
    expect(errs(givingSettingsSchema, { greetingText: "Dear {donor_name" })).toEqual({
      greetingText: "The only placeholder you can use is {donor_name}",
    });
    expect(errs(givingSettingsSchema, { closingText: "Thanks {donor_name}" })).toEqual({
      closingText: "The closing can't use placeholders",
    });
  });

  it("is idempotent over its own output", () => {
    const first = givingSettingsSchema.parse({ doneeLegalName: "Alder Creek Church", greetingText: "Dear {donor_name}," });
    expect(givingSettingsSchema.parse(first)).toEqual(first);
  });
});
