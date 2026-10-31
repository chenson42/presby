import Link from "next/link";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/reimbursement/amount-input";
import { COPY } from "@/lib/reimbursement/copy";
import type { MemberDetail } from "@/lib/reimbursement/detail-shape";
import { DecisionPanel } from "./decision-panel";
import { Field, HistoryList, ReceiptsField, RequestBanner, WRAP } from "./request-parts";
import { StatusBadge } from "./status-badge";
import { WithdrawDialog } from "./withdraw-dialog";

/**
 * The read-only request page (Copy C5) and, on it, the buttons the viewer's
 * relationship allows (C6). docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * "Component / Page Plan".
 *
 * WHAT IS SHOWN is decided by the database, not here: the member projection has
 * no actor names, payments or notes, and carries the duplicate-receipt flag only
 * for an approver or the treasury team (`duplicateReceipt` is null for the
 * requester). This file renders what it is handed and adds no fact of its own.
 *
 * Wording by audience: the creator and the person being paid read "Sent back to
 * you"; an approver (and the treasury team) read "Sent back". Names appear
 * nowhere on this projection.
 *
 * Which buttons: `viewer.canEdit` (Edit draft / Edit and send again),
 * `viewer.canWithdraw`, `viewer.canDecide` - the database's answers at the moment
 * the page was read; each action re-checks. "Print the form" is offered to every
 * viewer of the request (the print route applies the same viewer rule and prints
 * the requester projection only; Copy C11). Opening this page changes nothing (EC24).
 */

export function RequestDetail({ slug, detail }: { slug: string; detail: MemberDetail }) {
  const relation = detail.viewer.relation;
  const audience = relation === "creator" || relation === "beneficiary" ? "requester" : "staff";
  const approverSide = relation === "seat" || relation === "treasury";
  const payee = detail.payee.name ?? "";
  const group = detail.group?.name ?? "";
  const amount = detail.amountCents === null ? null : formatMoney(detail.amountCents);
  const { canEdit, canWithdraw, canDecide } = detail.viewer;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className={`text-2xl font-semibold ${WRAP}`}>{amount ?? COPY.page.heading}</h1>
          <StatusBadge status={detail.status} audience={audience} />
        </div>
      </div>

      <RequestBanner detail={detail} audience={audience} />

      {relation === "beneficiary" && detail.enteredOnBehalf && (
        <p className="text-base" data-testid="flag-entered-for-you">
          {COPY.detail.enteredForYou}
        </p>
      )}
      {approverSide && detail.enteredOnBehalf && (
        <p className="text-base" data-testid="flag-entered-on-behalf">
          {COPY.detail.enteredOnBehalf}
        </p>
      )}
      {detail.duplicateReceipt === true && (
        <p className="text-base" data-testid="flag-duplicate-receipt">
          {COPY.detail.duplicateReceipt}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row" data-testid="requester-actions">
        {canEdit && (
          <Button asChild className="min-h-11">
            <Link href={`/o/${slug}/reimbursements/${detail.id}/edit`}>
              {detail.status === "draft" ? COPY.detail.buttons.editDraft : COPY.detail.buttons.editAndSendAgain}
            </Link>
          </Button>
        )}
        {canWithdraw && <WithdrawDialog slug={slug} requestId={detail.id} />}
        {/* A plain <a>, never <Link>: the print address is a route handler (a download), and a Link would prefetch it. */}
        <Button asChild variant="outline" className="min-h-11">
          <a href={`/o/${slug}/reimbursements/${detail.id}/print`} data-testid="request-print">
            {COPY.detail.buttons.print}
          </a>
        </Button>
      </div>

      <dl className="space-y-4" data-testid="request-fields">
        {amount && <Field label={COPY.detail.labels.amount}>{amount}</Field>}
        {detail.expenseDate && (
          <Field label={COPY.detail.labels.date}>
            <FormattedDate value={detail.expenseDate} mode="date" />
          </Field>
        )}
        {detail.group && <Field label={COPY.detail.labels.chargedTo}>{detail.group.name}</Field>}
        {detail.category && <Field label={COPY.detail.labels.category}>{detail.category.name}</Field>}
        {payee && <Field label={COPY.detail.labels.payTo}>{payee}</Field>}
        {detail.preApprovedByName && <Field label={COPY.detail.labels.preApprover}>{detail.preApprovedByName}</Field>}
        {detail.purpose && <Field label={COPY.detail.labels.purpose}>{detail.purpose}</Field>}
        <ReceiptsField slug={slug} detail={detail} showClaim={approverSide} />
      </dl>

      {canDecide && (
        <DecisionPanel
          slug={slug}
          requestId={detail.id}
          revision={detail.revision}
          amount={amount ?? ""}
          payee={payee}
          group={group}
        />
      )}

      <HistoryList detail={detail} />
    </div>
  );
}
