/**
 * The closed audience registry (ER14, DECISION-216): every `templateKey` the
 * app enqueues, classified by WHICH ADDRESS its mail goes to. "Wire every send
 * path to the rule for its purpose" becomes mechanical: `email-audience.test.ts`
 * scans non-test `src/` for every `enqueueEmail()` / `insertQueueRowInTx()` call
 * and fails on a template key that is not classified here, and on a registry
 * entry no sender uses. A new sender therefore has to answer "which address?"
 * before it can pass CI.
 *
 *   account            `users.email`, the account's own address. NEVER a
 *                      `contact_methods` row: a contact email authenticates
 *                      nothing, so it is never where a password reset, an
 *                      email-change check or an account notice goes.
 *   typed              an address the operator or administrator TYPED for this
 *                      one send. Matching it to a person uses active addresses
 *                      only (ER3).
 *   donor              the donor's own address on the giving record
 *                      (`giving_donors.email`, snapshotted into
 *                      `giving_statements.delivery_email`). Giving is NOT wired
 *                      to a person's contact addresses in this pipeline (D7).
 *   person:<purpose>   a person's address chosen by `chooseEmail()` /
 *                      `presby_person_email()` for that purpose (ER12). The
 *                      first sender is Community Increment 2b's
 *                      `account_sign_in_invitation`, `person:credential`: the
 *                      issue definer resolves the address in SQL and returns
 *                      it, so the queue row's `to` is never a client string.
 *                      The four reimbursement notices (approver, treasurer and
 *                      requester; Treasury Increment 1, P3-11) use
 *                      `person:role`.
 */
export type Audience =
  | "account"
  | "typed"
  | "donor"
  | "person:credential"
  | "person:role"
  | "person:personal";

export const EMAIL_AUDIENCE: Readonly<Record<string, Audience>> = {
  // account
  password_reset: "account",
  email_change_verify: "account",
  feedback_notification: "account",
  domain_notification: "account",
  ticket_new: "account",
  ticket_filed_confirmation: "account",
  ticket_operator_reply: "account",
  ticket_submitter_reply: "account",
  ticket_resolved: "account",
  ticket_feedback_promoted: "account",
  // typed: founding-administrator and treasurer invitations both send this key
  account_invitation: "typed",
  statistics_submission_grant: "typed",
  // person:credential: a congregation's sign-in invitation, addressed to the
  // person's credential address, chosen by the issue definer in SQL
  account_sign_in_invitation: "person:credential",
  // donor
  "giving.statement.notice": "donor",
  // person:role - an approver, a treasurer or a requester is often staff with only
  // a work address, and all three notices reach a recipient at the same address
  // (src/lib/reimbursement/notices.ts, P3-11). No amount, name or free text in any.
  "reimbursement.notice.needs_approval": "person:role",
  "reimbursement.notice.needs_treasurer": "person:role",
  "reimbursement.notice.ready_to_pay": "person:role",
  "reimbursement.notice.requester_update": "person:role",
};

export function audienceFor(templateKey: string): Audience | null {
  return Object.prototype.hasOwnProperty.call(EMAIL_AUDIENCE, templateKey)
    ? EMAIL_AUDIENCE[templateKey]!
    : null;
}
