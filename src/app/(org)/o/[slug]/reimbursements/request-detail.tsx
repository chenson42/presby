import Link from "next/link";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/reimbursement/amount-input";
import { COPY } from "@/lib/reimbursement/copy";
import type { MemberDetail } from "@/lib/reimbursement/detail-shape";
import { DateSentence } from "./date-sentence";
import { DecisionPanel } from "./decision-panel";
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
 * the page was read; each action re-checks. "Print the form" is Batch 7's route
 * and is not offered yet. Opening this page changes nothing (EC24).
 */

const WRAP = "[overflow-wrap:anywhere]";

function Field({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-base ${WRAP}`}>{children}</dd>
    </div>
  );
}

function Banner({ detail, audience }: { detail: MemberDetail; audience: "requester" | "staff" }) {
  const reason = detail.latestReason ?? "";
  let body: React.ReactNode;
  switch (detail.status) {
    case "draft":
      body = COPY.detail.banner.draft;
      break;
    case "submitted":
      body = COPY.detail.banner.submitted[detail.route ?? "seat"];
      break;
    case "returned":
      body = COPY.detail.banner.returned(reason, audience);
      break;
    case "not_approved":
      body = COPY.detail.banner.notApproved(reason);
      break;
    case "approved":
      body = <DateSentence make={COPY.detail.banner.approved} date={detail.approvedOn} />;
      break;
    case "paid":
      body = <DateSentence make={COPY.detail.banner.paid} date={detail.paidOn} />;
      break;
    case "withdrawn":
      body = COPY.detail.banner.withdrawn;
      break;
    case "voided":
      body = COPY.detail.banner.voided;
      break;
  }
  return (
    <p role="status" data-testid="request-banner" className={`rounded-lg border border-border bg-muted p-3 text-base ${WRAP}`}>
      {body}
    </p>
  );
}

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

      <Banner detail={detail} audience={audience} />

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

      {(canEdit || canWithdraw) && (
        <div className="flex flex-col gap-2 sm:flex-row" data-testid="requester-actions">
          {canEdit && (
            <Button asChild className="min-h-11">
              <Link href={`/o/${slug}/reimbursements/${detail.id}/edit`}>
                {detail.status === "draft" ? COPY.detail.buttons.editDraft : COPY.detail.buttons.editAndSendAgain}
              </Link>
            </Button>
          )}
          {canWithdraw && <WithdrawDialog slug={slug} requestId={detail.id} />}
        </div>
      )}

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
        <Field label={COPY.detail.labels.receipts} testId="request-receipts">
          {detail.receipts.length === 0 ? (
            COPY.receipts.none
          ) : (
            <ul className="space-y-1">
              {detail.receipts.map((receipt) => (
                <li key={receipt.id}>
                  <a
                    href={`/o/${slug}/reimbursements/${detail.id}/receipts/${receipt.id}`}
                    className="inline-flex min-h-11 items-center underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {receipt.displayName}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {approverSide && detail.noReceiptClaimed && (
            <span className="mt-1 block text-sm text-muted-foreground">{COPY.detail.noReceiptClaimed}</span>
          )}
          {detail.receiptWaived && <span className="mt-1 block text-sm text-muted-foreground">{COPY.detail.receiptWaived}</span>}
        </Field>
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

      {detail.history.length > 0 && (
        <section aria-labelledby="history-heading" data-testid="request-history">
          <h2 id="history-heading" className="text-xl font-semibold">
            {COPY.detail.labels.history}
          </h2>
          <ol className="mt-2 space-y-3">
            {detail.history.map((event, index) => (
              <li key={`${event.at}-${index}`} className="text-base">
                <span className="font-medium">{COPY.detail.history[event.kind]}</span>{" "}
                <span className="text-muted-foreground">
                  <FormattedDate value={event.on} mode="date" />
                </span>
                {event.note && <span className={`mt-0.5 block text-sm text-muted-foreground ${WRAP}`}>{event.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
