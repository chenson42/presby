import { z } from "zod";
import { MAX_SERIES_TOTAL } from "@/lib/events/recurrence";

/**
 * Client-side validation for the events admin surface (docs/work-log/
 * 2026-08-26-events-model.md, Phase 3 design). One file, mirroring
 * `group-schema.ts`'s single-file shape for the same reason: three small
 * forms, none individually large enough to earn its own file.
 *
 * NONE OF THESE SCHEMAS ARE THE ONLY GATE. Every check duplicated here
 * (length limits, end-before-start, the 52-occurrence series-total cap) is
 * re-enforced server-side in `src/lib/events.ts` (Phase 1's Adversarial
 * Pass — this exact class of gap shipped client-only once before) — this
 * file's job is only to block an obviously-bad submit before a round trip.
 *
 * "repeats" IS A FORM-ONLY FIELD — it never reaches `CreateEventInput`
 * directly; `new-event-form.tsx` translates `{ repeats, patternType,
 * simplePattern, ordinal, dayOfWeek, count }` into
 * `CreateEventInput["recurrence"]` (present or `undefined`) before calling
 * `createEventAction`.
 */

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const LOCATION_MAX = 200;

const baseFields = {
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`),
  description: z.string().max(DESCRIPTION_MAX, "Description is too long").optional(),
  location: z.string().max(LOCATION_MAX, "That's too long").optional(),
  /** 'YYYY-MM-DDTHH:mm', a native <input type="datetime-local">'s own shape. */
  startsAt: z.string().min(1, "Start date and time are required"),
  endsAt: z.string().optional(),
  isPublic: z.boolean(),
  allowsCheckin: z.boolean(),
};

function refineTimes(
  values: { startsAt: string; endsAt?: string },
  ctx: z.RefinementCtx,
) {
  if (values.endsAt && values.endsAt < values.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "End time can't be before the start time.",
    });
  }
}

export const createEventSchema = z
  .object({
    ...baseFields,
    repeats: z.boolean(),
    patternType: z.enum(["simple", "dayofweek"]),
    simplePattern: z.enum(["weekly", "biweekly", "monthly"]).optional(),
    ordinal: z.enum(["1st", "2nd", "3rd", "4th", "last"]).optional(),
    dayOfWeek: z
      .enum(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
      .optional(),
    /** A string, not a number — a native text input's own value shape. */
    count: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    refineTimes(values, ctx);
    if (!values.repeats) return;

    if (values.patternType === "simple" && !values.simplePattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simplePattern"],
        message: "Choose a repeat pattern.",
      });
    }
    if (values.patternType === "dayofweek" && (!values.ordinal || !values.dayOfWeek)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfWeek"],
        message: "Choose which day of the month this repeats on.",
      });
    }

    const count = Number(values.count);
    if (!values.count || !Number.isInteger(count) || count < 1 || count > MAX_SERIES_TOTAL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["count"],
        message: `Enter a number of occurrences from 1 to ${MAX_SERIES_TOTAL}.`,
      });
    }
  });
export type CreateEventFormValues = z.infer<typeof createEventSchema>;

export const editEventSchema = z.object(baseFields).superRefine(refineTimes);
export type EditEventFormValues = z.infer<typeof editEventSchema>;

export const extendSeriesSchema = z
  .object({
    patternType: z.enum(["simple", "dayofweek"]),
    simplePattern: z.enum(["weekly", "biweekly", "monthly"]).optional(),
    ordinal: z.enum(["1st", "2nd", "3rd", "4th", "last"]).optional(),
    dayOfWeek: z
      .enum(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
      .optional(),
    /** A string, not a number. */
    additionalCount: z.string().min(1, "Enter a number of additional occurrences"),
  })
  .superRefine((values, ctx) => {
    if (values.patternType === "simple" && !values.simplePattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simplePattern"],
        message: "Choose a repeat pattern.",
      });
    }
    if (values.patternType === "dayofweek" && (!values.ordinal || !values.dayOfWeek)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfWeek"],
        message: "Choose which day of the month this repeats on.",
      });
    }
    const additionalCount = Number(values.additionalCount);
    if (!Number.isInteger(additionalCount) || additionalCount < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["additionalCount"],
        message: "Enter at least 1 additional occurrence.",
      });
    }
  });
export type ExtendSeriesFormValues = z.infer<typeof extendSeriesSchema>;
