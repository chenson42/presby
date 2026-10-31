import Link from "next/link";
import { COPY } from "@/lib/reimbursement/copy";
import { formatMoney } from "@/lib/reimbursement/amount-input";
import type { RequestListItem, WaitingItem } from "@/lib/reimbursement/reads";
import { DateSentence } from "./date-sentence";
import { StatusBadge } from "./status-badge";
import { FormattedDate } from "@/components/shared/formatted-date";

/**
 * The two member lists on `/o/<slug>/reimbursements` (Copy C2): "Waiting for your
 * approval" and "Your requests". Cards at every width - a table at 360 px was the
 * Lions treasury's off-screen Approve button - each one a single link to the
 * request, at least 44 px tall. Long names and purposes wrap anywhere
 * (`[overflow-wrap:anywhere]`) so one unbroken string cannot push the page
 * sideways (EC39). Server components.
 *
 * Nothing here is an action: opening a request is a GET that changes nothing.
 */

const CARD =
  "block min-h-11 rounded-lg border border-border bg-card p-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const WRAP = "[overflow-wrap:anywhere]";

function Money({ cents }: { cents: number | null }) {
  return <span className="shrink-0 font-medium tabular-nums">{cents === null ? "" : formatMoney(cents)}</span>;
}

export function MyRequestsList({ slug, items }: { slug: string; items: RequestListItem[] }) {
  return (
    <ul className="space-y-3" data-testid="my-requests">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`/o/${slug}/reimbursements/${item.id}`} className={CARD} data-testid="request-row">
            <div className="flex items-start justify-between gap-3">
              <p className={`min-w-0 font-medium ${WRAP}`}>{item.payeeLabel ?? item.groupName}</p>
              <Money cents={item.amountCents} />
            </div>
            {item.purposeExcerpt && <p className={`mt-1 text-sm text-muted-foreground ${WRAP}`}>{item.purposeExcerpt}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <StatusBadge status={item.status} />
              {item.payeeLabel && <span className={WRAP}>{item.groupName}</span>}
              {item.expenseDate && <FormattedDate value={item.expenseDate} mode="date" />}
            </div>
            {item.enteredOnBehalf && (
              <p className="mt-2 text-sm text-muted-foreground">
                {item.isCreator ? COPY.detail.enteredOnBehalf : COPY.detail.enteredForYou}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function WaitingList({ slug, items }: { slug: string; items: WaitingItem[] }) {
  return (
    <ul className="space-y-3" data-testid="waiting-requests">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`/o/${slug}/reimbursements/${item.id}`} className={CARD} data-testid="waiting-row">
            <div className="flex items-start justify-between gap-3">
              <p className={`min-w-0 font-medium ${WRAP}`}>{item.payeeLabel ?? item.groupName}</p>
              <Money cents={item.amountCents} />
            </div>
            {item.purposeExcerpt && <p className={`mt-1 text-sm text-muted-foreground ${WRAP}`}>{item.purposeExcerpt}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {item.payeeLabel && <span className={WRAP}>{item.groupName}</span>}
              {item.submittedAt && (
                <span>
                  <DateSentence make={COPY.queue.sentOn} date={item.submittedAt} />
                </span>
              )}
            </div>
            {item.enteredOnBehalf && <p className="mt-2 text-sm text-muted-foreground">{COPY.detail.enteredOnBehalf}</p>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
