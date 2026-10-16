import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import { OFFLINE_METHOD_LABELS, type OfflineMethod } from "@/lib/giving/gift-input";
import type { GiftListRow } from "@/lib/giving/gifts";
import { formatCents } from "@/lib/giving/money";

const ONLINE_METHOD_LABELS: Record<string, string> = {
  card: "Card",
  us_bank_account: "Bank transfer",
  wallet: "Wallet",
};

export function methodLabel(method: string | null, source: "online" | "offline"): string {
  if (!method) return source === "online" ? "Online" : "Offline";
  return OFFLINE_METHOD_LABELS[method as OfflineMethod] ?? ONLINE_METHOD_LABELS[method] ?? method;
}

/** The words a gift's state wears. Never color alone: each is a labeled Badge. */
export function GiftBadges({ gift }: { gift: GiftListRow }) {
  const fullyReversed = gift.reversedCents >= gift.amountCents && gift.amountCents > 0;
  return (
    <>
      {gift.testMode && <Badge variant="outline">Test</Badge>}
      {gift.status === "pending" && <Badge variant="secondary">Pending</Badge>}
      {gift.status === "failed" && <Badge variant="secondary">Failed</Badge>}
      {gift.voided ? (
        <Badge variant="secondary">Voided</Badge>
      ) : fullyReversed ? (
        <Badge variant="secondary">Refunded</Badge>
      ) : gift.reversedCents > 0 ? (
        <Badge variant="secondary">{formatCents(gift.reversedCents)} refunded</Badge>
      ) : null}
    </>
  );
}

/**
 * The gift ledger as a list of cards: one DOM for every width, phone first. Each
 * row is a link to the gift: donor and amount on the first line, then date, fund
 * and method, then the state badges. A server component.
 */
export function GiftsList({ slug, gifts }: { slug: string; gifts: GiftListRow[] }) {
  return (
    <ul className="space-y-2" data-testid="gifts-list">
      {gifts.map((gift) => {
        const struck = gift.voided || gift.reversedCents >= gift.amountCents;
        return (
          <li key={gift.id}>
            <Link
              href={`/o/${slug}/admin/giving/gifts/${gift.id}`}
              className="block rounded-lg border border-border bg-card p-4 text-card-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-base font-medium">{gift.donorName}</p>
                <p className={`shrink-0 text-base font-semibold${struck ? " line-through" : ""}`}>
                  {formatCents(gift.amountCents)}
                </p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                <FormattedDate value={gift.occurredOn} mode="date" /> &middot; {gift.fundName} &middot;{" "}
                {methodLabel(gift.method, gift.source)}
                {gift.checkNumber ? ` #${gift.checkNumber}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
                <GiftBadges gift={gift} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
