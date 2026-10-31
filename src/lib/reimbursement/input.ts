import { z } from "zod";
import { COPY } from "./copy";
import { isRealIsoDate } from "./dates";
import { CLIENT_KEY_PATTERN, BENEFICIARY_QUERY_MAX, BENEFICIARY_QUERY_MIN, MAX_AMOUNT_CENTS, MAX_LENGTH, MIN_AMOUNT_CENTS } from "./limits";
import { cleanText, textLength } from "./text";

/**
 * The zod schemas for every member-side action - docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 API Contract Layer 3. PURE.
 *
 * The messages ARE the Copy strings (`copy.ts`), so `zodFieldErrors()` hands the
 * form its inline text directly. Free text is cleaned (`cleanText`, the
 * twin of the database's `clean_text`) BEFORE its length is measured, so an
 * over-length value is a named field error and never a silent truncation.
 *
 * A DRAFT may be partial: amount, date and purpose may be absent until Send
 * (the submit definer reports `incomplete` with what is missing). What is
 * present must be well-formed. The organization id is NEVER an input: every
 * action takes the URL slug and re-resolves it inside the caller's own
 * memberships. Neither is a person id: the actor is the session's user.
 */

const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((value) => cleanText(value ?? null))
    .refine((value) => value === null || textLength(value) <= max, { message: COPY.fieldErrors.tooLong(max) });

const optionalGuid = (message: string) =>
  z
    .string()
    .nullish()
    .transform((value) => (value === undefined || value === null || value === "" ? null : value))
    .refine((value) => value === null || z.guid().safeParse(value).success, { message });

/** Required free text: cleaned first, then judged, so a blank or control-only value is "missing", not "short". */
const requiredText = (max: number, requiredMessage: string) =>
  z
    .string()
    .nullish()
    .transform((value) => cleanText(value ?? null))
    .refine((value) => value !== null, { message: requiredMessage })
    .refine((value) => value === null || textLength(value) <= max, { message: COPY.fieldErrors.tooLong(max) })
    .transform((value) => value as string);

const REQUEST_KINDS = ["reimburse", "vendor"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** The request fields the form edits (shared by create and update). */
const requestFields = {
  kind: z.enum(REQUEST_KINDS, { error: COPY.form.saveFailed }),
  groupId: z.guid({ error: COPY.fieldErrors.group }),
  /** Reimburse kind only; null means "me". */
  beneficiaryPersonId: optionalGuid(COPY.fieldErrors.beneficiaryUnavailable),
  /** Vendor kind only. */
  vendorName: optionalText(MAX_LENGTH.vendor),
  amountCents: z
    .number({ error: COPY.fieldErrors.amount })
    .int({ error: COPY.fieldErrors.amount })
    .min(MIN_AMOUNT_CENTS, { error: COPY.fieldErrors.amount })
    .max(MAX_AMOUNT_CENTS, { error: COPY.fieldErrors.amount })
    .nullish()
    .transform((value) => value ?? null),
  expenseDate: z
    .string()
    .nullish()
    .transform((value) => (value === undefined || value === null || value === "" ? null : value))
    .refine((value) => value === null || isRealIsoDate(value), { message: COPY.fieldErrors.date }),
  purpose: optionalText(MAX_LENGTH.purpose),
  categoryId: optionalGuid(COPY.fieldErrors.category),
  preApprovedBy: optionalText(MAX_LENGTH.preApprover),
  noReceiptClaimed: z.boolean().default(false),
};

/**
 * `saveRequestAction(slug, input)`. `clientKey` is generated once per form (an
 * idempotency key: a double tap or a lost reply finds the same row). With no
 * `requestId` the action creates-or-finds by the key; with one it edits that
 * request, carrying the `expectedRevision` the form last saw.
 */
export const saveRequestSchema = z
  .object({
    clientKey: z.string().regex(CLIENT_KEY_PATTERN, { error: COPY.form.saveFailed }),
    requestId: z.guid({ error: COPY.form.saveFailed }).nullish(),
    expectedRevision: z.number().int().min(1).nullish(),
    ...requestFields,
  })
  .superRefine((value, ctx) => {
    if (value.requestId && (value.expectedRevision === undefined || value.expectedRevision === null)) {
      ctx.addIssue({ code: "custom", path: ["expectedRevision"], message: COPY.form.saveFailed });
    }
  });
export type SaveRequestInput = z.input<typeof saveRequestSchema>;
export type SaveRequestValues = z.output<typeof saveRequestSchema>;

/** `submitRequestAction(slug, input)`. */
export const submitRequestSchema = z.object({
  requestId: z.guid({ error: COPY.detail.unavailable }),
  expectedRevision: z.number({ error: COPY.form.saveFailed }).int().min(1, { error: COPY.form.saveFailed }),
});
export type SubmitRequestInput = z.input<typeof submitRequestSchema>;

/** `withdrawRequestAction(slug, input)`. The reason is optional free text (no field is offered for it today). */
export const withdrawRequestSchema = z.object({
  requestId: z.guid({ error: COPY.detail.unavailable }),
  reason: optionalText(MAX_LENGTH.reason),
});
export type WithdrawRequestInput = z.input<typeof withdrawRequestSchema>;

/** `detachReceiptAction(slug, input)`: the request and the attachment, both ids the page rendered. */
export const detachReceiptSchema = z.object({
  requestId: z.guid({ error: COPY.detail.unavailable }),
  attachmentId: z.guid({ error: COPY.receipts.unavailable }),
});
export type DetachReceiptInput = z.input<typeof detachReceiptSchema>;

/** `searchBeneficiariesAction(slug, input)`: names only, at most eight, never an id the caller typed. */
export const searchBeneficiariesSchema = z.object({
  query: z
    .string()
    .transform((value) => cleanText(value) ?? "")
    .refine((value) => textLength(value) >= BENEFICIARY_QUERY_MIN && textLength(value) <= BENEFICIARY_QUERY_MAX, {
      message: COPY.form.beneficiaryNoMatch,
    }),
});
export type SearchBeneficiariesInput = z.input<typeof searchBeneficiariesSchema>;

/**
 * `approveRequestAction(slug, input)` (the member tree: an approver's SEAT). The
 * path is NOT an input - this action always approves on the seat path; the
 * treasurer's override is its own action in the treasurer tree, so a posted
 * `path` can never choose it.
 */
export const approveRequestSchema = z.object({
  requestId: z.guid({ error: COPY.detail.unavailable }),
  expectedRevision: z.number({ error: COPY.form.saveFailed }).int().min(1, { error: COPY.form.saveFailed }),
});
export type ApproveRequestInput = z.input<typeof approveRequestSchema>;

/** What an approver can do with a request they will not approve (Copy C6: "Needs changes" / "Not approved"). */
export const RETURN_KINDS = ["needs_info", "not_approved"] as const;
export type ReturnKind = (typeof RETURN_KINDS)[number];

/** `returnRequestAction(slug, input)`: the reason is required (the requester reads it) and at most 300 characters. */
export const returnRequestSchema = z.object({
  requestId: z.guid({ error: COPY.detail.unavailable }),
  expectedRevision: z.number({ error: COPY.form.saveFailed }).int().min(1, { error: COPY.form.saveFailed }),
  kind: z.enum(RETURN_KINDS, { error: COPY.detail.unavailable }),
  reason: requiredText(MAX_LENGTH.reason, COPY.decision.reasonRequired),
});
export type ReturnRequestInput = z.input<typeof returnRequestSchema>;
