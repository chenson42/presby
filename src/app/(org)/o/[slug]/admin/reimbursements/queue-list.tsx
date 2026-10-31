import Link from "next/link";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/reimbursement/amount-input";
import { COPY } from "@/lib/reimbursement/copy";
import type { TreasurerListItem } from "@/lib/reimbursement/reads";
import { DateSentence } from "../../reimbursements/date-sentence";
import { StatusBadge } from "../../reimbursements/status-badge";

/**
 * The queue's rows (Copy C7): payee, amount, `Charged to`, `Approved {date}` or
 * `Sent {date}`, status, and the `Entered on someone's behalf` badge. Cards, each
 * ONE link to the request, at every width (a table at 360 px was the Lions
 * treasury's off-screen button, and Copy supplies no column headers, so a table
 * would carry unlabeled columns); from `md` the card spreads into columns. Names
 * and purposes wrap anywhere so one unbroken string cannot push the page sideways
 * (EC39). Each card is at least 44 px tall. Nothing here is an action: opening a
 * request is a GET that changes nothing. Server component.
 */

const WRAP = "[overflow-wrap:anywhere]";
const CARD =
  "block min-h-11 rounded-lg border border-border bg-card p-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function QueueList({ slug, items }: { slug: string; items: TreasurerListItem[] }) {
  return (
    <ul className="space-y-3" data-testid="queue-rows">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`/o/${slug}/admin/reimbursements/${item.id}`} className={CARD} data-testid="queue-row">
            <div className="md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)] md:items-start md:gap-4">
              <div className="flex items-start justify-between gap-3 md:block">
                <p className={`min-w-0 font-medium ${WRAP}`}>{item.payeeLabel ?? item.groupName}</p>
                <p className="shrink-0 font-medium tabular-nums md:mt-1">
                  {item.amountCents === null ? "" : formatMoney(item.amountCents)}
                </p>
              </div>
              <p className={`mt-2 text-sm text-muted-foreground md:mt-0 ${WRAP}`}>
                {COPY.queue.chargedTo} <span className="text-foreground">{item.groupName}</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground md:mt-0">
                <StatusBadge status={item.status} audience="staff" />
                {item.approvedAt ? (
                  <span>
                    <DateSentence make={COPY.queue.approvedOn} date={item.approvedAt} />
                  </span>
                ) : item.submittedAt ? (
                  <span>
                    <DateSentence make={COPY.queue.sentOn} date={item.submittedAt} />
                  </span>
                ) : item.expenseDate ? (
                  <FormattedDate value={item.expenseDate} mode="date" />
                ) : null}
                {item.enteredOnBehalf && <Badge variant="outline" className="text-sm">{COPY.queue.enteredOnBehalfBadge}</Badge>}
              </div>
            </div>
            {item.purposeExcerpt && <p className={`mt-2 text-sm text-muted-foreground ${WRAP}`}>{item.purposeExcerpt}</p>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
