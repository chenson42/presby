import { COPY } from "@/lib/reimbursement/copy";
import { digitsToCents, isAmountInRange } from "@/lib/reimbursement/amount-input";
import { cleanText, textLength } from "@/lib/reimbursement/text";
import { MAX_LENGTH } from "@/lib/reimbursement/limits";

/**
 * The request form's model - PURE (no React, no server): the shape of its
 * values, what a Save or a Send posts, the checks the form makes BEFORE a round
 * trip, and how the server's field messages map back onto the form's fields.
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 Copy C3.
 *
 * The server stays the authority: every check here is a courtesy that spares a
 * round trip (and, for Send, spares creating a half-empty draft). The messages
 * ARE the Copy strings; nothing is worded here.
 *
 * `mode` is the radio ("Pay me back" / "Pay someone else back" / "Pay a
 * vendor"). On the wire it is `kind` (`reimburse` or `vendor`) plus a
 * `beneficiaryPersonId` that is null for "me" (the schema's "null means me").
 */

export type PayMode = "me" | "other" | "vendor";

export interface RequestFormValues {
  mode: PayMode;
  groupId: string;
  categoryId: string;
  beneficiaryPersonId: string;
  beneficiaryName: string;
  vendorName: string;
  /** Integer cents as a digit string, no leading zeros; "" when nothing is entered. */
  amountDigits: string;
  /** `YYYY-MM-DD` or "". */
  expenseDate: string;
  purpose: string;
  preApprovedBy: string;
  noReceiptClaimed: boolean;
}

export function emptyFormValues(): RequestFormValues {
  return {
    mode: "me",
    groupId: "",
    categoryId: "",
    beneficiaryPersonId: "",
    beneficiaryName: "",
    vendorName: "",
    amountDigits: "",
    expenseDate: "",
    purpose: "",
    preApprovedBy: "",
    noReceiptClaimed: false,
  };
}

export type FormErrors = Partial<Record<keyof RequestFormValues, string>>;

/** The server's field keys (the `saveRequestSchema` names plus `receipts`) to this form's field names. */
const SERVER_FIELD: Record<string, keyof RequestFormValues> = {
  kind: "mode",
  groupId: "groupId",
  beneficiaryPersonId: "beneficiaryPersonId",
  vendorName: "vendorName",
  amountCents: "amountDigits",
  expenseDate: "expenseDate",
  purpose: "purpose",
  categoryId: "categoryId",
  preApprovedBy: "preApprovedBy",
  receipts: "noReceiptClaimed",
};

/** Splits the server's `fieldErrors` into form-field errors and everything else (shown as the banner). */
export function mapServerFieldErrors(fieldErrors: Record<string, string> | undefined): {
  errors: FormErrors;
  unmapped: string[];
} {
  const errors: FormErrors = {};
  const unmapped: string[] = [];
  for (const [key, message] of Object.entries(fieldErrors ?? {})) {
    const field = SERVER_FIELD[key];
    if (field && !(field in errors)) errors[field] = message;
    else if (!field) unmapped.push(message);
  }
  return { errors, unmapped };
}

export interface SavePayload {
  clientKey: string;
  requestId?: string;
  expectedRevision?: number;
  kind: "reimburse" | "vendor";
  groupId: string;
  beneficiaryPersonId: string | null;
  vendorName: string | null;
  amountCents: number | null;
  expenseDate: string | null;
  purpose: string | null;
  categoryId: string | null;
  preApprovedBy: string | null;
  noReceiptClaimed: boolean;
}

/** The amount in cents from the digit string, or null when nothing (or nothing legal) is entered. */
export function amountCentsOf(digits: string): number | null {
  const cents = digitsToCents(digits);
  return cents === null || cents === 0 ? null : cents;
}

const orNull = (text: string): string | null => {
  const trimmed = text.trim();
  return trimmed === "" ? null : text;
};

/**
 * What `saveRequestAction` is posted. Fields that do not belong to the chosen
 * mode are not sent (a vendor name typed and then abandoned for "Pay me back"
 * must not ride along). `requestId` + `expectedRevision` turn a save into an edit.
 */
export function buildSavePayload(
  values: RequestFormValues,
  ctx: { clientKey: string; saved: { requestId: string; revision: number } | null },
): SavePayload {
  const vendor = values.mode === "vendor";
  return {
    clientKey: ctx.clientKey,
    ...(ctx.saved ? { requestId: ctx.saved.requestId, expectedRevision: ctx.saved.revision } : {}),
    kind: vendor ? "vendor" : "reimburse",
    groupId: values.groupId,
    beneficiaryPersonId: values.mode === "other" && values.beneficiaryPersonId ? values.beneficiaryPersonId : null,
    vendorName: vendor ? orNull(values.vendorName) : null,
    amountCents: amountCentsOf(values.amountDigits),
    expenseDate: values.expenseDate === "" ? null : values.expenseDate,
    purpose: orNull(values.purpose),
    categoryId: values.categoryId === "" ? null : values.categoryId,
    preApprovedBy: orNull(values.preApprovedBy),
    noReceiptClaimed: values.noReceiptClaimed,
  };
}

/**
 * A draft needs a group (the schema's one required field) and, for "Pay someone
 * else back", the person: a draft saved without one would come back as "Pay me
 * back", which is not what was chosen.
 */
export function validateForDraft(values: RequestFormValues): FormErrors {
  const errors: FormErrors = {};
  if (values.groupId === "") errors.groupId = COPY.fieldErrors.group;
  if (values.mode === "other" && values.beneficiaryPersonId === "") errors.beneficiaryPersonId = COPY.fieldErrors.beneficiary;
  return errors;
}

/** What Send needs, mirroring the submit definer's `incomplete` list so a half-empty form never creates a draft. */
export function validateForSend(
  values: RequestFormValues,
  ctx: { hasCategories: boolean; receiptCount: number },
): FormErrors {
  const errors: FormErrors = { ...validateForDraft(values) };
  if (values.mode === "vendor") {
    const vendor = cleanText(values.vendorName);
    if (vendor === null) errors.vendorName = COPY.fieldErrors.vendor;
    else if (textLength(vendor) > MAX_LENGTH.vendor) errors.vendorName = COPY.fieldErrors.tooLong(MAX_LENGTH.vendor);
  }
  const cents = amountCentsOf(values.amountDigits);
  if (cents === null || !isAmountInRange(cents)) errors.amountDigits = COPY.fieldErrors.amount;
  if (values.expenseDate === "") errors.expenseDate = COPY.fieldErrors.date;
  const purpose = cleanText(values.purpose);
  if (purpose === null) errors.purpose = COPY.fieldErrors.purpose;
  else if (textLength(purpose) > MAX_LENGTH.purpose) errors.purpose = COPY.fieldErrors.tooLong(MAX_LENGTH.purpose);
  if (ctx.hasCategories && values.categoryId === "") errors.categoryId = COPY.fieldErrors.category;
  if (!values.noReceiptClaimed && ctx.receiptCount === 0) errors.noReceiptClaimed = COPY.fieldErrors.receipt;
  return errors;
}

/** The field order on the page, for "focus the first error". */
export const FIELD_ORDER: readonly (keyof RequestFormValues)[] = [
  "mode",
  "groupId",
  "categoryId",
  "beneficiaryPersonId",
  "vendorName",
  "amountDigits",
  "expenseDate",
  "purpose",
  "preApprovedBy",
  "noReceiptClaimed",
];

/** The slice of the member detail the edit form is prefilled from. */
export interface EditableDetail {
  kind: "reimburse" | "vendor";
  group: { id: string; name: string } | null;
  category: { id: string; name: string; retired: boolean } | null;
  payee:
    | { kind: "vendor"; name: string | null }
    | { kind: "person"; name: string | null; personId: string | null };
  amountCents: number | null;
  expenseDate: string | null;
  purpose: string | null;
  preApprovedByName: string | null;
  noReceiptClaimed: boolean;
}

/**
 * The edit page's starting values. A reimbursement whose payee is the viewer is
 * "Pay me back"; anyone else is "Pay someone else back" (only a holder of
 * `request_for_others` could have made it, and only the creator edits).
 */
export function detailToFormValues(detail: EditableDetail, viewerPersonId: string): RequestFormValues {
  const base = emptyFormValues();
  const mode: PayMode =
    detail.kind === "vendor" ? "vendor" : detail.payee.kind === "person" && detail.payee.personId && detail.payee.personId !== viewerPersonId ? "other" : "me";
  return {
    ...base,
    mode,
    groupId: detail.group?.id ?? "",
    categoryId: detail.category?.id ?? "",
    beneficiaryPersonId: mode === "other" && detail.payee.kind === "person" ? (detail.payee.personId ?? "") : "",
    beneficiaryName: mode === "other" ? (detail.payee.name ?? "") : "",
    vendorName: mode === "vendor" ? (detail.payee.name ?? "") : "",
    amountDigits: detail.amountCents && detail.amountCents > 0 ? String(detail.amountCents) : "",
    expenseDate: detail.expenseDate ?? "",
    purpose: detail.purpose ?? "",
    preApprovedBy: detail.preApprovedByName ?? "",
    noReceiptClaimed: detail.noReceiptClaimed,
  };
}
