import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import { commissionAboutLine, servingLine } from "@/lib/committees/copy";
import { groupCommissions } from "@/lib/committees/derive";
import type { CommissionList, CommissionListRow } from "@/lib/committees/reads";
import { COMMISSIONS } from "@/lib/committees/ui-copy";
import { LINK_CLASSES } from "./committee-card";
import { GuidedEmpty } from "./committee-states";

export const commissionHref = (slug: string, id: string) => `/o/${slug}/admin/committees/commissions/${id}`;

/** "Active", or "Ended {date}": the record's state as a badge. */
function StatusBadge({ row }: { row: CommissionListRow }) {
  if (row.endedOn === null) return <Badge variant="secondary">{COMMISSIONS.active}</Badge>;
  return (
    <Badge variant="outline">
      {COMMISSIONS.ended} <FormattedDate value={row.endedOn} mode="date" />
    </Badge>
  );
}

/** One commission as a card (below `sm`): title as the link, congregation, appointed, status, how many serve. */
function CommissionCard({ slug, row }: { slug: string; row: CommissionListRow }) {
  return (
    <li className="space-y-1 rounded-lg border border-border p-3">
      <Link href={commissionHref(slug, row.id)} className={LINK_CLASSES}>
        <span className="min-w-0 [overflow-wrap:anywhere]">{row.title}</span>
      </Link>
      <p className="text-sm [overflow-wrap:anywhere]">{commissionAboutLine(row.congregationName, true)}</p>
      <p className="text-sm text-muted-foreground">
        {COMMISSIONS.appointedPrefix} <FormattedDate value={row.appointedOn} mode="date" />
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge row={row} />
        {row.endedOn === null ? <span className="text-sm text-muted-foreground">{servingLine(row.servingCount)}</span> : null}
      </div>
    </li>
  );
}

function CommissionRows({ slug, rows }: { slug: string; rows: readonly CommissionListRow[] }) {
  return (
    <>
      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <CommissionCard key={row.id} slug={slug} row={row} />
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{COMMISSIONS.tableHead.title}</TableHead>
              <TableHead>{COMMISSIONS.tableHead.congregation}</TableHead>
              <TableHead>{COMMISSIONS.tableHead.appointed}</TableHead>
              <TableHead>{COMMISSIONS.tableHead.status}</TableHead>
              <TableHead>{COMMISSIONS.tableHead.serving}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-xs whitespace-normal font-medium">
                  <Link href={commissionHref(slug, row.id)} className={`${LINK_CLASSES} [overflow-wrap:anywhere]`}>
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-normal [overflow-wrap:anywhere]">{commissionAboutLine(row.congregationName, true)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <FormattedDate value={row.appointedOn} mode="date" />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <StatusBadge row={row} />
                </TableCell>
                <TableCell className="text-muted-foreground">{row.endedOn === null ? servingLine(row.servingCount) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/**
 * The "Administrative commissions" section of the list (C15): the active records,
 * newest appointed first, then (on request, `?show=ended`) the ended ones. No charge is
 * ever shown here (the reader does not carry it). Its own empty state when nothing is
 * recorded at all; when only ended ones exist the section still offers "Record a
 * commission" and the "Show ended commissions" link.
 */
export function CommissionsSection({
  list,
  slug,
  toggleHref,
}: {
  list: CommissionList;
  slug: string;
  /** The page's own static path with `?show=ended` kept or dropped (the other list's toggle is preserved by the caller). */
  toggleHref: string;
}) {
  const sections = groupCommissions(list.commissions);
  const rows = list.showEnded ? [...sections.active, ...sections.ended] : sections.active;
  const recordHref = `/o/${slug}/admin/committees/commissions/new`;
  const nothingRecorded = sections.active.length === 0 && list.endedCount === 0;
  return (
    <section aria-labelledby="commissions-heading" className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="commissions-heading" className="text-lg font-semibold">
            {COMMISSIONS.heading}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{COMMISSIONS.intro}</p>
        </div>
        {nothingRecorded ? null : (
          <Button asChild variant="outline" className="min-h-11 shrink-0">
            <Link href={recordHref}>{COMMISSIONS.record}</Link>
          </Button>
        )}
      </div>
      {nothingRecorded ? (
        <GuidedEmpty title={COMMISSIONS.emptyTitle}>
          <Button asChild className="mt-4 min-h-11">
            <Link href={recordHref}>{COMMISSIONS.record}</Link>
          </Button>
        </GuidedEmpty>
      ) : null}
      {rows.length > 0 ? <CommissionRows slug={slug} rows={rows} /> : null}
      {list.endedCount > 0 ? (
        <p>
          <Link
            href={toggleHref}
            className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {list.showEnded ? COMMISSIONS.hideEnded : COMMISSIONS.showEnded(list.endedCount)}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
