import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import { OFFLINE_METHOD_LABELS, type OfflineMethod } from "@/lib/giving/gift-input";
import type { OwnEntryRow } from "@/lib/giving/gifts";
import { formatCents } from "@/lib/giving/money";
import { VoidGiftDialog } from "./void-dialog";

/**
 * "Your recent entries" - the S4 recorder variant of the gifts page: the
 * gifts THIS person recorded in the last 30 days, with a void button on each
 * live one. No donor contact detail, no totals, no one else's entries. Empty
 * state names the one action that fills it. A server component; the void
 * button is the only client piece.
 */
export function RecentEntries({
  slug,
  entries,
  canRecord,
}: {
  slug: string;
  entries: OwnEntryRow[];
  canRecord: boolean;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center">
        <p className="text-sm font-medium">You haven&apos;t recorded any gifts in the last 30 days</p>
        <p className="mx-auto mt-1 max-w-md px-4 text-sm text-muted-foreground">
          Gifts you record show up here for 30 days, so you can check your work or void a mistake.
        </p>
        {canRecord && (
          <Link
            href={`/o/${slug}/admin/giving/gifts/new`}
            className="mt-4 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Record a gift
          </Link>
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="recent-entries">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg border border-border bg-card p-4 text-card-foreground">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-base font-medium">{entry.donorName}</p>
              <p className="text-sm text-muted-foreground">
                <FormattedDate value={entry.occurredOn} mode="date" /> &middot; {entry.fundName}
                {entry.method ? ` · ${OFFLINE_METHOD_LABELS[entry.method as OfflineMethod] ?? entry.method}` : ""}
              </p>
            </div>
            <p className="text-base font-semibold">{formatCents(entry.amountCents)}</p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {entry.voided && <Badge variant="secondary">Voided</Badge>}
            {entry.canVoid && (
              <VoidGiftDialog
                slug={slug}
                giftId={entry.id}
                amountCents={entry.amountCents}
                donorName={entry.donorName}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
