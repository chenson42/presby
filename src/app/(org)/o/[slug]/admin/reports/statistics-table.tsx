import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { StatisticsRollupRow } from "@/lib/presbytery";

const PROVENANCE_LABELS: Record<string, string> = {
  presbytery_entered: "Presbytery estimate",
  published_by_congregation: "Congregation reported",
  imported: "Imported",
};

/**
 * The provenance-coalesce read, rendered — one row per member congregation,
 * INCLUDING one with no statistics on file for `year` at all (Phase 3 Edge
 * Cases: "no data on file" must read differently from "not yet published
 * this year"). `provenance` is shown as its own badge, never conflated
 * ("Presbytery estimate" vs. "Congregation reported," Phase 1 §3) —
 * attribution-integrity is adversarial territory the design names
 * explicitly.
 */
export function StatisticsTable({ entries }: { entries: StatisticsRollupRow[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No member congregations on record</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Congregation</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="hidden sm:table-cell">Ending active</TableHead>
          <TableHead className="hidden sm:table-cell">Gains</TableHead>
          <TableHead className="hidden sm:table-cell">Losses</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const gains =
            (entry.gainsProfessionsUnder18 ?? 0) +
            (entry.gainsProfessions18Plus ?? 0) +
            (entry.gainsCertificate ?? 0) +
            (entry.gainsOther ?? 0);
          const losses =
            (entry.lossesCertificate ?? 0) +
            (entry.lossesDeaths ?? 0) +
            (entry.lossesOther ?? 0);
          return (
            <TableRow key={entry.organizationId}>
              <TableCell className="max-w-[8rem] whitespace-normal font-medium sm:max-w-none sm:whitespace-nowrap">
                {entry.name}
              </TableCell>
              <TableCell>
                {entry.provenance ? (
                  <Badge variant={entry.provenance === "published_by_congregation" ? "default" : "secondary"}>
                    {PROVENANCE_LABELS[entry.provenance] ?? entry.provenance}
                  </Badge>
                ) : (
                  <Badge variant="outline">No data on file</Badge>
                )}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {entry.hasData ? (entry.endingActive ?? "—") : "—"}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {entry.hasData ? gains : "—"}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {entry.hasData ? losses : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
