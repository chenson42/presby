import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { IngestHealthRow } from "@/lib/admin/giving-ingest-health";
import { formatAge } from "@/lib/admin/format-age";

/**
 * `/admin/organizations/<id>`'s payment-notice health section - docs/work-log/
 * 2026-10-15-online-giving.md, Batch 3b. For ONE congregation: per Stripe
 * connection, how many notices arrived, were applied, are waiting and were
 * given up on, with a link to the platform page where dead letters are
 * requeued. COUNTS ONLY - no donor, amount or event body exists in the data
 * this receives, and no connection's identifying account id is shown.
 *
 * `page.tsx` renders it only for the organization types giving applies to, and
 * reads the rows through `src/lib/admin/giving-ingest-health.ts`. `rows` is
 * `null` when that read failed: an honest "can't load" line, never an empty
 * list that would read as "all clear". Platform palette; a server component.
 */
export function IngestHealthSection({
  rows,
}: {
  /** This organization's connections (newest history included), or `null` if the read failed. */
  rows: IngestHealthRow[] | null;
}) {
  const dead = rows?.reduce((n, r) => n + r.deadLetterCount, 0) ?? 0;

  return (
    <section data-testid="ingest-health-section" className="mt-8 rounded-lg border border-border bg-muted/40 px-4 py-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Payment notices</h2>

      {rows === null ? (
        <p className="mt-1 text-sm text-foreground">
          We can&apos;t load this organization&apos;s payment-notice health right now. Reload the page in a moment.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          This organization has no Stripe connection yet, so no payment notices have arrived.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            What Stripe has told presby about this congregation&apos;s gifts. Counts only.
            {dead > 0 ? (
              <>
                {" "}
                <span className="font-semibold text-foreground">
                  {dead} {dead === 1 ? "event has" : "events have"} been given up on.
                </span>
              </>
            ) : null}
          </p>
          <ul className="mt-3 space-y-3">
            {rows.map((row) => (
              <li key={row.connectionId} className="rounded-md border border-border bg-background p-3" data-testid="ingest-health-connection">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{row.livemode ? "Live" : "Test"}</Badge>
                  <span className="text-sm font-medium capitalize">{row.status}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Received</dt>
                    <dd className="tabular-nums">{row.receivedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Applied</dt>
                    <dd className="tabular-nums">{row.appliedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Waiting</dt>
                    <dd className="tabular-nums">{row.parkedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Dead letters</dt>
                    <dd className={`tabular-nums ${row.deadLetterCount > 0 ? "font-semibold" : ""}`}>{row.deadLetterCount}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-sm text-muted-foreground">
                  Last notice:{" "}
                  {row.lastReceivedAt ? <FormattedDate value={row.lastReceivedAt} mode="datetime" /> : "never"}. Oldest
                  waiting: {formatAge(row.oldestPendingSeconds)}.
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link href="/admin/giving" className="mt-3 inline-flex min-h-11 items-center text-sm underline">
        Open giving health
      </Link>
    </section>
  );
}
