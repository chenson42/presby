import { z } from "zod";
import {
  CLOSING_DATE_MAX,
  CLOSING_DATE_MIN,
  EMPLOYMENT_TYPES,
  LOCATION_MAX,
  PAY_CENTS_MAX,
  PAY_UNITS,
  SLUG_MAX,
  SUMMARY_MAX,
  TITLE_MAX,
} from "@/lib/careers/contract";
import { validateDescription } from "@/lib/careers/description";
import { isValidClosingDate } from "@/lib/careers/dates";
import { GENERIC_MESSAGE } from "@/lib/careers/messages";
import { parseDollarsToCents, type PostingInput } from "@/lib/careers/input";
import { SLUG_RE } from "@/lib/careers/slug";
import { charCount } from "@/lib/careers/text";

/**
 * Client-side validation for the posting form (docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 "Component / Page Plan"). STRING-VALUED, because that is what native inputs
 * hold: the dollar amounts are text ("52,000") and `toPostingInput` turns them into the
 * cents the action takes.
 *
 * NOT THE ONLY GATE. Every rule here is re-enforced by `postingInputSchema`
 * (`@/lib/careers/input`), by `validateDescription` in the lib, and by the database's
 * CHECKs and triggers; this schema's job is to stop an obviously bad submit before a
 * round trip and to put the Copy S6 field error next to the field. Messages are Copy S6
 * verbatim; a length limit the inputs already enforce natively (`maxLength`) falls back
 * to the generic S8 line, which only a pasted-over limit could reach.
 */

export const postingFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Enter a title.")
      .refine((v) => charCount(v) <= TITLE_MAX, GENERIC_MESSAGE),
    location: z.string().refine((v) => charCount(v) <= LOCATION_MAX, GENERIC_MESSAGE),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    /** Dollars as typed ("45", "52,000", "$45.50"); empty = not given. */
    payMin: z.string(),
    payMax: z.string(),
    payUnit: z.enum(PAY_UNITS),
    summary: z.string().refine((v) => charCount(v) <= SUMMARY_MAX, GENERIC_MESSAGE),
    /** 'YYYY-MM-DD' from a native date input, or empty. */
    closingDate: z.string(),
    /** Empty = generate from the title (create) / leave alone (edit). */
    slug: z.string(),
    descriptionMd: z.string(),
  })
  .superRefine((values, ctx) => {
    const min = values.payMin.trim() === "" ? null : parseDollarsToCents(values.payMin);
    const max = values.payMax.trim() === "" ? null : parseDollarsToCents(values.payMax);
    const amountMessage = "Enter a dollar amount like 45 or 52,000.";
    if (values.payMin.trim() !== "" && (min === null || min > PAY_CENTS_MAX)) {
      ctx.addIssue({ code: "custom", path: ["payMin"], message: amountMessage });
    }
    if (values.payMax.trim() !== "" && (max === null || max > PAY_CENTS_MAX)) {
      ctx.addIssue({ code: "custom", path: ["payMax"], message: amountMessage });
    }
    if (min !== null && max !== null && min > max) {
      ctx.addIssue({
        code: "custom",
        path: ["payMax"],
        message: "The highest pay must be at least the lowest.",
      });
    }

    const closing = values.closingDate.trim();
    if (closing !== "" && !isValidClosingDate(closing)) {
      ctx.addIssue({ code: "custom", path: ["closingDate"], message: "Enter a date." });
    }

    const slug = values.slug.trim().toLowerCase();
    if (slug !== "" && !(slug.length <= SLUG_MAX && SLUG_RE.test(slug))) {
      ctx.addIssue({
        code: "custom",
        path: ["slug"],
        message: "Use letters, numbers and dashes only.",
      });
    }

    // The editor lists every problem live, with its line; the form only needs to know it is blocked.
    const description = validateDescription(values.descriptionMd, { requireNonEmpty: false });
    if (!description.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["descriptionMd"],
        message: description.errors[0]?.message ?? GENERIC_MESSAGE,
      });
    }
  });

export type PostingFormValues = z.infer<typeof postingFormSchema>;

/** The closing-date window the native date input is held to, shared with the schema above. */
export const CLOSING_DATE_INPUT_MIN = CLOSING_DATE_MIN;
export const CLOSING_DATE_INPUT_MAX = CLOSING_DATE_MAX;

/**
 * The action's input from the form's values. Pay is sent only with a unit and the unit
 * only with pay (the schema and the database both refuse the other combinations); an
 * empty slug is omitted (generated from the title on create, left alone on edit).
 */
export function toPostingInput(values: PostingFormValues): PostingInput {
  const min = values.payMin.trim() === "" ? null : parseDollarsToCents(values.payMin);
  const max = values.payMax.trim() === "" ? null : parseDollarsToCents(values.payMax);
  const hasPay = min !== null || max !== null;
  const slug = values.slug.trim().toLowerCase();
  return {
    title: values.title,
    summary: values.summary,
    location: values.location,
    employmentType: values.employmentType,
    payMinCents: min,
    payMaxCents: max,
    payUnit: hasPay ? values.payUnit : null,
    descriptionMd: values.descriptionMd,
    closingDate: values.closingDate.trim() === "" ? null : values.closingDate.trim(),
    ...(slug === "" ? {} : { slug }),
  };
}

/** Whole dollars in a form field from stored cents: 4500 -> "45", 4550 -> "45.50", null -> "". */
export function centsToField(cents: number | null): string {
  if (cents === null) return "";
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}
