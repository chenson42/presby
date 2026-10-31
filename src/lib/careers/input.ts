/**
 * Posting input schemas - pure (zod only), shared by the server actions and the
 * form (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Pure helpers").
 *
 * What the schemas own: shape, bounds and normalisation of every field. What
 * they do not own: the description's markdown rules (`validateDescription`, run
 * by the lib so its normalised output is what is stored), anything that needs
 * the organization's date (a closing date in the past), and what a status change
 * requires (title, summary, location and description non-empty to publish).
 *
 * Plain-text fields go through `cleanText` (NFC, control and bidi stripped,
 * trimmed). Unknown keys are STRIPPED: an input that carries `status`,
 * `organizationId` or `version` on a create is not an error, it is ignored, and
 * nothing a client sends outside this list can reach a column.
 *
 * Messages: where Copy S6 has a field error it is used verbatim; every other
 * refusal (over a length limit, an out-of-range amount, an unknown type) says
 * the generic S8 line, because the form checks those bounds first and only a
 * request that bypassed it gets here.
 */
import { z } from "zod";
import {
  EMPLOYMENT_TYPES,
  LOCATION_MAX,
  PAY_CENTS_MAX,
  PAY_UNITS,
  SLUG_MAX,
  SUMMARY_MAX,
  TITLE_MAX,
  type EmploymentType,
  type PayUnit,
} from "./contract";
import { isValidClosingDate } from "./dates";
import { SLUG_RE } from "./slug";
import { GENERIC_MESSAGE } from "./messages";
import { charCount, cleanText } from "./text";

/** Copy S8 "generic" (one string, shared with the action messages). */
export const GENERIC_SAVE_ERROR = GENERIC_MESSAGE;

/** The raw description is only length-capped here (a request-size guard); the validator owns the rest. */
const DESCRIPTION_RAW_MAX = 100_000;

export interface PostingInput {
  title: string;
  summary: string;
  location: string;
  employmentType: EmploymentType;
  payMinCents: number | null;
  payMaxCents: number | null;
  payUnit: PayUnit | null;
  /** Raw markdown as typed; the lib validates and normalises it. */
  descriptionMd: string;
  /** YYYY-MM-DD, or null for no closing date. */
  closingDate: string | null;
  /**
   * On create: optional (generated from the title when absent, never suffixed
   * when given). On update: optional; present only to change it, and refused
   * once the posting has been first published.
   */
  slug?: string;
}

export interface PostingUpdateInput extends PostingInput {
  id: string;
  /** The version the editor loaded: the compare-and-set token. */
  version: number;
}

function bounded(max: number, min = 0, message = GENERIC_SAVE_ERROR) {
  return z
    .string()
    .transform(cleanText)
    .refine((value) => charCount(value) >= min && charCount(value) <= max, { message });
}

const cents = z
  .number()
  .int()
  .min(0)
  .max(PAY_CENTS_MAX)
  .nullish()
  .transform((value) => value ?? null);

const closingDate = z
  .string()
  .nullish()
  .transform((value) => {
    const cleaned = cleanText(value ?? "");
    return cleaned === "" ? null : cleaned;
  });

const slug = z
  .string()
  .nullish()
  .transform((value) => {
    const cleaned = cleanText(value ?? "").toLowerCase();
    return cleaned === "" ? undefined : cleaned;
  });

const fields = {
  title: bounded(TITLE_MAX, 1, "Enter a title."),
  summary: bounded(SUMMARY_MAX),
  location: bounded(LOCATION_MAX),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  payMinCents: cents,
  payMaxCents: cents,
  payUnit: z
    .enum(PAY_UNITS)
    .nullish()
    .transform((value) => value ?? null),
  descriptionMd: z.string().max(DESCRIPTION_RAW_MAX, GENERIC_SAVE_ERROR),
  closingDate,
  slug,
};

function crossFieldRules(
  value: {
    payMinCents: number | null;
    payMaxCents: number | null;
    payUnit: PayUnit | null;
    closingDate: string | null;
    slug: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const hasAmount = value.payMinCents !== null || value.payMaxCents !== null;
  if (hasAmount && value.payUnit === null) {
    ctx.addIssue({ code: "custom", path: ["payUnit"], message: "Choose per hour or per year." });
  }
  if (!hasAmount && value.payUnit !== null) {
    ctx.addIssue({ code: "custom", path: ["payUnit"], message: GENERIC_SAVE_ERROR });
  }
  if (
    value.payMinCents !== null &&
    value.payMaxCents !== null &&
    value.payMinCents > value.payMaxCents
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["payMaxCents"],
      message: "The highest pay must be at least the lowest.",
    });
  }
  if (value.closingDate !== null && !isValidClosingDate(value.closingDate)) {
    ctx.addIssue({ code: "custom", path: ["closingDate"], message: "Enter a date." });
  }
  if (value.slug !== undefined && !(value.slug.length <= SLUG_MAX && SLUG_RE.test(value.slug))) {
    ctx.addIssue({
      code: "custom",
      path: ["slug"],
      message: "Use letters, numbers and dashes only.",
    });
  }
}

export const postingInputSchema = z.object(fields).superRefine(crossFieldRules);

export const postingUpdateSchema = z
  .object({
    ...fields,
    id: z.guid(),
    version: z.number().int().min(1),
  })
  .superRefine(crossFieldRules);

/**
 * The field errors that are Copy S6 verbatim. Anything else a schema reports
 * (zod's own "Invalid input: expected object, received null", an enum's
 * "Invalid option") is an engineering message a person must never read: it can
 * only come from a request that bypassed the form, and it becomes the generic
 * S8 line.
 */
const COPY_MESSAGES: ReadonlySet<string> = new Set([
  "Enter a title.",
  "The highest pay must be at least the lowest.",
  "Choose per hour or per year.",
  "Enter a date.",
  "Use letters, numbers and dashes only.",
  GENERIC_SAVE_ERROR,
]);

/** The first problem a failed parse found, as a field name and a message fit to show. */
export function firstIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): {
  field: string;
  message: string;
} {
  const issue = error.issues[0];
  const first = issue?.path[0];
  return {
    field: first === undefined ? "input" : String(first),
    message: issue && COPY_MESSAGES.has(issue.message) ? issue.message : GENERIC_SAVE_ERROR,
  };
}

export const postingStatusSchema = z.object({
  id: z.guid(),
  version: z.number().int().min(1),
  to: z.enum(["published", "closed"]),
});

export const postingMoveSchema = z.object({
  id: z.guid(),
  direction: z.enum(["up", "down"]),
});

/**
 * "$52,000.50" -> 5200050. Accepts `^\d{1,7}(\.\d{1,2})?$` once `$`, commas and
 * spaces are removed; anything else (an exponent, three decimals, a sign, empty)
 * is null. Integer arithmetic only: no float ever holds money. The result may
 * still exceed the database ceiling (`PAY_CENTS_MAX`); the schema bounds it.
 */
export function parseDollarsToCents(raw: string): number | null {
  const stripped = raw.replace(/[$,\s]/g, "");
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(stripped);
  if (!match) return null;
  const dollars = Number(match[1]);
  const fraction = match[2] === undefined ? 0 : Number(match[2].padEnd(2, "0"));
  return dollars * 100 + fraction;
}
