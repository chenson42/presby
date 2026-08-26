import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { OfficerHistoryEntry } from "@/lib/officers";
import { OFFICE_LABELS } from "./office-labels";

/**
 * `end_reason` (`src/lib/db/domain/officers.ts`'s own comment: "completed |
 * resigned | removed | deceased") is a free-text column, not a DB enum — this
 * map is display polish only. An unrecognized value (a future reason, or a
 * hand-imported historical record) falls back to the raw string rather than
 * a blank cell.
 */
const END_REASON_LABELS: Record<string, string> = {
  completed: "Completed",
  resigned: "Resigned",
  removed: "Removed",
  deceased: "Deceased",
};

/**
 * Flow 3 — one person's full officer history, across every office they have
 * ever held. A `Table`, same rationale as `officer-roster.tsx`. A Server
 * Component — purely a read view over `getOfficerHistory()`'s output, no
 * mutation happens here.
 */
export function OfficerHistory({ entries }: { entries: OfficerHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No officer history recorded</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Office</TableHead>
          <TableHead>Since</TableHead>
          <TableHead>Ended</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Years served</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.termId}>
            <TableCell className="font-medium">
              {OFFICE_LABELS[entry.office]}
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
              {entry.endReason
                ? (END_REASON_LABELS[entry.endReason] ?? entry.endReason)
                : "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {entry.yearsServed.toFixed(1)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
