import { employmentTypeLabel, formatPay, type PublicPostingSummary } from "@/lib/careers/contract";
import { formatLongDate } from "@/lib/calendar/month";

/**
 * The facts line of an opening: type, location, pay, posted and closing dates
 * (Copy P4, P9). Dates are bare 'YYYY-MM-DD' keys formatted from static name
 * tables - no `Date`, no locale, no zone (`formatLongDate`). Used by the list's
 * cards and by the posting page, so the two read the same.
 */
export function PostingMeta({
  posting,
}: {
  posting: Pick<
    PublicPostingSummary,
    "employmentType" | "location" | "payMinCents" | "payMaxCents" | "payUnit" | "postedOn" | "closingDate"
  >;
}) {
  const pay = formatPay(posting.payMinCents, posting.payMaxCents, posting.payUnit);
  return (
    <ul className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-4">
      <li>{employmentTypeLabel(posting.employmentType)}</li>
      {posting.location !== "" && <li className="[overflow-wrap:anywhere]">{posting.location}</li>}
      {pay !== null && <li>{pay}</li>}
      <li>
        Posted <time dateTime={posting.postedOn}>{formatLongDate(posting.postedOn)}</time>
      </li>
      {posting.closingDate !== null && (
        <li>
          Closing date: <time dateTime={posting.closingDate}>{formatLongDate(posting.closingDate)}</time>
        </li>
      )}
    </ul>
  );
}
