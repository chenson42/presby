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
import { PublicListingToggle } from "./public-listing-toggle";

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
 * `Department` and other secondary columns drop below `sm:` on a phone
 * viewport, mirroring `officer-roster.tsx`'s own verified 360px finding —
 * Position/Person/Since/Ends/Actions is the always-visible set that must
 * reach the "End position" action without horizontal scroll. `Public
 * listing` (docs/work-log/2026-08-27-public-staff-directory.md) is the
 * newest member of the below-`sm:` set — VERIFIED IN A REAL BROWSER AT
 * 390PX: adding it as an always-visible column pushed "End position" out of
 * the frame with no visible affordance that it existed, the exact failure
 * mode this file's own comment already named for the columns above. Opting
 * someone into the public directory is an occasional, desk-adjacent action
 * (Phase 1's own cadence: "per hire"), not a look-up-on-the-go one, so
 * trading its mobile visibility for keeping "End position" reachable
 * without scrolling is the right tradeoff, not a compromise forced by
 * running out of room.
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
          <TableHead className="hidden sm:table-cell">Public listing</TableHead>
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
            <TableCell className="hidden sm:table-cell">
              <PublicListingToggle
                slug={slug}
                positionId={entry.positionId}
                position={entry.position}
                personName={entry.displayName}
                publicListed={entry.publicListed}
              />
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
