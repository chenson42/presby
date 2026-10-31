import { z } from "zod";
import { COPY } from "./copy";
import { isRealIsoDate } from "./dates";
import { MAX_LENGTH } from "./limits";
import { cleanText, textLength } from "./text";

/**
 * The zod schemas for every treasurer-tree action - docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 API Contract Layer 3 ("Treasurer tree"). PURE.
 *
 * Same rules as `input.ts` (the member tree): the messages ARE the Copy strings;
 * free text is cleaned (the twin of the database's `clean_text`) BEFORE its
 * length is measured, so an over-length value is a named field error and never
 * a silent truncation; an unknown key is dropped, never trusted. Nothing here
 * accepts an organization id, a person id, a payer, a self-paid flag or an
 * approval path: the actor is the session's user, the organization is the URL
 * slug re-resolved inside that user's own memberships, and `self_paid` is
 * derived by a database trigger.
 *
 * Where Copy has no sentence for a tampered or empty value, the message is the
 * house `COPY.form.saveFailed` (the member schemas do the same for a shape
 * fault); each such place is listed as a Copy gap in the Batch 4 work-log.
 */

const requestId = z.guid({ error: COPY.detail.unavailable });
const expectedRevision = z
  .number({ error: COPY.form.saveFailed })
  .int({ error: COPY.form.saveFailed })
  .min(1, { error: COPY.form.saveFailed });

const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((value) => cleanText(value ?? null))
    .refine((value) => value === null || textLength(value) <= max, { message: COPY.fieldErrors.tooLong(max) });

const requiredText = (max: number, requiredMessage: string, tooLongMessage: string = COPY.fieldErrors.tooLong(max)) =>
  z
    .string()
    .nullish()
    .transform((value) => cleanText(value ?? null))
    .refine((value) => value !== null, { message: requiredMessage })
    .refine((value) => value === null || textLength(value) <= max, { message: tooLongMessage })
    .transform((value) => value as string);

/** How a payment was made. The set the `reimbursement_payments.method` CHECK allows. */
export const PAYMENT_METHODS = ["check", "ach", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** `recordPaymentAction(slug, input)`. A check needs its number (the Lions lesson: an unmatchable payment). */
export const recordPaymentSchema = z
  .object({
    requestId,
    method: z.enum(PAYMENT_METHODS, { error: COPY.form.saveFailed }),
    reference: optionalText(MAX_LENGTH.reference),
    paidOn: z
      .string({ error: COPY.treasury.results.dateOutOfRange })
      .refine((value) => isRealIsoDate(value), { message: COPY.treasury.results.dateOutOfRange }),
    note: optionalText(MAX_LENGTH.paymentNote),
  })
  .superRefine((value, ctx) => {
    if (value.method === "check" && value.reference === null) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: COPY.treasury.results.checkNumberRequired });
    }
  });
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;
export type RecordPaymentValues = z.output<typeof recordPaymentSchema>;

const reasonField = requiredText(MAX_LENGTH.reason, COPY.treasury.results.reasonRequired);

/** `reversePaymentAction(slug, input)`: both entries stay on record; a reason is required. */
export const reversePaymentSchema = z.object({ requestId, reason: reasonField });
export type ReversePaymentInput = z.input<typeof reversePaymentSchema>;

/** `voidAction(slug, input)`: closes an unpaid request; nothing is deleted; a reason is required. */
export const voidRequestSchema = z.object({ requestId, reason: reasonField });
export type VoidRequestInput = z.input<typeof voidRequestSchema>;

/** `waiveReceiptAction(slug, input)`: the note is optional. */
export const waiveReceiptSchema = z.object({ requestId, note: optionalText(MAX_LENGTH.waiverNote) });
export type WaiveReceiptInput = z.input<typeof waiveReceiptSchema>;

/**
 * `treasuryReturnAction(slug, input)`: the treasurer sends a request back for
 * changes. The kind is NOT an input: it is always "needs changes" here (C8: "Send
 * back: as C6 with kind fixed to Needs changes"), so a posted `kind` cannot mark
 * a request not approved from the treasurer's door.
 */
export const treasuryReturnSchema = z.object({ requestId, expectedRevision, reason: reasonField });
export type TreasuryReturnInput = z.input<typeof treasuryReturnSchema>;

/** `overrideApproveAction(slug, input)`: the path is fixed to "override" by the action; a posted `path` is dropped. */
export const overrideApproveSchema = z.object({ requestId, expectedRevision });
export type OverrideApproveInput = z.input<typeof overrideApproveSchema>;

/** `addNoteAction(slug, input)`: an internal note, up to 500 characters. */
export const addNoteSchema = z.object({
  requestId,
  note: requiredText(MAX_LENGTH.note, COPY.treasury.results.noteRequired),
});
export type AddNoteInput = z.input<typeof addNoteSchema>;

/** `setChargeableAction(slug, input)`. */
export const setChargeableSchema = z.object({
  groupId: z.guid({ error: COPY.fieldErrors.groupUnavailable }),
  chargeable: z.boolean({ error: COPY.form.saveFailed }),
});
export type SetChargeableInput = z.input<typeof setChargeableSchema>;

/** `saveCategoryAction(slug, input)`: create (no id) or rename/reorder; 1 to 60 characters after cleaning. */
export const saveCategorySchema = z.object({
  categoryId: z
    .string()
    .nullish()
    .transform((value) => (value === undefined || value === null || value === "" ? null : value))
    .refine((value) => value === null || z.guid().safeParse(value).success, { message: COPY.form.saveFailed }),
  name: z
    .string({ error: COPY.settings.categoryNameInvalid })
    .transform((value) => cleanText(value))
    .refine((value) => value !== null && textLength(value) <= MAX_LENGTH.category, {
      message: COPY.settings.categoryNameInvalid,
    })
    .transform((value) => value as string),
  sortOrder: z
    .number({ error: COPY.form.saveFailed })
    .int({ error: COPY.form.saveFailed })
    .min(-100_000, { error: COPY.form.saveFailed })
    .max(100_000, { error: COPY.form.saveFailed })
    .nullish()
    .transform((value) => value ?? null),
});
export type SaveCategoryInput = z.input<typeof saveCategorySchema>;

/** `endCategoryAction(slug, input)`: retire a category (it stays on old requests). */
export const endCategorySchema = z.object({ categoryId: z.guid({ error: COPY.form.saveFailed }) });
export type EndCategoryInput = z.input<typeof endCategorySchema>;
