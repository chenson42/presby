import type { ReimbursementActionFailure } from "./action-result";
import { COPY } from "./copy";
import { MAX_LENGTH } from "./limits";
import { decisionRefusal } from "./messages";

/**
 * Definer outcome -> the failure a treasurer form shows. PURE; every string is a
 * Copy string (`copy.ts`, C7 to C9), keyed to the form field it belongs next to
 * (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 Copy C8). The field keys
 * are `treasury-input.ts` input names: `reference`, `paidOn`, `note`, `reason`,
 * `name`.
 *
 * NEUTRAL ONLY FOR "NOT FOUND" (EC16, amended by Phase 3 amendment S3). A request
 * that does not exist and one the caller may not see read `This request isn't
 * available.`, so the text cannot be used to probe ids. A request that is in the
 * wrong state for the verb (not voidable, not reversible, not waivable, not
 * approvable, not returnable) reads its own short sentence in `treasury.refusals`,
 * worded so it is true for every cause of that outcome (it names no cause, so it
 * neither confirms nor denies a separation-of-duties check). The member tree
 * (`messages.ts`) is unchanged and stays on the neutral answer. The C8 "pre-form
 * blocks" (`payer_is_approver`, `needs_another_payer`, `receipt_missing`,
 * `not_payable`, `already_paid`) tell the viewer what to do.
 */

const NEUTRAL: ReimbursementActionFailure = { ok: false, error: COPY.detail.unavailable, kind: "not_found" };
const neutral = (): ReimbursementActionFailure => ({ ...NEUTRAL });

const withFields = (fieldErrors: Record<string, string>): ReimbursementActionFailure => ({
  ok: false,
  error: Object.values(fieldErrors)[0]!,
  fieldErrors,
});

/** The failure for a refused `record_payment`. */
export function paymentRefusal(outcome: string): ReimbursementActionFailure {
  switch (outcome) {
    case "already_paid":
      return { ok: false, error: COPY.treasury.blocks.alreadyPaid };
    case "not_payable":
      return { ok: false, error: COPY.treasury.blocks.notWaitingForPayment };
    case "receipt_missing":
      return { ok: false, error: COPY.treasury.blocks.receiptNeeded };
    case "payer_is_approver":
      return { ok: false, error: COPY.treasury.blocks.approverCannotPay };
    case "needs_another_payer":
      return { ok: false, error: COPY.treasury.blocks.anotherPayer };
    case "reference_required":
      return withFields({ reference: COPY.treasury.results.checkNumberRequired });
    case "reference_too_long":
      return withFields({ reference: COPY.fieldErrors.tooLong(MAX_LENGTH.reference) });
    case "date_out_of_range":
      return withFields({ paidOn: COPY.treasury.results.dateOutOfRange });
    case "note_too_long":
      return withFields({ note: COPY.fieldErrors.tooLong(MAX_LENGTH.paymentNote) });
    case "method_invalid":
      return { ok: false, error: COPY.form.saveFailed };
    case "not_found":
    default:
      return neutral();
  }
}

/** The failure for a refused void or reverse (the two verbs that take a required reason). */
export function reasonVerbRefusal(outcome: string): ReimbursementActionFailure {
  switch (outcome) {
    case "reason_required":
      return withFields({ reason: COPY.treasury.results.reasonRequired });
    case "reason_too_long":
      return withFields({ reason: COPY.fieldErrors.tooLong(MAX_LENGTH.reason) });
    case "not_voidable":
      return { ok: false, error: COPY.treasury.refusals.notVoidable };
    case "not_reversible":
      return { ok: false, error: COPY.treasury.refusals.notReversible };
    case "not_found":
    default:
      return neutral();
  }
}

/** The failure for a refused waiver. */
export function waiveRefusal(outcome: string): ReimbursementActionFailure {
  switch (outcome) {
    case "note_too_long":
      return withFields({ note: COPY.fieldErrors.tooLong(MAX_LENGTH.waiverNote) });
    case "not_waivable":
      return { ok: false, error: COPY.treasury.refusals.notWaivable };
    case "receipt_present":
      return { ok: false, error: COPY.treasury.refusals.receiptPresent };
    case "not_found":
    default:
      return neutral();
  }
}

/** The failure for a refused treasury note. */
export function addNoteRefusal(outcome: string): ReimbursementActionFailure {
  switch (outcome) {
    case "note_required":
      return withFields({ note: COPY.treasury.results.noteRequired });
    case "note_too_long":
      return withFields({ note: COPY.fieldErrors.tooLong(MAX_LENGTH.note) });
    case "not_found":
    default:
      return neutral();
  }
}

/**
 * The failure for a refused override approval (C8). The two override refusals
 * need the group's name (`seat_holder_exists`) and whether the viewer holds
 * `manage` (`needs_second_payer`: only a manager is pointed at the Treasury team
 * page, so nobody is told to do what they cannot). The team LINK is the UI's:
 * the failure carries `suggestTeam: true` and the UI appends
 * `COPY.treasury.override.addOneUnderTeam` as a link after `error`.
 *
 * `groupName` is null when the viewer cannot read the request (a `pay` holder
 * without `view`); the sentence then says "the group", as the member form does.
 */
export function overrideRefusal(
  outcome: string,
  ctx: { groupName: string | null; holdsManage: boolean },
): ReimbursementActionFailure {
  switch (outcome) {
    case "seat_holder_exists":
      return { ok: false, error: COPY.treasury.override.seatHolderExists(ctx.groupName ?? "the group") };
    case "needs_second_payer":
      return {
        ok: false,
        error: COPY.treasury.override.needsSecondPayer,
        ...(ctx.holdsManage ? { suggestTeam: true } : {}),
      };
    case "changed_since_viewed":
      return { ok: false, error: COPY.decision.changedAfterOpened, kind: "changed_since_viewed" };
    case "not_approvable":
      return { ok: false, error: COPY.treasury.refusals.notApprovable };
    case "not_found":
    default:
      return neutral();
  }
}

/**
 * The failure for a refused treasurer send back. `not_returnable` is the
 * treasurer sentence (amendment S3); every other outcome (`changed_since_viewed`,
 * the reason field errors, `not_found`, `kind_invalid`) is the member tree's own
 * mapping, which this delegates to, so the two trees cannot drift on them.
 */
export function treasuryReturnRefusal(outcome: string): ReimbursementActionFailure {
  if (outcome === "not_returnable") return { ok: false, error: COPY.treasury.refusals.notReturnable };
  return decisionRefusal(outcome);
}

/** The failure for a refused chargeable-group change. */
export function chargeableRefusal(outcome: string): ReimbursementActionFailure {
  void outcome; // `group_unavailable` is the only refusal
  return { ok: false, error: COPY.fieldErrors.groupUnavailable };
}

/** The failure for a refused category save or retire. */
export function categoryRefusal(outcome: string): ReimbursementActionFailure {
  switch (outcome) {
    case "name_invalid":
      return withFields({ name: COPY.settings.categoryNameInvalid });
    case "name_taken":
      return withFields({ name: COPY.settings.categoryNameTaken });
    case "not_found":
    default:
      return { ok: false, error: COPY.settings.categoryGone };
  }
}
