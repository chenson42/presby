import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { type Attention, attentionIsClear } from "@/lib/giving/attention-pure";

/**
 * "Needs attention" on the giving overview - docs/work-log/
 * 2026-10-15-online-giving.md, S5. A server component over `loadAttention()`'s
 * result and NOTHING else: every number it shows is a field of `Attention`, so
 * the page cannot drift from the one definition of what needs a human.
 *
 * Counts only, in plain language, each with where to act. A recorder
 * (`scope: "recorder"`) sees at most the link-suggestions line; every other
 * field is `null` for them and renders nothing. Color is never the signal: each
 * row has an icon and words. Empty state: one sentence saying all is well.
 */

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

interface Row {
  key: string;
  text: string;
  href?: string;
  linkLabel?: string;
}

export function attentionRows(a: Attention, slug: string): Row[] {
  const base = `/o/${slug}/admin/giving`;
  const rows: Row[] = [];
  const n = (v: number | null) => v ?? 0;

  if (a.connection && a.connection.state === "restricted") {
    rows.push({
      key: "restricted",
      text: "Your Stripe account needs attention before it can take gifts.",
    });
  } else if (a.connection && a.connection.requirementsDue && a.connection.state !== "disconnected") {
    rows.push({ key: "requirements", text: "Stripe is waiting on more information from your account." });
  }
  if (n(a.failedGifts) > 0) {
    rows.push({
      key: "failed",
      text: `${a.failedGifts} ${plural(a.failedGifts!, "gift has", "gifts have")} failed in the last 90 days.`,
      href: `${base}/gifts?status=failed`,
      linkLabel: "Review failed gifts",
    });
  }
  if (n(a.stuckPending) > 0) {
    rows.push({
      key: "pending",
      text: `${a.stuckPending} ${plural(a.stuckPending!, "bank gift has", "bank gifts have")} been pending for more than a week.`,
      href: `${base}/gifts?status=pending`,
      linkLabel: "Review pending gifts",
    });
  }
  if (n(a.monthlyPaymentFailures) > 0) {
    rows.push({
      key: "monthly",
      text: `${a.monthlyPaymentFailures} ${plural(a.monthlyPaymentFailures!, "monthly gift's", "monthly gifts'")} latest payment failed. Stripe will retry; the donor may need to update their card.`,
    });
  }
  if (n(a.deadLetters) > 0) {
    rows.push({
      key: "dead",
      text: `${a.deadLetters} ${plural(a.deadLetters!, "payment notice", "payment notices")} from Stripe could not be processed. Contact support.`,
    });
  }
  if (n(a.parkedEvents) > 0) {
    rows.push({
      key: "parked",
      text: `${a.parkedEvents} ${plural(a.parkedEvents!, "payment notice is", "payment notices are")} waiting for related information and will be retried.`,
    });
  }
  if (n(a.staleStatements) > 0) {
    rows.push({
      key: "stale",
      text: `${a.staleStatements} ${plural(a.staleStatements!, "statement is", "statements are")} out of date because a gift changed after it was issued.`,
      href: `${base}/statements`,
      linkLabel: "Review statements",
    });
  }
  if (n(a.possibleDuplicateDonors) > 0) {
    rows.push({
      key: "dupes",
      text: `${a.possibleDuplicateDonors} ${plural(a.possibleDuplicateDonors!, "pair of donors looks", "pairs of donors look")} like the same giver.`,
      href: `${base}/donors`,
      linkLabel: "Review donors",
    });
  }
  if (a.linkProposals > 0) {
    rows.push({
      key: "links",
      text: `${a.linkProposals} ${plural(a.linkProposals, "donor looks", "donors look")} like a member (same email on file).`,
      href: `${base}/donors`,
      linkLabel: "Review suggestions",
    });
  }
  return rows;
}

export function AttentionList({ attention, slug }: { attention: Attention; slug: string }) {
  const rows = attentionRows(attention, slug);

  if (attentionIsClear(attention) || rows.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-border p-4">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">Nothing needs attention</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Failed payments, waiting notices and donor suggestions will show up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="attention-list">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm">{row.text}</p>
            {row.href && (
              <Link
                href={row.href}
                className="mt-1 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {row.linkLabel}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
