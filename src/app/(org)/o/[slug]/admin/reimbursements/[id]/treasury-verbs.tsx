"use client";

import { COPY } from "@/lib/reimbursement/copy";
import { MAX_LENGTH } from "@/lib/reimbursement/limits";
import {
  addNoteAction,
  reversePaymentAction,
  treasuryReturnAction,
  voidAction,
  waiveReceiptAction,
} from "../actions";
import { OverrideDialog } from "./override-dialog";
import { ReasonDialog } from "./reason-dialog";
import type { TreasuryUi } from "./treasury-ui";

/**
 * The treasurer's verb buttons on one request - docs/work-log/2026-10-25-treasury-
 * inc1.md, Copy C8 and the Batch 4 amendment (S4). Which ones appear is
 * `treasuryUi`'s answer (a courtesy: every click is decided again by the definer).
 * Each is 44 px tall and they wrap/stack on a phone so none can be pushed off the
 * screen. Rendered only when at least one is offered.
 *
 *   Reverse payment        reason required        reversePaymentAction
 *   Waive receipt          note optional          waiveReceiptAction
 *   Send back to requester reason required        treasuryReturnAction (kind is fixed
 *                          to "needs changes", so there is NO radio; the body says
 *                          the request will need approval again when it is approved)
 *   Void request           reason required        voidAction
 *   Approve as treasurer   confirm only           overrideApproveAction
 *   Add a note             note required          addNoteAction
 */

export function TreasuryVerbs({
  slug,
  requestId,
  revision,
  group,
  ui,
}: {
  slug: string;
  requestId: string;
  /** The revision the page displayed; send back and override carry it. */
  revision: number;
  group: string;
  ui: TreasuryUi;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" data-testid="treasury-verbs">
      {ui.override && <OverrideDialog slug={slug} requestId={requestId} revision={revision} group={group} />}
      {ui.reverse && (
        <ReasonDialog
          testId="reverse"
          triggerLabel={COPY.treasury.buttons.reversePayment}
          title={COPY.treasury.reverse.title}
          body={COPY.treasury.reverse.body}
          fieldLabel={COPY.treasury.reverse.reason}
          fieldName="reason"
          required
          requiredMessage={COPY.treasury.results.reasonRequired}
          maxLength={MAX_LENGTH.reason}
          confirmLabel={COPY.treasury.buttons.reversePayment}
          submit={(reason) => reversePaymentAction(slug, { requestId, reason })}
        />
      )}
      {ui.waive && (
        <ReasonDialog
          testId="waive"
          triggerLabel={COPY.treasury.buttons.waiveReceipt}
          title={COPY.treasury.waive.title}
          body={COPY.treasury.waive.body}
          fieldLabel={COPY.treasury.waive.note}
          fieldName="note"
          required={false}
          requiredMessage={COPY.treasury.results.noteRequired}
          maxLength={MAX_LENGTH.waiverNote}
          confirmLabel={COPY.treasury.buttons.waiveReceipt}
          submit={(note) => waiveReceiptAction(slug, { requestId, note })}
        />
      )}
      {ui.sendBack && (
        <ReasonDialog
          testId="treasury-send-back"
          triggerLabel={COPY.treasury.buttons.sendBack}
          title={COPY.treasury.sendBack.title}
          body={ui.sendBack === "approved" ? COPY.treasury.sendBack.bodyApproved : COPY.treasury.sendBack.body}
          fieldLabel={COPY.decision.reasonLabel}
          fieldName="reason"
          required
          requiredMessage={COPY.treasury.results.reasonRequired}
          maxLength={MAX_LENGTH.reason}
          confirmLabel={COPY.decision.sendBackConfirm}
          submit={(reason) => treasuryReturnAction(slug, { requestId, expectedRevision: revision, reason })}
        />
      )}
      {ui.void && (
        <ReasonDialog
          testId="void"
          triggerLabel={COPY.treasury.buttons.void}
          title={COPY.treasury.void.title}
          body={COPY.treasury.void.body}
          fieldLabel={COPY.treasury.void.reason}
          fieldName="reason"
          required
          requiredMessage={COPY.treasury.results.reasonRequired}
          maxLength={MAX_LENGTH.reason}
          confirmLabel={COPY.treasury.buttons.void}
          submit={(reason) => voidAction(slug, { requestId, reason })}
        />
      )}
      {ui.note && (
        <ReasonDialog
          testId="note"
          triggerLabel={COPY.treasury.buttons.addNote}
          title={COPY.treasury.buttons.addNote}
          fieldLabel={COPY.treasury.note.field}
          fieldName="note"
          hint={COPY.treasury.note.hint}
          required
          requiredMessage={COPY.treasury.results.noteRequired}
          maxLength={MAX_LENGTH.note}
          confirmLabel={COPY.treasury.buttons.addNote}
          submit={(note) => addNoteAction(slug, { requestId, note })}
        />
      )}
    </div>
  );
}
