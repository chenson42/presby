import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FRAME_COPY, TREND_COPY } from "@/lib/presbytery-reports/copy";
import type { MembershipTrendData, TrendCell } from "@/lib/presbytery-reports/derive";
import { ReportEmpty } from "./report-states";

/**
 * The three non-number cells must read distinctly: a dash (not a member that
 * year, with hidden text for a screen reader), "No data" (a member, nothing on
 * file) and "Not reported" (on file without a figure).
 */
export function TrendCellText({ cell }: { cell: TrendCell }) {
  if (cell.kind === "not_member") {
    return (
      <span>
        <span aria-hidden="true">{TREND_COPY.dash}</span>
        <span className="sr-only">{TREND_COPY.notMemberHidden}</span>
      </span>
    );
  }
  if (cell.kind === "no_data") return <span className="text-muted-foreground">{TREND_COPY.noData}</span>;
  if (cell.endingActive === null) return <span className="text-muted-foreground">{TREND_COPY.notReported}</span>;
  return <span>{cell.endingActive}</span>;
}

/**
 * The congregation-by-year grid. A card list below `lg` (up to ten year columns
 * do not fit between 640 and 1024px, and primary content must not need a
 * horizontal scroll), newest year first; a table from `lg` up. Never a bare
 * total: every year says how many congregations reported.
 */
export function MembershipTrendView({ data, slug }: { data: MembershipTrendData; slug: string }) {
  if (data.rosterCount === 0) return <ReportEmpty title={FRAME_COPY.noMembers} />;
  if (!data.hasData) {
    return (
      <ReportEmpty
        title={TREND_COPY.nothing.title(data.from, data.to)}
        body={TREND_COPY.nothing.body}
        action={{ href: `/o/${slug}/admin/reports?year=${data.to}`, label: TREND_COPY.nothing.action }}
      />
    );
  }

  const newestFirst = data.years.map((year, i) => ({ year, i })).reverse();

  return (
    <div className="space-y-4">
      <ul data-testid="report-cards" className="space-y-3 lg:hidden">
        {data.rows.map((row) => (
          <li key={row.organizationId} className="rounded-lg border border-border p-4">
            <p className="break-words font-medium">{row.name}</p>
            <dl className="mt-2 space-y-1 text-sm">
              {newestFirst.map(({ year, i }) => (
                <div key={year} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{year}</dt>
                  <dd className="text-right">
                    <TrendCellText cell={row.cells[i]} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        <li className="rounded-lg border border-border bg-muted/40 p-4" data-testid="report-cards-total">
          <p className="font-medium">{TREND_COPY.totalReported}</p>
          <dl className="mt-2 space-y-1 text-sm">
            {newestFirst.map(({ year, i }) => (
              <div key={year} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{year}</dt>
                <dd className="text-right">
                  <span className="font-medium">{data.footer[i].total}</span>
                  <span className="block text-xs text-muted-foreground">
                    {TREND_COPY.reporting(data.footer[i].reporting, data.footer[i].members)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </li>
      </ul>

      <div data-testid="report-table" className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{TREND_COPY.columnCongregation}</TableHead>
              {data.years.map((year) => (
                <TableHead key={year} className="text-right">
                  {year}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.organizationId}>
                <TableCell className="max-w-xs whitespace-normal break-words font-medium">{row.name}</TableCell>
                {row.cells.map((cell, i) => (
                  <TableCell key={data.years[i]} className="text-right">
                    <TrendCellText cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">{TREND_COPY.totalReported}</TableCell>
              {data.footer.map((f) => (
                <TableCell key={f.year} className="text-right">
                  <span className="font-medium">{f.total}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {TREND_COPY.reporting(f.reporting, f.members)}
                  </span>
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
