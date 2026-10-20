import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { IngestHealthRow } from "@/lib/admin/giving-ingest-health";
import { formatAge } from "@/lib/admin/format-age";

/**
 * One row per Stripe connection: how many payment notices arrived, were
 * applied, are waiting, were given up on, when the last one came and how long
 * the oldest unfinished one has waited - docs/work-log/2026-10-15-online-
 * giving.md, Batch 3b (P3-6). COUNTS AND TIMES ONLY: the database function that
 * feeds it cannot return a body, an amount or a donor. Organization names come
 * from the public `organizations` table through the page.
 *
 * Platform palette; a real `<table>` inside the shared `Table` scroller (it
 * scrolls on a phone, with the page itself never scrolling sideways). Status
 * and mode are words, and a non-zero dead-letter count is bold text, not just
 * a colour.
 */
export function IngestHealthTable({
  rows,
  names,
}: {
  rows: IngestHealthRow[];
  names: ReadonlyMap<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-10 text-center" data-testid="ingest-health-empty">
        <p className="text-sm font-medium">No Stripe connections yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A congregation shows up here once it starts connecting Stripe and its first payment notice arrives.
        </p>
      </div>
    );
  }

  return (
    <Table data-testid="ingest-health-table">
      <caption className="sr-only">Payment notice health for each Stripe connection</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Organization</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Applied</TableHead>
          <TableHead className="text-right">Waiting</TableHead>
          <TableHead className="text-right">Dead letters</TableHead>
          <TableHead>Last notice</TableHead>
          <TableHead>Oldest waiting</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.connectionId} data-testid="ingest-health-row">
            <TableCell className="font-medium">
              <Link href={`/admin/organizations/${row.organizationId}`} className="underline">
                {names.get(row.organizationId) ?? "Unknown organization"}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{row.livemode ? "Live" : "Test"}</Badge>
            </TableCell>
            <TableCell className="capitalize">{row.status}</TableCell>
            <TableCell className="text-right tabular-nums">{row.receivedCount}</TableCell>
            <TableCell className="text-right tabular-nums">{row.appliedCount}</TableCell>
            <TableCell className="text-right tabular-nums">{row.parkedCount}</TableCell>
            <TableCell
              className={`text-right tabular-nums ${row.deadLetterCount > 0 ? "font-semibold" : ""}`}
              data-testid="dead-letter-count"
            >
              {row.deadLetterCount}
            </TableCell>
            <TableCell>
              {row.lastReceivedAt ? <FormattedDate value={row.lastReceivedAt} mode="datetime" /> : "Never"}
            </TableCell>
            <TableCell>{formatAge(row.oldestPendingSeconds)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
