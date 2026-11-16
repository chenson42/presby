import Link from "next/link";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FRAME_COPY, VIABILITY_COPY } from "@/lib/presbytery-reports/copy";
import type { ViabilityData, ViabilityRow } from "@/lib/presbytery-reports/derive";
import { ReportEmpty } from "./report-states";

/** Same variants as the oversight list: at risk is the one status never to read as routine. */
function ViabilityBadge({ row }: { row: ViabilityRow }) {
  const variant = row.score === null ? "outline" : row.score === 1 ? "destructive" : row.score === 2 ? "secondary" : "default";
  return <Badge variant={variant}>{row.label}</Badge>;
}

function Notes({ row }: { row: ViabilityRow }) {
  return row.notes ? <span className="whitespace-pre-line break-words">{row.notes}</span> : <>{VIABILITY_COPY.none}</>;
}

function Updated({ row }: { row: ViabilityRow }) {
  return row.lastUpdated ? <FormattedDate value={row.lastUpdated} mode="date" /> : <>{VIABILITY_COPY.none}</>;
}

export function ViabilityView({ data, slug }: { data: ViabilityData; slug: string }) {
  if (data.rosterCount === 0) return <ReportEmpty title={FRAME_COPY.noMembers} />;

  return (
    <div className="space-y-4">
      {data.anyNotAssessed ? (
        <p className="text-sm text-muted-foreground">
          {VIABILITY_COPY.assessNote}{" "}
          <Link href={`/o/${slug}/admin/oversight`} className="text-primary underline-offset-4 hover:underline">
            {VIABILITY_COPY.assessLink}
          </Link>
        </p>
      ) : null}

      <ul data-testid="report-cards" className="space-y-3 sm:hidden">
        {data.rows.map((row) => (
          <li key={row.organizationId} className="rounded-lg border border-border p-4">
            <p className="break-words font-medium">{row.name}</p>
            <div className="mt-2">
              <ViabilityBadge row={row} />
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              <div>
                <dt className="text-muted-foreground">{VIABILITY_COPY.columns.notes}</dt>
                <dd>
                  <Notes row={row} />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{VIABILITY_COPY.columns.lastUpdated}</dt>
                <dd className="text-right">
                  <Updated row={row} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <div data-testid="report-table" className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{VIABILITY_COPY.columns.congregation}</TableHead>
              <TableHead>{VIABILITY_COPY.columns.viability}</TableHead>
              <TableHead>{VIABILITY_COPY.columns.notes}</TableHead>
              <TableHead>{VIABILITY_COPY.columns.lastUpdated}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.organizationId}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>
                  <ViabilityBadge row={row} />
                </TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  <Notes row={row} />
                </TableCell>
                <TableCell>
                  <Updated row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
