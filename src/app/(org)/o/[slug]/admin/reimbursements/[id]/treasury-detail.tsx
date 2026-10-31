import Link from "next/link";
import { FormattedDate } from "@/components/shared/formatted-date";
import { formatMoney } from "@/lib/reimbursement/amount-input";
import { COPY } from "@/lib/reimbursement/copy";
import type { TreasuryDetail } from "@/lib/reimbursement/detail-shape";
import { DateSentence } from "../../../reimbursements/date-sentence";
import { Field, HistoryList, ReceiptsField, RequestBanner, WRAP } from "../../../reimbursements/request-parts";
import { StatusBadge } from "../../../reimbursements/status-badge";
import { PaymentForm } from "./payment-form";
import { TreasuryVerbs } from "./treasury-verbs";
import { treasuryUi } from "./treasury-ui";

/**
 * The treasurer's request page - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * "Component / Page Plan" and Copy C5 and C8. The same facts as the requester's
 * page in the same words (`request-parts.tsx`), plus what only the treasury
 * team may read: who approved it and on which path, the payments (method,
 * reference, date, who recorded it, and a note when the person who entered or is
 * paid by the request recorded it), who did what in the history, and the earlier
 * request a receipt also appeared on.
 *
 * Then the work: the payment area (the form, or the Copy sentence for why there
 * is none), and the verbs. WHAT IS OFFERED is `treasuryUi`'s answer from the
 * detail alone; the definers decide again on every click. Server component; the
 * form and the dialogs are the client islands. No receipts are uploaded here:
 * the links go to the same download route as the member page.
 */

const LINK =
  "underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function TreasuryRequestDetail({
  slug,
  detail,
  orgToday,
}: {
  slug: string;
  detail: TreasuryDetail;
  orgToday: string;
}) {
  const ui = treasuryUi(detail);
  const amount = detail.amountCents === null ? null : formatMoney(detail.amountCents);
  const payee = detail.payee.name ?? "";
  const hasVerb = ui.override || ui.reverse || ui.waive || ui.sendBack !== null || ui.void || ui.note;
  const approval = detail.approval;

  return (
    <div className="max-w-2xl space-y-6" data-testid="treasury-detail">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className={`text-2xl font-semibold ${WRAP}`}>{amount ?? COPY.page.heading}</h1>
        <StatusBadge status={detail.status} audience="staff" />
      </div>

      <RequestBanner detail={detail} audience="staff" />

      {detail.enteredOnBehalf && (
        <p className="text-base" data-testid="flag-entered-on-behalf">
          {COPY.detail.enteredOnBehalf}
        </p>
      )}
      {detail.duplicateReceipt === true && (
        <p className="text-base" data-testid="flag-duplicate-receipt">
          {COPY.detail.duplicateReceipt}
          {detail.duplicateRequestIds.map((id) => (
            <span key={id}>
              {" "}
              <Link href={`/o/${slug}/admin/reimbursements/${id}`} className={LINK}>
                {COPY.detail.viewDuplicate}
              </Link>
            </span>
          ))}
        </p>
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
        <ReceiptsField slug={slug} detail={detail} showClaim />
      </dl>

      {approval && approval.byName && (
        <p className={`text-base ${WRAP}`} data-testid="approved-by">
          <DateSentence
            make={(date) => COPY.treasury.extras.approvedBy(approval.byName ?? "", date, approval.path === "override")}
            date={approval.at}
          />
        </p>
      )}

      {detail.payments.length > 0 && (
        <section aria-labelledby="payments-heading" data-testid="payments">
          <h2 id="payments-heading" className="text-xl font-semibold">
            {COPY.detail.history.payment_recorded}
          </h2>
          <ul className="mt-2 space-y-3">
            {detail.payments.map((payment) => (
              <li key={payment.id} className="text-base" data-testid="payment-row" data-kind={payment.kind}>
                <p>
                  <span className="font-medium">
                    {payment.kind === "payment" ? COPY.detail.history.payment_recorded : COPY.detail.history.payment_reversed}
                  </span>{" "}
                  {payment.method && <span>{COPY.treasury.paymentForm.methods[payment.method]}</span>}{" "}
                  {payment.paidOn && (
                    <span className="text-muted-foreground">
                      <FormattedDate value={payment.paidOn} mode="date" />
                    </span>
                  )}
                  {payment.kind === "payment" && <span className="ml-2 tabular-nums">{formatMoney(payment.amountCents)}</span>}
                </p>
                {(payment.reference || payment.byName) && (
                  <p className={`text-sm text-muted-foreground ${WRAP}`}>
                    {payment.reference &&
                      (payment.method === "check" ? `${COPY.treasury.paymentForm.checkNumber} ${payment.reference}` : payment.reference)}
                    {payment.reference && payment.byName ? " " : ""}
                    {payment.byName}
                  </p>
                )}
                {payment.selfPaid && <p className="text-sm">{COPY.treasury.extras.selfPaid}</p>}
                {(payment.note || payment.reason) && (
                  <p className={`text-sm text-muted-foreground ${WRAP}`}>{payment.reason ?? payment.note}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ui.payment.kind !== "none" && (
        <section aria-labelledby="pay-heading" className="space-y-3" data-testid="payment-area">
          <h2 id="pay-heading" className="text-xl font-semibold">
            {COPY.treasury.buttons.recordPayment}
          </h2>
          {ui.payment.kind === "block" ? (
            <p className="text-base" data-testid="payment-block">
              {ui.payment.message}
            </p>
          ) : (
            <PaymentForm slug={slug} requestId={detail.id} orgToday={orgToday} expenseDate={detail.expenseDate} />
          )}
        </section>
      )}

      {hasVerb && (
        <TreasuryVerbs
          slug={slug}
          requestId={detail.id}
          revision={detail.revision}
          group={detail.group?.name ?? ""}
          ui={ui}
        />
      )}

      <HistoryList detail={detail} showActors />
    </div>
  );
}
