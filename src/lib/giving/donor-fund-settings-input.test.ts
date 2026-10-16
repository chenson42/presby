import { describe, expect, it } from "vitest";
import {
  DONOR_CONTACT_FIELDS,
  createDonorSchema,
  normalizeDonorEmail,
  normalizeDonorQuery,
  updateDonorContactSchema,
} from "./donor-input";
import { fundSchema, updateFundSchema } from "./fund-input";
import {
  GIVING_SETTINGS_FIELDS,
  GREETING_TOKEN,
  givingSettingsSchema,
  statementBlockers,
} from "./settings-input";
import { zodFieldErrors } from "./field-errors";

function errs(schema: { safeParse: (v: unknown) => { success: boolean; error?: import("zod").ZodError } }, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected failure");
  return zodFieldErrors(result.error!);
}

describe("donor input", () => {
  it("normalises an email to the stored form", () => {
    expect(normalizeDonorEmail("  Pat@Example.INVALID ")).toBe("pat@example.invalid");
    expect(normalizeDonorEmail("")).toBeNull();
    expect(normalizeDonorEmail(null)).toBeNull();
  });

  it("accepts a name alone and applies the defaults", () => {
    const parsed = createDonorSchema.parse({ displayName: "Cordelia Wren" });
    expect(parsed).toMatchObject({ displayName: "Cordelia Wren", email: null, addressLine1: null, country: "US" });
  });

  it("requires a name and bounds it to 120", () => {
    expect(errs(createDonorSchema, { displayName: "  " }).displayName).toMatch(/Enter the donor/);
    expect(errs(createDonorSchema, { displayName: "x".repeat(121) }).displayName).toMatch(/120/);
  });

  it("refuses an unusable email, a long address and a bad country", () => {
    expect(errs(createDonorSchema, { displayName: "A", email: "nope" }).email).toMatch(/name@example/);
    expect(errs(createDonorSchema, { displayName: "A", addressLine1: "x".repeat(121) }).addressLine1).toMatch(/120/);
    expect(errs(createDonorSchema, { displayName: "A", country: "USA" }).country).toMatch(/two-letter/);
  });

  it("is idempotent over its own output (null round-trips)", () => {
    const first = createDonorSchema.parse({ displayName: "A", email: "a@example.invalid" });
    expect(createDonorSchema.safeParse(first).success).toBe(true);
  });

  it("the update schema also needs the donor id", () => {
    expect(updateDonorContactSchema.safeParse({ displayName: "A" }).success).toBe(false);
    expect(
      updateDonorContactSchema.safeParse({ donorId: "77777777-7777-4777-8777-777777777777", displayName: "A" }).success,
    ).toBe(true);
  });

  it("names the contact fields the audit event may carry (names only)", () => {
    expect(DONOR_CONTACT_FIELDS).toEqual([
      "displayName", "email", "addressLine1", "addressLine2", "city", "region", "postalCode", "country",
    ]);
  });

  it("escapes LIKE metacharacters in a search and bounds its length", () => {
    expect(normalizeDonorQuery("50%_off\\").pattern).toBe("%50\\%\\_off\\\\%");
    expect(normalizeDonorQuery("x".repeat(200)).text).toHaveLength(80);
    expect(normalizeDonorQuery("  Pat ").text).toBe("Pat");
  });
});

describe("fund input", () => {
  it("accepts a plain fund, not offered online", () => {
    expect(fundSchema.parse({ name: "General Fund", restrictionClass: "unrestricted", offeredOnline: false })).toMatchObject({
      name: "General Fund",
      onlineDisplayName: null,
      description: null,
      offeredOnline: false,
    });
  });

  it("requires the public name when offered online (the DB CHECK, in words)", () => {
    expect(errs(fundSchema, { name: "Building Fund", restrictionClass: "temporarily_restricted", offeredOnline: true }).onlineDisplayName).toMatch(
      /name donors will see/,
    );
    expect(
      fundSchema.safeParse({ name: "Building Fund", onlineDisplayName: "Building Fund", restrictionClass: "unrestricted", offeredOnline: true })
        .success,
    ).toBe(true);
  });

  it("bounds the name (1-80) and the description (500), and checks the class", () => {
    expect(errs(fundSchema, { name: "", restrictionClass: "unrestricted", offeredOnline: false }).name).toMatch(/Enter a name/);
    expect(errs(fundSchema, { name: "x".repeat(81), restrictionClass: "unrestricted", offeredOnline: false }).name).toMatch(/80/);
    expect(errs(fundSchema, { name: "A", description: "x".repeat(501), restrictionClass: "unrestricted", offeredOnline: false }).description).toMatch(/500/);
    expect(fundSchema.safeParse({ name: "A", restrictionClass: "sometimes", offeredOnline: false }).success).toBe(false);
  });

  it("the update schema needs the fund id and is idempotent over its output", () => {
    expect(updateFundSchema.safeParse({ name: "A", restrictionClass: "unrestricted", offeredOnline: false }).success).toBe(false);
    const first = updateFundSchema.parse({
      fundId: "88888888-8888-4888-8888-888888888888", name: "A", restrictionClass: "unrestricted", offeredOnline: false,
    });
    expect(updateFundSchema.safeParse(first).success).toBe(true);
  });
});

describe("settings input", () => {
  it("accepts a fully blank form (everything optional until statements run)", () => {
    const parsed = givingSettingsSchema.parse({});
    for (const field of GIVING_SETTINGS_FIELDS) expect(parsed[field]).toBeNull();
  });

  it("validates the shapes the migration's CHECKs enforce", () => {
    expect(errs(givingSettingsSchema, { doneeRegion: "Ohio" }).doneeRegion).toMatch(/two-letter/);
    expect(errs(givingSettingsSchema, { doneePostalCode: "4321" }).doneePostalCode).toMatch(/ZIP/);
    expect(errs(givingSettingsSchema, { doneeEin: "123456789" }).doneeEin).toMatch(/12-3456789/);
    expect(errs(givingSettingsSchema, { doneeLegalName: "x".repeat(201) }).doneeLegalName).toMatch(/200/);
    expect(givingSettingsSchema.parse({ doneeRegion: "oh", doneePostalCode: "43215-1234", doneeEin: "00-0000000" })).toMatchObject({
      doneeRegion: "OH", doneePostalCode: "43215-1234", doneeEin: "00-0000000",
    });
  });

  it("allows {donor_name} in the greeting and nothing else in braces", () => {
    expect(givingSettingsSchema.safeParse({ greetingText: `Dear ${GREETING_TOKEN},` }).success).toBe(true);
    expect(errs(givingSettingsSchema, { greetingText: "Dear {first_name}," }).greetingText).toMatch(/only placeholder/);
    expect(errs(givingSettingsSchema, { greetingText: "Dear {donor_name" }).greetingText).toMatch(/only placeholder/);
    expect(errs(givingSettingsSchema, { closingText: "Thanks {donor_name}" }).closingText).toMatch(/can't use placeholders/);
  });

  it("is idempotent over its own output", () => {
    const first = givingSettingsSchema.parse({ doneeLegalName: "Alder Creek Church", greetingText: "Dear {donor_name}," });
    expect(givingSettingsSchema.safeParse(first).success).toBe(true);
  });

  it("names what blocks a statement run: the name, and a complete address", () => {
    const blank = { doneeLegalName: null, doneeAddressLine1: null, doneeCity: null, doneeRegion: null, doneePostalCode: null };
    expect(statementBlockers(blank)).toEqual(["donee_name", "donee_address"]);
    expect(statementBlockers({ ...blank, doneeLegalName: "X" })).toEqual(["donee_address"]);
    expect(
      statementBlockers({ doneeLegalName: "X", doneeAddressLine1: "1 Mill Rd", doneeCity: "Dover", doneeRegion: "DE", doneePostalCode: "19901" }),
    ).toEqual([]);
    // an incomplete address still blocks
    expect(
      statementBlockers({ doneeLegalName: "X", doneeAddressLine1: "1 Mill Rd", doneeCity: "Dover", doneeRegion: null, doneePostalCode: "19901" }),
    ).toEqual(["donee_address"]);
  });
});
