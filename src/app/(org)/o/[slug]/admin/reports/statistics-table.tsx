import Link from "next/link";
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
export function StatisticsTable({
  entries,
  slug,
}: {
  entries: StatisticsRollupRow[];
  /** Threaded so each row can link to that congregation's full filing
   *  history (`/o/<slug>/admin/reports/<aboutOrgId>`, architect Phase 2
   *  ruling 1d) — withdrawn/superseded history this "current" rollup never
   *  shows. */
  slug: string;
}) {
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
                <Link
                  href={`/o/${slug}/admin/reports/${entry.organizationId}`}
                  className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {entry.name}
                </Link>
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
