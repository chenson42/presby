import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { StaffPositionEntry } from "@/lib/staff";
import { EndPositionDialog } from "./end-position-dialog";

/**
 * "Who currently holds a staff position" — a `Table`, not cards, same
 * mobile-legibility rationale `admin/officers/officer-roster.tsx`'s header
 * documents (position / person / department / since / ends / actions is
 * genuinely wide-column data).
 *
 * The `Department` column ONLY renders when at least one row carries one —
 * same conditional-column rationale as officers' `District` column; most
 * congregations won't populate it for every position, and a column of solid
 * em dashes is worse than no column.
 *
 * `Department` and (once verified live) other secondary columns drop below
 * `sm:` on a phone viewport, mirroring `officer-roster.tsx`'s own verified
 * 360px finding — Position/Person/Since/Ends/Actions is the always-visible
 * set that must reach the "End position" action without horizontal scroll.
 *
 * A Server Component (read-only data) — embeds `<EndPositionDialog>` (a
 * client component) per row without itself needing `'use client'`.
 */
export function StaffRoster({
  entries,
  slug,
}: {
  entries: StaffPositionEntry[];
  slug: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No staff positions recorded yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the form below to add the first one.
        </p>
      </div>
    );
  }

  const hasDepartment = entries.some((entry) => entry.department !== null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Position</TableHead>
          <TableHead>Person</TableHead>
          {hasDepartment && (
            <TableHead className="hidden sm:table-cell">Department</TableHead>
          )}
          <TableHead>Since</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.positionId}>
            <TableCell className="max-w-[6rem] whitespace-normal font-medium sm:max-w-none sm:whitespace-nowrap">
              {entry.position}
            </TableCell>
            <TableCell className="max-w-[6rem] whitespace-normal sm:max-w-none sm:whitespace-nowrap">
              <Link
                href={`/o/${slug}/admin/staff/${entry.personId}?name=${encodeURIComponent(entry.displayName)}`}
                className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {entry.displayName}
              </Link>
            </TableCell>
            {hasDepartment && (
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {entry.department ?? "—"}
              </TableCell>
            )}
            <TableCell>
              <FormattedDate value={entry.startsOn} mode="date" />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {entry.endsOn ? (
                <FormattedDate value={entry.endsOn} mode="date" />
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell>
              {entry.endsOn === null ? (
                <EndPositionDialog
                  slug={slug}
                  positionId={entry.positionId}
                  personId={entry.personId}
                  position={entry.position}
                  personName={entry.displayName}
                  startsOn={entry.startsOn}
                />
              ) : (
                <span className="text-sm text-muted-foreground">Ended</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
