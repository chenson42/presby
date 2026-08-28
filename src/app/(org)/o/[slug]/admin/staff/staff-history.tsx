import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { StaffHistoryEntry } from "@/lib/staff";

/**
 * One person's full staff history, across every position they have ever
 * held at this org. A `Table`, same rationale as `staff-roster.tsx`. A
 * Server Component — purely a read view over `getStaffHistory()`'s output,
 * no mutation happens here.
 *
 * `end_reason` (`src/lib/db/domain/staff.ts`'s own comment) carries no fixed
 * vocabulary — unlike `officer_terms.end_reason`'s documented "completed |
 * resigned | removed | deceased" convention — so this renders the raw
 * string verbatim rather than mapping through a label table (there is no
 * label table to map through; see `end-position-dialog.tsx`'s identical
 * note on the same column).
 */
export function StaffHistory({ entries }: { entries: StaffHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No staff history recorded</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Position</TableHead>
          <TableHead className="hidden sm:table-cell">Department</TableHead>
          <TableHead>Since</TableHead>
          <TableHead>Ended</TableHead>
          <TableHead>Reason</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.positionId}>
            <TableCell className="font-medium">{entry.position}</TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {entry.department ?? "—"}
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
            <TableCell className="text-muted-foreground">
              {entry.endReason ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
