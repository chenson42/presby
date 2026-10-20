/**
 * Giving-settings validation - docs/work-log/2026-10-15-online-giving.md,
 * R5 / DECISION-172 and the `giving_settings` CHECKs. PURE.
 *
 * The donee identity printed on statements. Every field is optional until
 * statements are issued (Batch 5 blocks an issue on a missing name or
 * address); what is validated here is SHAPE, mirroring the migration:
 * legal name trimmed 1-200, address lines <= 120, a two-letter state, a ZIP or
 * ZIP+4, an EIN written NN-NNNNNNN, signatory fields <= 120, greeting and
 * closing <= 500.
 *
 * The greeting may contain exactly one token, `{donor_name}`; any other
 * `{...}` is refused so a typo never prints raw braces on a statement. The
 * statement renderer substitutes it by plain string replacement of a validated
 * value (no template engine), so the token is the only dynamic part.
 */
import { z } from "zod";
import { CONTROL_CHARS } from "./field-errors";

export const GREETING_TOKEN = "{donor_name}";

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .refine((v) => !CONTROL_CHARS.test(v.replace(/\n/g, " ")), `${label} has a character we can't store`)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v));

function onlyKnownTokens() {
  return (value: string | null): boolean => {
    if (value === null) return true;
    const braces = value.match(/[{}]/g);
    if (!braces) return true;
    // Every brace must belong to a {donor_name} token.
    return value.replace(/\{donor_name\}/g, "").match(/[{}]/g) === null;
  };
}

export const givingSettingsSchema = z.object({
  doneeLegalName: text("The legal name", 200),
  doneeAddressLine1: text("Address", 120),
  doneeAddressLine2: text("Address line 2", 120),
  doneeCity: text("City", 120),
  doneeRegion: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), "Use the two-letter state code, like OH"),
  doneePostalCode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v))
    .refine((v) => v === null || /^\d{5}(-\d{4})?$/.test(v), "Use a ZIP code like 43215 or 43215-1234"),
  doneeEin: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v))
    .refine((v) => v === null || /^\d{2}-\d{7}$/.test(v), "Write the EIN like 12-3456789"),
  signatoryName: text("The signatory's name", 120),
  signatoryTitle: text("The signatory's title", 120),
  greetingText: text("The greeting", 500).refine(
    onlyKnownTokens(),
    `The only placeholder you can use is ${GREETING_TOKEN}`,
  ),
  closingText: text("The closing", 500).refine(
    (v) => v === null || !/[{}]/.test(v),
    "The closing can't use placeholders",
  ),
});
export type GivingSettingsInput = z.input<typeof givingSettingsSchema>;
export type GivingSettingsValues = z.output<typeof givingSettingsSchema>;

/** The settings field names, in form order - audit metadata carries names only. */
export const GIVING_SETTINGS_FIELDS = [
  "doneeLegalName",
  "doneeAddressLine1",
  "doneeAddressLine2",
  "doneeCity",
  "doneeRegion",
  "doneePostalCode",
  "doneeEin",
  "signatoryName",
  "signatoryTitle",
  "greetingText",
  "closingText",
] as const satisfies readonly (keyof GivingSettingsValues)[];
export type GivingSettingsField = (typeof GIVING_SETTINGS_FIELDS)[number];

/** What stops a statement run, named for the settings page: name and address. */
export function statementBlockers(
  settings: Pick<GivingSettingsValues, "doneeLegalName" | "doneeAddressLine1" | "doneeCity" | "doneeRegion" | "doneePostalCode">,
): Array<"donee_name" | "donee_address"> {
  const blockers: Array<"donee_name" | "donee_address"> = [];
  if (!settings.doneeLegalName) blockers.push("donee_name");
  if (
    !settings.doneeAddressLine1 ||
    !settings.doneeCity ||
    !settings.doneeRegion ||
    !settings.doneePostalCode
  ) {
    blockers.push("donee_address");
  }
  return blockers;
}
