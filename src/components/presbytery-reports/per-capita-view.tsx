import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FRAME_COPY, PER_CAPITA_COPY, formatDollars } from "@/lib/presbytery-reports/copy";
import type { PerCapitaData, PerCapitaRow } from "@/lib/presbytery-reports/derive";
import { ReportEmpty } from "./report-states";

function money(cents: number | null): string {
  return cents === null ? "—" : formatDollars(cents);
}

function StatusBadge({ row }: { row: PerCapitaRow }) {
  const variant = row.status === "paid" ? "default" : row.status === "partly_paid" ? "secondary" : "outline";
  return <Badge variant={variant}>{PER_CAPITA_COPY.status[row.status]}</Badge>;
}

/** Why a roster congregation has no bill, or nothing for a billed row. */
function Reason({ row }: { row: PerCapitaRow }) {
  if (row.status !== "not_billed" || row.notBilledReason === null) return null;
  return (
    <span className="block text-xs text-muted-foreground">
      {row.notBilledReason === "no_statistics"
        ? PER_CAPITA_COPY.notBilled.no_statistics(row.basisYear)
        : PER_CAPITA_COPY.notBilled.not_generated}
    </span>
  );
}

function Departed({ row }: { row: PerCapitaRow }) {
  return row.membership === "departed" ? (
    <Badge variant="outline" className="ml-2 align-middle">
      {PER_CAPITA_COPY.departed}
    </Badge>
  ) : null;
}

/**
 * One billing year of per capita: every figure is `per_capita_records` rounded
 * to the cent, and "still owed" is billed minus paid in integer cents (a
 * negative reads as a credit). Not-billed rows say why. A year with no bills at
 * all is the empty state, not a list of "not generated yet".
 */
export function PerCapitaView({ data, slug, billingYear }: { data: PerCapitaData; slug: string; billingYear: number }) {
  if (data.rosterCount === 0 && data.rows.length === 0) return <ReportEmpty title={FRAME_COPY.noMembers} />;
  if (data.rows.length === 0) {
    return (
      <ReportEmpty
        title={PER_CAPITA_COPY.empty.title(billingYear)}
        body={PER_CAPITA_COPY.empty.body}
        action={{ href: `/o/${slug}/admin/reports?billingYear=${billingYear}`, label: PER_CAPITA_COPY.empty.action }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <ul data-testid="report-cards" className="space-y-3 sm:hidden">
        {data.rows.map((row) => (
          <li key={row.organizationId} className="rounded-lg border border-border p-4">
            <p className="break-words font-medium">
              {row.name}
              <Departed row={row} />
            </p>
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">{PER_CAPITA_COPY.columns.stillOwed}</span>{" "}
              <span className="font-medium">{money(row.outstandingCents)}</span>
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{PER_CAPITA_COPY.columns.billed}</dt>
                <dd className="text-right">{money(row.billedCents)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{PER_CAPITA_COPY.columns.paid}</dt>
                <dd className="text-right">{money(row.paidCents)}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">{PER_CAPITA_COPY.columns.status}</dt>
                <dd className="text-right">
                  <StatusBadge row={row} />
                  <Reason row={row} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
        <li className="rounded-lg border border-border bg-muted/40 p-4" data-testid="report-cards-total">
          <p className="font-medium">{PER_CAPITA_COPY.total}</p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{PER_CAPITA_COPY.columns.billed}</dt>
              <dd>{formatDollars(data.totals.billedCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{PER_CAPITA_COPY.columns.paid}</dt>
              <dd>{formatDollars(data.totals.paidCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{PER_CAPITA_COPY.columns.stillOwed}</dt>
              <dd className="font-medium">{formatDollars(data.totals.outstandingCents)}</dd>
            </div>
          </dl>
        </li>
      </ul>

      <div data-testid="report-table" className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{PER_CAPITA_COPY.columns.congregation}</TableHead>
              <TableHead className="text-right">{PER_CAPITA_COPY.columns.billed}</TableHead>
              <TableHead className="text-right">{PER_CAPITA_COPY.columns.paid}</TableHead>
              <TableHead className="text-right">{PER_CAPITA_COPY.columns.stillOwed}</TableHead>
              <TableHead>{PER_CAPITA_COPY.columns.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.organizationId}>
                <TableCell className="max-w-xs break-words font-medium whitespace-normal">
                  {row.name}
                  <Departed row={row} />
                </TableCell>
                <TableCell className="text-right">{money(row.billedCents)}</TableCell>
                <TableCell className="text-right">{money(row.paidCents)}</TableCell>
                <TableCell className="text-right">{money(row.outstandingCents)}</TableCell>
                <TableCell className="whitespace-normal">
                  <StatusBadge row={row} />
                  <Reason row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">{PER_CAPITA_COPY.total}</TableCell>
              <TableCell className="text-right font-medium">{formatDollars(data.totals.billedCents)}</TableCell>
              <TableCell className="text-right font-medium">{formatDollars(data.totals.paidCents)}</TableCell>
              <TableCell className="text-right font-medium">{formatDollars(data.totals.outstandingCents)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
