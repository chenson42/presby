import {
  BULK_APPROVE_MAX,
  type RollDecisionRefusal,
  type RollWithdrawRefusal,
} from "@/lib/roll-action-kinds";

/**
 * The one copy table for every typed outcome of approving, denying and
 * withdrawing a roll action (docs/work-log/2026-10-22-founding-admin-
 * directory.md, Increment 2 Phase 3 "Copy"). Plain module (no `server-only`, no
 * `"use server"`): the server actions import it for their `{ ok: false, error }`
 * strings and the client dialogs may import it for toasts, so a code never has
 * two wordings.
 *
 * `Record<Code, string>` over the closed vocabularies in `roll-action-kinds.ts`
 * (themselves pinned to the SQL by a source-scan test): a code the database
 * can return that has no copy here is a TYPE ERROR, not a runtime hole.
 * Organization and person names are not interpolated (the actions have no name
 * in scope); the page adds them.
 *
 * `active_elsewhere` and `provisioning_incomplete` deliberately say nothing
 * about the cause: the first would otherwise tell one congregation that a
 * person is on another congregation's active roll, so it points to a support
 * ticket instead and never names the other organization.
 */

export type DecisionCopyCode = RollDecisionRefusal | "forbidden";

export const DECISION_COPY: Record<DecisionCopyCode, string> = {
  forbidden: "You don't have permission to approve or deny roll actions here.",
  invalid_decision: "That action isn't recognised. Refresh the page and try again.",
  reason_required: "Say why you're denying this.",
  reason_too_long: "Keep the reason under 500 characters.",
  minute_reference_too_long: "Keep the minute reference under 200 characters.",
  not_found: "That roll action could not be found.",
  already_decided:
    "Someone already decided this one. Refresh to see the current status.",
  not_approvable_kind:
    "This kind of entry can't be approved here. Deny it, or ask the person who proposed it to withdraw it.",
  person_deceased:
    "This person is recorded as deceased. Deny this action or correct the record first.",
  person_merged:
    "This person's record was merged into another. Deny this action and propose it again on the current record.",
  membership_ended:
    "This person's connection to this congregation has ended, so this can't be approved. Deny it instead.",
  holds_pastoral_office:
    "This person is recorded as a pastor of this congregation. A pastor's membership is held by the presbytery, so they aren't received onto this congregation's roll. Deny this action.",
  already_on_roll:
    "This person is already on that roll as of the effective date. Approving would count them twice. Deny the duplicate.",
  active_elsewhere:
    "This can't be approved right now. Send us a support ticket and we'll look into it.",
  provisioning_incomplete:
    "This organization's membership setup isn't finished, so this can't be decided yet. Send us a support ticket.",
};

export type WithdrawCopyCode = RollWithdrawRefusal | "forbidden";

export const WITHDRAW_COPY: Record<WithdrawCopyCode, string> = {
  forbidden: "You don't have permission to withdraw roll actions here.",
  reason_required: "Say why you're withdrawing this.",
  reason_too_long: "Keep the reason under 500 characters.",
  not_found: "That roll action could not be found.",
  already_decided:
    "The Session already decided this one, so it can't be withdrawn. Refresh to see what happened.",
};

/** Bulk approve's own request-level refusals (the per-row ones use
 * `DECISION_COPY`). */
export const BULK_COPY = {
  empty: "Select at least one roll action to approve.",
  tooMany: `Approve at most ${BULK_APPROVE_MAX} roll actions at a time.`,
} as const;

/** Validation copy for the actions' own bad-input checks. */
export const DECISION_VALIDATION_COPY = {
  signedOut: "You must be signed in to do that.",
  noAccess: "You don't have access to that organization.",
} as const;
