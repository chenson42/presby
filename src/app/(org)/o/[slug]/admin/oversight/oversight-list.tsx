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
import { FormattedDate } from "@/components/shared/formatted-date";
import type { OversightRow } from "@/lib/presbytery";

const VIABILITY_LABELS: Record<number, string> = {
  1: "At risk",
  2: "Fair",
  3: "Healthy",
};

/** `variant`, not color literals — `1` (at risk) is the one status a
 *  presbytery clerk should never mistake for routine, same "destructive
 *  variant marks the state that can't be casually undone" reasoning
 *  `ordination-list.tsx` uses for `removed`. */
function ViabilityBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <Badge variant="outline">Not yet assessed</Badge>;
  }
  return (
    <Badge variant={score === 1 ? "destructive" : score === 2 ? "secondary" : "default"}>
      {VIABILITY_LABELS[score] ?? score}
    </Badge>
  );
}

/** One row per member congregation — including one with NO
 *  `congregation_oversight` row on file (the "no data on file" empty state,
 *  Phase 3 Edge Cases), which reads distinctly from "assessed and healthy."
 *  A `Table`, same mobile-legibility rationale `ordination-list.tsx`
 *  documents. */
export function OversightList({
  entries,
  slug,
}: {
  entries: OversightRow[];
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
          <TableHead>Viability</TableHead>
          <TableHead className="hidden sm:table-cell">
            Buildings &amp; insurance
          </TableHead>
          <TableHead className="hidden sm:table-cell">Updated</TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.organizationId}>
            <TableCell className="max-w-[8rem] whitespace-normal font-medium sm:max-w-none sm:whitespace-nowrap">
              {entry.name}
            </TableCell>
            <TableCell>
              <ViabilityBadge score={entry.viabilityScore} />
            </TableCell>
            <TableCell className="hidden max-w-[16rem] text-muted-foreground sm:table-cell">
              {entry.buildingsNotes || entry.insuranceCarrier ? (
                <span className="line-clamp-2">
                  {entry.insuranceCarrier
                    ? `${entry.insuranceCarrier}${entry.insuranceExpiresOn ? ` (exp. ${entry.insuranceExpiresOn})` : ""}`
                    : entry.buildingsNotes}
                </span>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {entry.updatedAt ? (
                <FormattedDate value={entry.updatedAt} mode="date" />
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell>
              <Link
                href={`/o/${slug}/admin/oversight/${entry.organizationId}`}
                className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {entry.hasData ? "View / edit" : "Assess"}
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
