import type { ReimbursementActionFailure } from "./action-result";
import { COPY } from "./copy";
import { MAX_LENGTH } from "./limits";
import { formatCalendarDate } from "./dates";
import type { ReturnKind } from "./input";
import type { SubmitMissing } from "./outcomes";

/**
 * Definer outcome -> the failure a member form shows. PURE; every string is a
 * Copy string (`copy.ts`), keyed to the form field it belongs next to
 * (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 Copy C3 and C5). The
 * field keys are the `saveRequestSchema` input names the form already uses
 * (`amountCents`, `expenseDate`, `purpose`, `vendorName`, `groupId`,
 * `categoryId`, `beneficiaryPersonId`, `preApprovedBy`), plus `receipts` for the
 * "add a receipt or tick the box" message.
 *
 * `not_found` and `not_editable` are ONE neutral answer: a request that does
 * not exist, one the caller may not touch, and one no longer editable read the
 * same, so the message cannot be used to probe request ids (EC16).
 *
 * `error` (the toast text) is the first field message when there are field
 * messages, so a form that only toasts still says something specific.
 */

const withFields = (fieldErrors: Record<string, string>): ReimbursementActionFailure => ({
  ok: false,
  error: Object.values(fieldErrors)[0]!,
  fieldErrors,
});

/** The failure for a refused save (`save_draft` or `update_request`). */
export function saveRefusal(outcome: string, ctx: { organizationName: string }): ReimbursementActionFailure {
  switch (outcome) {
    case "invalid_shape":
    case "kind_invalid":
      return { ok: false, error: COPY.form.saveFailed };
    case "not_eligible":
      return { ok: false, error: COPY.page.cannotFile(ctx.organizationName) };
    case "too_many_drafts":
      return { ok: false, error: COPY.form.tooManyDrafts };
    case "group_not_chargeable":
      return withFields({ groupId: COPY.fieldErrors.groupUnavailable });
    case "not_allowed_for_others":
      return withFields({ beneficiaryPersonId: COPY.fieldErrors.forOthers });
    case "beneficiary_unavailable":
      return withFields({ beneficiaryPersonId: COPY.fieldErrors.beneficiaryUnavailable });
    case "vendor_too_long":
      return withFields({ vendorName: COPY.fieldErrors.tooLong(MAX_LENGTH.vendor) });
    case "amount_out_of_range":
      return withFields({ amountCents: COPY.fieldErrors.amount });
    case "date_out_of_range":
      return withFields({ expenseDate: COPY.fieldErrors.date });
    case "purpose_too_long":
      return withFields({ purpose: COPY.fieldErrors.tooLong(MAX_LENGTH.purpose) });
    case "pre_approved_too_long":
      return withFields({ preApprovedBy: COPY.fieldErrors.tooLong(MAX_LENGTH.preApprover) });
    case "category_unavailable":
      return withFields({ categoryId: COPY.fieldErrors.category });
    case "changed_since_viewed":
      return { ok: false, error: COPY.form.changedInAnotherWindow, kind: "changed_since_viewed" };
    case "not_found":
    case "not_editable":
    default:
      return { ok: false, error: COPY.detail.unavailable, kind: "not_found" };
  }
}

/** What an `incomplete` submit still needs, as field messages (the vendor's name rides `vendorName`). */
const MISSING_FIELD: Record<SubmitMissing, { field: string; message: string }> = {
  amount: { field: "amountCents", message: COPY.fieldErrors.amount },
  date: { field: "expenseDate", message: COPY.fieldErrors.date },
  purpose: { field: "purpose", message: COPY.fieldErrors.purpose },
  payee: { field: "vendorName", message: COPY.fieldErrors.vendor },
  category: { field: "categoryId", message: COPY.fieldErrors.category },
  receipt: { field: "receipts", message: COPY.fieldErrors.receipt },
};

export function incompleteRefusal(missing: readonly SubmitMissing[]): ReimbursementActionFailure {
  const fieldErrors: Record<string, string> = {};
  for (const item of missing) {
    const entry = MISSING_FIELD[item];
    if (entry && !(entry.field in fieldErrors)) fieldErrors[entry.field] = entry.message;
  }
  if (Object.keys(fieldErrors).length === 0) return { ok: false, error: COPY.form.saveFailed };
  return withFields(fieldErrors);
}

/** The failure for a refused submit (everything but `incomplete`, which carries `missing`). */
export function submitRefusal(outcome: string, ctx: { organizationName: string }): ReimbursementActionFailure {
  switch (outcome) {
    case "group_not_chargeable":
      return withFields({ groupId: COPY.fieldErrors.groupUnavailable });
    case "not_eligible":
      return { ok: false, error: COPY.page.cannotFile(ctx.organizationName) };
    case "changed_since_viewed":
      return { ok: false, error: COPY.form.changedInAnotherWindow, kind: "changed_since_viewed" };
    case "not_found":
    case "not_editable":
    default:
      return { ok: false, error: COPY.detail.unavailable, kind: "not_found" };
  }
}

/** The sentence shown after Send, by the route the submit definer computed live (C3). `null`: it was already past submission. */
export function sentMessage(route: "seat" | "treasurer" | "nobody" | null, groupName: string | null): string {
  const group = groupName ?? "the group";
  if (route === "treasurer") return COPY.form.sent.treasurer(group);
  if (route === "nobody") return COPY.form.sent.nobody(group);
  return COPY.form.sent.seat(group);
}

// ---------------------------------------------------------------------------
// Approve and send back (Copy C6)
// ---------------------------------------------------------------------------

/**
 * The failure for a refused approve or send back (every outcome but `ok` and
 * `already_decided`, which carries a date: see `alreadyDecidedFailure`).
 *
 * `not_found`, `not_approvable`, `not_returnable` and `kind_invalid` are ONE
 * neutral answer: a request that does not exist, one the caller may not decide
 * and one that is no longer in a decidable state (withdrawn, closed) read the
 * same, so the text cannot be used to probe ids or seats (EC16). The two
 * override refusals (`seat_holder_exists`, `needs_second_payer`) cannot come
 * back from the member tree's seat path; they take the same neutral string here,
 * and the treasurer tree maps them to their own Copy C8 sentences, which need
 * the group name and whether the viewer holds `manage`.
 */
export function decisionRefusal(outcome: string): ReimbursementActionFailure {
  switch (outcome) {
    case "changed_since_viewed":
      return { ok: false, error: COPY.decision.changedAfterOpened, kind: "changed_since_viewed" };
    case "reason_required":
      return withFields({ reason: COPY.decision.reasonRequired });
    case "reason_too_long":
      return withFields({ reason: COPY.fieldErrors.tooLong(MAX_LENGTH.reason) });
    case "not_found":
    case "not_approvable":
    case "not_returnable":
    case "kind_invalid":
    default:
      return { ok: false, error: COPY.detail.unavailable, kind: "not_found" };
  }
}

/**
 * "This was already approved on <date>" / "already sent back on <date>". The
 * date is the org-local day of the deciding event and NO ACTOR is named, to
 * anyone (the treasury team reads who in the request's history, not here).
 * `approved` and `paid` read as approved; `returned` and `not_approved` read as
 * sent back (Copy C6 has these two sentences). With no date or an unknown
 * status the neutral string is shown rather than a made-up one.
 */
export function alreadyDecidedFailure(status: string | null, decidedOn: string | null): ReimbursementActionFailure {
  const base = { ok: false as const, kind: "already_decided" as const, decidedOn, status: status ?? undefined };
  if (!decidedOn) return { ...base, error: COPY.detail.unavailable };
  const date = formatCalendarDate(decidedOn);
  if (status === "approved" || status === "paid") return { ...base, error: COPY.decision.alreadyApproved(date) };
  if (status === "returned" || status === "not_approved") return { ...base, error: COPY.decision.alreadySentBack(date) };
  return { ...base, error: COPY.detail.unavailable };
}

/** The success text after a send back: "Sent back." or "Marked not approved.". */
export function returnedMessage(kind: ReturnKind): string {
  return kind === "not_approved" ? COPY.decision.markedNotApproved : COPY.decision.sentBack;
}
