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
import { ViabilityBadge } from "@/components/oversight/assessment-section";
import { STATE } from "@/lib/oversight/copy";
import { buildingsInUseLabel, insuranceExpiryCell } from "@/lib/oversight/derive";
import type { OversightList as OversightListData, OversightListRow } from "@/lib/oversight/reads";

const NOT_RECORDED = <span className="text-muted-foreground">{STATE.notRecorded}</span>;

function cityAndCounty(manage: NonNullable<OversightListRow["manage"]>) {
  const text = [manage.city, manage.county].filter(Boolean).join(", ");
  return text === "" ? NOT_RECORDED : text;
}

function InsuranceCell({ expiresOn, today }: { expiresOn: string | null; today: string }) {
  const cell = insuranceExpiryCell(expiresOn, today);
  if (cell.kind === "none") return NOT_RECORDED;
  if (cell.kind === "expired") {
    return (
      <span>
        Expired <FormattedDate value={cell.date} mode="date" />
      </span>
    );
  }
  return <FormattedDate value={cell.date} mode="date" />;
}

/**
 * One row per member congregation (C1), the columns following the viewer's keys:
 * a column a key does not cover is LEFT OUT and the page explains it once above
 * the table (a "Locked" in every row is noise). Never a zero where "not recorded"
 * is the truth. At 360px the table keeps the congregation, the first held column
 * and the "Open" link; the rest show from `sm`.
 */
export function OversightList({ list, slug }: { list: OversightListData; slug: string }) {
  if (list.rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No member congregations on record</p>
      </div>
    );
  }

  const today = list.today ?? "";
  // A finance-only viewer has no Viability column, so Insurance is their column at 360px.
  const insuranceClass = list.manage ? "hidden sm:table-cell" : "";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Congregation</TableHead>
          {list.manage ? <TableHead>Viability</TableHead> : null}
          {list.manage ? <TableHead className="hidden sm:table-cell">City and county</TableHead> : null}
          {list.manage ? <TableHead className="hidden sm:table-cell">Buildings in use</TableHead> : null}
          {list.finance ? <TableHead className={insuranceClass}>Insurance expires</TableHead> : null}
          {list.manage ? <TableHead className="hidden sm:table-cell">Assessment updated</TableHead> : null}
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.rows.map((row) => (
          <TableRow key={row.organizationId}>
            <TableCell className="max-w-[8rem] whitespace-normal font-medium sm:max-w-none sm:whitespace-nowrap">{row.name}</TableCell>
            {list.manage ? (
              <TableCell>{row.manage ? <ViabilityBadge score={row.manage.viabilityScore} /> : null}</TableCell>
            ) : null}
            {list.manage ? (
              <TableCell className="hidden whitespace-normal sm:table-cell">{row.manage ? cityAndCounty(row.manage) : null}</TableCell>
            ) : null}
            {list.manage ? (
              <TableCell className="hidden sm:table-cell">
                {row.manage ? buildingsInUseLabel(row.manage.buildingsInUse) : null}
              </TableCell>
            ) : null}
            {list.finance ? (
              <TableCell className={insuranceClass}>
                {row.finance ? <InsuranceCell expiresOn={row.finance.insuranceExpiresOn} today={today} /> : null}
              </TableCell>
            ) : null}
            {list.manage ? (
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {row.manage?.assessmentUpdatedAt ? <FormattedDate value={row.manage.assessmentUpdatedAt} mode="date" /> : NOT_RECORDED}
              </TableCell>
            ) : null}
            <TableCell>
              <Link
                href={`/o/${slug}/admin/oversight/${row.organizationId}`}
                className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Open <span className="sr-only">{row.name}</span>
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
