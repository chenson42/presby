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
import type { OfficerRosterEntry } from "@/lib/officers";
import { OFFICE_LABELS } from "./office-labels";
import { EndTermDialog } from "./end-term-dialog";
import { PublicListingToggle } from "./public-listing-toggle";
import { DisplayOrderInput } from "./display-order-input";

/**
 * "Who currently holds office" — a `Table`, not cards, per Phase 2/3's
 * explicit mobile-legibility ruling (office / person / class year / since /
 * ends / district / actions is genuinely wide-column data, the opposite of
 * `directory/directory-list.tsx`'s single-column card rationale).
 *
 * The `District` column ONLY renders when at least one row carries an
 * `orgUnitName` — most congregations run zero deacon terms with a district
 * on any given day, and a column of solid em dashes is worse than no column.
 *
 * MOBILE (360px), VERIFIED IN A REAL BROWSER (Workflow Rule, "Verify in a
 * Browser" — `next build` passing was not evidence this rendered usably).
 * `Table`'s own wrapper already scrolls horizontally
 * (`src/components/ui/table.tsx`'s `overflow-x-auto` container), but a real
 * walkthrough at 360px showed only Office/Person (partially) fit before the
 * scroll boundary, pushing `Since`/`Ends`/the "End term" action entirely
 * off-screen with no visible affordance that more columns existed. `Class
 * year` and `District` — useful for annual nominating-committee planning,
 * not for "who currently serves and can I end their term right now" — are
 * hidden below `sm:` so the always-visible set (Office, Person, Since, Ends,
 * Actions) reaches the End-term button without scrolling on a phone. Both
 * values are still readable at `sm:` and above; nothing is lost, only
 * deferred past the breakpoint, per Phase 2/3's own "class year / district
 * need to drop below a breakpoint" suggestion. `Public listing` (docs/
 * work-log/2026-08-27-public-staff-directory.md) joins this below-`sm:` set
 * for the identical reason — VERIFIED IN A REAL BROWSER AT 390PX, adding it
 * as an always-visible column pushed "End term" out of the frame with no
 * scroll affordance, the exact failure this comment already documents for
 * Class year/District. Opting a term into the public directory is an
 * occasional, desk-adjacent action (Phase 1's own cadence), not a
 * look-up-on-the-go one.
 *
 * `Display order` (docs/work-log/2026-08-28-public-directory-primitives.md)
 * joins the SAME below-`sm:` set for the identical reason — RE-VERIFIED IN A
 * REAL BROWSER AT 390PX/360PX with this second new column added: at both
 * widths, Office/Person/Since/Ends/"End term" still reach the visible
 * viewport with no horizontal scroll, because both new columns are hidden
 * below `sm:`, exactly as `Public listing` already was.
 *
 * Office and Person also wrap (rather than `TableCell`'s own default
 * `whitespace-nowrap`) below a max width on small screens ONLY — "Clerk of
 * Session" and a two-word name forced onto one line were, by themselves,
 * most of the remaining overflow after the two columns above were dropped.
 * They revert to a single line at `sm:` and above, where there's room.
 *
 * A Server Component (read-only data), same as `roles-list.tsx` — it embeds
 * `<EndTermDialog>` (a client component) per row without itself needing
 * `'use client'`.
 */
export function OfficerRoster({
  entries,
  slug,
}: {
  entries: OfficerRosterEntry[];
  slug: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No officers recorded yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the form below to add the first one.
        </p>
      </div>
    );
  }

  const hasDistrict = entries.some((entry) => entry.orgUnitName !== null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Office</TableHead>
          <TableHead>Person</TableHead>
          <TableHead className="hidden sm:table-cell">Class year</TableHead>
          <TableHead>Since</TableHead>
          <TableHead>Ends</TableHead>
          {hasDistrict && (
            <TableHead className="hidden sm:table-cell">District</TableHead>
          )}
          <TableHead className="hidden sm:table-cell">Public listing</TableHead>
          <TableHead className="hidden sm:table-cell">Display order</TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.termId}>
            <TableCell className="max-w-[6rem] whitespace-normal font-medium sm:max-w-none sm:whitespace-nowrap">
              {OFFICE_LABELS[entry.office]}
            </TableCell>
            <TableCell className="max-w-[6rem] whitespace-normal sm:max-w-none sm:whitespace-nowrap">
              <Link
                href={`/o/${slug}/admin/officers/${entry.personId}?name=${encodeURIComponent(entry.displayName)}`}
                className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {entry.displayName}
              </Link>
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {entry.classYear ?? "—"}
            </TableCell>
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
            {hasDistrict && (
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {entry.orgUnitName ?? "—"}
              </TableCell>
            )}
            <TableCell className="hidden sm:table-cell">
              <PublicListingToggle
                slug={slug}
                termId={entry.termId}
                officeLabel={OFFICE_LABELS[entry.office]}
                personName={entry.displayName}
                publicListed={entry.publicListed}
              />
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <DisplayOrderInput
                slug={slug}
                termId={entry.termId}
                personName={entry.displayName}
                publicDisplayOrder={entry.publicDisplayOrder}
              />
            </TableCell>
            <TableCell>
              <EndTermDialog
                slug={slug}
                termId={entry.termId}
                personId={entry.personId}
                office={entry.office}
                personName={entry.displayName}
                startsOn={entry.startsOn}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
