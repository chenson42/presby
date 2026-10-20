import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import { giftStatusLabel, MEMBER_GIVING } from "@/lib/giving/giving-copy";
import { formatCents } from "@/lib/giving/money";
import type { MyGift } from "@/lib/giving/self";

/**
 * "Your gifts": the member's own linked gifts as cards - one DOM for every
 * width, phone first (docs/work-log/2026-10-15-online-giving.md, Flow 12).
 * Date, fund, amount, then the words the gift's state wears (never colour
 * alone). A refunded gift's amount is struck through and the badge says what
 * happened; a partial refund says so without striking. Nothing here is a donor
 * name, a method, a fee or a recorder: `self.ts` does not return them. A server
 * component with no hooks.
 */
export function HistoryList({ gifts, truncated }: { gifts: MyGift[]; truncated: boolean }) {
  if (gifts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center" data-testid="gifts-empty">
        <p className="text-sm font-medium">{MEMBER_GIVING.giftsEmptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{MEMBER_GIVING.giftsEmptyBody}</p>
      </div>
    );
  }
  const anyPending = gifts.some((g) => g.status === "pending");
  return (
    <div className="space-y-3">
      <ul className="space-y-2" data-testid="gifts-list">
        {gifts.map((gift) => {
          const label = giftStatusLabel(gift.status, gift.amountCents, gift.reversedCents);
          const struck = gift.status === "succeeded" && gift.reversedCents >= gift.amountCents;
          return (
            <li
              key={gift.id}
              className="rounded-lg border border-border bg-card p-4 text-card-foreground"
              data-testid="gift-row"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-base font-medium">{gift.fundName}</p>
                <p className={`shrink-0 text-base font-semibold${struck ? " line-through" : ""}`}>
                  {formatCents(gift.amountCents)}
                </p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                <FormattedDate value={gift.occurredOn} mode="date" />
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={label === "Received" ? "outline" : "secondary"}>{label}</Badge>
                {gift.status === "succeeded" && gift.reversedCents > 0 && gift.reversedCents < gift.amountCents && (
                  <span className="text-sm text-muted-foreground">{formatCents(gift.reversedCents)} returned</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {truncated && (
        <p className="text-sm text-muted-foreground" data-testid="gifts-truncated">
          {MEMBER_GIVING.giftsTruncated(gifts.length)}
        </p>
      )}
      {anyPending && <p className="text-sm text-muted-foreground">{MEMBER_GIVING.pendingNote}</p>}
    </div>
  );
}
