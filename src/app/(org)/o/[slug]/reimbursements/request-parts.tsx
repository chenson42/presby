import type { ReactNode } from "react";
import { FormattedDate } from "@/components/shared/formatted-date";
import { COPY } from "@/lib/reimbursement/copy";
import type { RequestDetail } from "@/lib/reimbursement/detail-shape";
import { DateSentence } from "./date-sentence";

/**
 * The pieces of a request page that the member page (`request-detail.tsx`) and
 * the treasurer's page (`admin/reimbursements/[id]/treasury-detail.tsx`) draw
 * the same way - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 Copy C5 and
 * C8. Extracted in Batch 6 so the two pages cannot word the same fact two ways.
 * Server-renderable; every value is rendered as plain text (React escapes it).
 *
 * WHAT IS SHOWN is decided by the database. These components print what they
 * are handed and add no fact of their own; the names in `HistoryList` appear
 * only when the caller passes `showActors`, which only the treasurer's page does
 * (the member projection carries no `actorName` at all).
 */

/** Wrap anywhere: one unbroken string must not push a 360 px page sideways (EC39). */
export const WRAP = "[overflow-wrap:anywhere]";

export function Field({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-base ${WRAP}`}>{children}</dd>
    </div>
  );
}

/** The status sentence of Copy C5: requester wording, or "Sent back" without "to you" for approvers and staff. */
export function RequestBanner({ detail, audience }: { detail: RequestDetail; audience: "requester" | "staff" }) {
  const reason = detail.latestReason ?? "";
  let body: ReactNode;
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

/** The receipt links (plain `<a>`: the download is a route handler, not a page) and the two receipt facts. */
export function ReceiptsField({
  slug,
  detail,
  showClaim,
}: {
  slug: string;
  detail: RequestDetail;
  /** Approvers and the treasury team see that the requester could not attach one. */
  showClaim: boolean;
}) {
  return (
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
      {showClaim && detail.noReceiptClaimed && (
        <span className="mt-1 block text-sm text-muted-foreground">{COPY.detail.noReceiptClaimed}</span>
      )}
      {detail.receiptWaived && <span className="mt-1 block text-sm text-muted-foreground">{COPY.detail.receiptWaived}</span>}
    </Field>
  );
}

/** The event list in Copy C5's labels, a date after each; a name only when `showActors` (treasury level). */
export function HistoryList({ detail, showActors = false }: { detail: RequestDetail; showActors?: boolean }) {
  if (detail.history.length === 0) return null;
  return (
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
            {showActors && event.actorName && (
              <span className={`text-muted-foreground ${WRAP}`} data-testid="history-actor">
                {" "}
                {event.actorName}
              </span>
            )}
            {event.note && <span className={`mt-0.5 block text-sm text-muted-foreground ${WRAP}`}>{event.note}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
