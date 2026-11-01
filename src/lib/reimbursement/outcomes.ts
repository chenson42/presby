/**
 * The closed outcome lists of the write definers - docs/work-log/2026-10-25-
 * treasury-inc1.md, Phase 3 API Contract Layer 1 and the Batch 1a handoff
 * ("outcomes.ts should be pinned to those comments"). PURE.
 *
 * A STATE refusal is never an exception: the definer returns an `outcome` from
 * a closed list, and TypeScript maps each to a sentence. (An IDENTITY refusal -
 * no live person here, or a missing key - raises SQLSTATE 42501 with the
 * single literal `reimbursement: not permitted`; see `db-util.ts`.) A missing
 * request and a forbidden one both answer `not_found`, from the same path.
 *
 * `outcomes.test.ts` parses every `outcome := '…'` out of drizzle/0073 and
 * fails when a list here and the function's body disagree, in either
 * direction.
 */

/** Field outcomes shared by save_draft and update_request (0073 3r `check_fields`). */
export const FIELD_OUTCOMES = [
  "kind_invalid",
  "group_not_chargeable",
  "invalid_shape",
  "not_allowed_for_others",
  "beneficiary_unavailable",
  "vendor_too_long",
  "amount_out_of_range",
  "date_out_of_range",
  "purpose_too_long",
  "pre_approved_too_long",
  "category_unavailable",
] as const;

export const OUTCOMES = {
  saveDraft: ["ok", "not_eligible", "too_many_drafts", ...FIELD_OUTCOMES],
  updateRequest: ["ok", "not_found", "not_editable", "changed_since_viewed", ...FIELD_OUTCOMES],
  submit: [
    "ok",
    "already_submitted",
    "not_found",
    "not_editable",
    "changed_since_viewed",
    "not_eligible",
    "incomplete",
    "group_not_chargeable",
  ],
  withdraw: ["ok", "not_found", "not_withdrawable", "reason_too_long"],
  approve: [
    "ok",
    "not_found",
    "already_decided",
    "not_approvable",
    "changed_since_viewed",
    "seat_holder_exists",
    "needs_second_payer",
  ],
  return: [
    "ok",
    "not_found",
    "already_decided",
    "not_returnable",
    "changed_since_viewed",
    "kind_invalid",
    "reason_required",
    "reason_too_long",
  ],
  void: ["ok", "not_found", "not_voidable", "reason_required", "reason_too_long"],
  waiveReceipt: ["ok", "not_found", "not_waivable", "receipt_present", "note_too_long"],
  recordPayment: [
    "ok",
    "not_found",
    "already_paid",
    "not_payable",
    "method_invalid",
    "reference_required",
    "reference_too_long",
    "date_out_of_range",
    "note_too_long",
    "payer_is_approver",
    "needs_another_payer",
    "receipt_missing",
  ],
  reversePayment: ["ok", "not_found", "not_reversible", "reason_required", "reason_too_long"],
  addNote: ["ok", "not_found", "note_required", "note_too_long"],
  receiptPreflight: ["ok", "not_found", "not_editable", "too_many_receipts"],
  attachReceipt: ["ok", "not_found", "not_editable", "invalid_shape", "duplicate_in_request", "too_many_receipts"],
  detachReceipt: ["ok", "not_found", "not_editable"],
  setChargeable: ["ok", "group_unavailable", "unchanged"],
  saveCategory: ["ok", "not_found", "name_invalid", "name_taken"],
  endCategory: ["ok", "not_found"],
} as const satisfies Record<string, readonly string[]>;

export type OutcomeName = keyof typeof OUTCOMES;
export type OutcomeOf<K extends OutcomeName> = (typeof OUTCOMES)[K][number];

/** The `missing` entries of an `incomplete` submit, in the definer's order. */
export const SUBMIT_MISSING = ["amount", "date", "purpose", "payee", "category", "receipt"] as const;
export type SubmitMissing = (typeof SUBMIT_MISSING)[number];

/** The route a submitted request takes, computed live by the definer. */
export const SUBMIT_ROUTES = ["seat", "treasurer", "nobody"] as const;
export type SubmitRoute = (typeof SUBMIT_ROUTES)[number];
