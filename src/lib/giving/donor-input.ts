/**
 * Donor input validation - docs/work-log/2026-10-15-online-giving.md, Phase 3
 * data model (`giving_donors` CHECKs) and G24. PURE: shared by the donor form,
 * the offline-gift form's "new donor" block and the server actions, which
 * re-parse the same schema (the form is advisory; the server is the gate).
 *
 * The shapes mirror the migration's CHECK constraints so a value the schema
 * accepts here is a value the INSERT accepts: display name trimmed 1-120, email
 * lower-cased and trimmed (<= 254, one `@`, a dot in the domain), address lines
 * <= 120, country a two-letter code.
 */
import { z } from "zod";
import { CONTROL_CHARS } from "./field-errors";

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Lower-case + trim; the stored form. Empty -> null. */
export function normalizeDonorEmail(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const folded = value.trim().toLowerCase();
  return folded === "" ? null : folded;
}

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .refine((v) => !CONTROL_CHARS.test(v), `${label} has a character we can't store`)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v));

export const donorDisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter the donor's name")
  .max(120, "A name must be 120 characters or fewer")
  .refine((v) => !CONTROL_CHARS.test(v), "That name has a character we can't store");

const optionalEmail = z
  .string()
  .nullish()
  .transform((v) => normalizeDonorEmail(v))
  .refine(
    (v) => v === null || (v.length <= 254 && EMAIL_SHAPE.test(v)),
    "Enter an email address like name@example.org, or leave it blank",
  );

export const donorContactFields = {
  email: optionalEmail,
  addressLine1: optionalText("Address", 120),
  addressLine2: optionalText("Address line 2", 120),
  city: optionalText("City", 120),
  region: optionalText("State or region", 120),
  postalCode: optionalText("ZIP or postal code", 120),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? "US" : v))
    .refine((v) => /^[A-Z]{2}$/.test(v), "Use a two-letter country code, like US"),
};

/** A new donor (donors page and the offline-gift form's "new donor" block). */
export const createDonorSchema = z.object({
  displayName: donorDisplayNameSchema,
  ...donorContactFields,
});
export type CreateDonorInput = z.input<typeof createDonorSchema>;
export type CreateDonorValues = z.output<typeof createDonorSchema>;

/** Editing a donor's name and contact detail (giving.manage). */
export const updateDonorContactSchema = z.object({
  donorId: z.string().uuid(),
  displayName: donorDisplayNameSchema,
  ...donorContactFields,
});
export type UpdateDonorContactInput = z.input<typeof updateDonorContactSchema>;
export type UpdateDonorContactValues = z.output<typeof updateDonorContactSchema>;

/** The contact field names an edit can change, for the audit event (names only). */
export const DONOR_CONTACT_FIELDS = [
  "displayName",
  "email",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "country",
] as const;
export type DonorContactField = (typeof DONOR_CONTACT_FIELDS)[number];

/** The `q` of a donor search: trimmed, bounded, LIKE metacharacters escaped. */
export function normalizeDonorQuery(q: string): { text: string; pattern: string } {
  const text = q.trim().slice(0, 80);
  const escaped = text.replace(/[\\%_]/g, (c) => `\\${c}`);
  return { text, pattern: `%${escaped}%` };
}
