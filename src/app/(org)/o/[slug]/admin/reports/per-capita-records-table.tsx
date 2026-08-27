import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { PerCapitaRecordRow } from "@/lib/presbytery";

const PAID_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  paid: "default",
  partial: "secondary",
  unpaid: "destructive",
};

/** Every generated per-capita record for one billing year — `amountOwed`/
 *  `rateApplied`/`endingActiveBasis` are frozen SNAPSHOTS (never re-derived
 *  live), per this table's own header discipline in `src/lib/presbytery.ts`. */
export function PerCapitaRecordsTable({
  records,
}: {
  records: PerCapitaRecordRow[];
}) {
  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No records generated for this year yet</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Congregation</TableHead>
          <TableHead className="hidden sm:table-cell">Basis year</TableHead>
          <TableHead className="hidden sm:table-cell">Active members</TableHead>
          <TableHead>Amount owed</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">Paid on</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record) => (
          <TableRow key={record.recordId}>
            <TableCell className="max-w-[8rem] whitespace-normal font-medium sm:max-w-none sm:whitespace-nowrap">
              {record.name}
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {record.basisYear}
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {record.endingActiveBasis}
            </TableCell>
            <TableCell>${record.amountOwed}</TableCell>
            <TableCell>
              <Badge variant={PAID_STATUS_VARIANT[record.paidStatus] ?? "outline"}>
                {record.paidStatus}
              </Badge>
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {record.paidAt ? <FormattedDate value={record.paidAt} mode="date" /> : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
