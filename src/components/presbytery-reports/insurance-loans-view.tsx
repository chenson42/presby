import type { ReactNode } from "react";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatTriState } from "@/lib/oversight/derive";
import { FRAME_COPY, INSURANCE_LOANS_COPY } from "@/lib/presbytery-reports/copy";
import type { InsuranceLoansData, InsuranceLoansRow } from "@/lib/presbytery-reports/oversight-derive";
import { ReportEmpty } from "./report-states";

const C = INSURANCE_LOANS_COPY.columns;
const NOT_RECORDED = INSURANCE_LOANS_COPY.notRecorded;

/** A summed figure: dollars, or "Not recorded" when none is (never $0); "{n} not recorded" beside a total that leaves some out. */
function Figure({ cents, unrecorded }: { cents: number | null; unrecorded: number }) {
  return (
    <>
      <span>{cents === null ? NOT_RECORDED : formatMoney(cents)}</span>
      {unrecorded > 0 && cents !== null ? (
        <span className="block text-xs text-muted-foreground">{INSURANCE_LOANS_COPY.unrecorded(unrecorded)}</span>
      ) : null}
    </>
  );
}

function Expires({ row }: { row: InsuranceLoansRow }) {
  const ins = row.insurance;
  if (!ins || ins.policyExpiresOn === null) return <>{NOT_RECORDED}</>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <FormattedDate value={ins.policyExpiresOn} mode="date" />
      {ins.expiry === "expired" ? <Badge variant="destructive">{INSURANCE_LOANS_COPY.expired}</Badge> : null}
    </span>
  );
}

function Guarantee({ row }: { row: InsuranceLoansRow }) {
  if (row.guarantees.length === 0) return <>{NOT_RECORDED}</>;
  return (
    <ul className="space-y-1">
      {row.guarantees.map((g, i) => (
        <li key={i} className="whitespace-pre-line break-words">
          {g}
        </li>
      ))}
    </ul>
  );
}

function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className="max-w-[60%] shrink-0 text-right">{children}</dd>
    </div>
  );
}

export function InsuranceLoansView({ data }: { data: InsuranceLoansData }) {
  if (data.rosterCount === 0) return <ReportEmpty title={FRAME_COPY.noMembers} />;
  const t = data.totals;

  return (
    <div className="space-y-4">
      <ul data-testid="report-cards" className="space-y-3 sm:hidden">
        {data.rows.map((row) => (
          <li key={row.organizationId} className="rounded-lg border border-border p-4">
            <p className="break-words font-medium">{row.name}</p>
            <dl className="mt-3 space-y-1 text-sm">
              <Pair label={C.carrier}>{row.insurance?.carrier ?? NOT_RECORDED}</Pair>
              <Pair label={C.policyYear}>{row.insurance ? String(row.insurance.policyYear) : NOT_RECORDED}</Pair>
              <Pair label={C.policyExpires}>
                <Expires row={row} />
              </Pair>
              <Pair label={C.recentClaims}>{row.insurance ? formatTriState(row.insurance.recentClaims) : NOT_RECORDED}</Pair>
              <Pair label={C.poolInterest}>{row.insurance ? formatTriState(row.insurance.poolInterest) : NOT_RECORDED}</Pair>
              <Pair label={C.openLoans}>{String(row.openLoans)}</Pair>
              {row.openLoans > 0 ? (
                <>
                  <Pair label={C.originalAmount}>
                    <Figure cents={row.originalCents} unrecorded={row.originalUnrecorded} />
                  </Pair>
                  <Pair label={C.currentBalance}>
                    <Figure cents={row.balanceCents} unrecorded={row.balanceUnrecorded} />
                  </Pair>
                  <Pair label={C.grants}>
                    <Figure cents={row.grantsCents} unrecorded={row.grantsUnrecorded} />
                  </Pair>
                  <Pair label={C.guarantee}>
                    <Guarantee row={row} />
                  </Pair>
                </>
              ) : null}
              <Pair label={C.appraisedValue}>
                <Figure cents={row.appraisedCents} unrecorded={row.buildingsWithoutAppraisal} />
              </Pair>
            </dl>
          </li>
        ))}
        <li data-testid="report-total" className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="font-medium">{INSURANCE_LOANS_COPY.total}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <Pair label={C.openLoans}>{String(t.openLoans)}</Pair>
            <Pair label={C.originalAmount}>
              <Figure cents={t.originalCents} unrecorded={t.originalUnrecorded} />
            </Pair>
            <Pair label={C.currentBalance}>
              <Figure cents={t.balanceCents} unrecorded={t.balanceUnrecorded} />
            </Pair>
            <Pair label={C.grants}>
              <Figure cents={t.grantsCents} unrecorded={t.grantsUnrecorded} />
            </Pair>
            <Pair label={C.appraisedValue}>
              <Figure cents={t.appraisedCents} unrecorded={t.buildingsWithoutAppraisal} />
            </Pair>
          </dl>
        </li>
      </ul>

      <div data-testid="report-table" className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{C.congregation}</TableHead>
              <TableHead>{C.carrier}</TableHead>
              <TableHead>{C.policyYear}</TableHead>
              <TableHead>{C.policyExpires}</TableHead>
              <TableHead>{C.recentClaims}</TableHead>
              <TableHead>{C.poolInterest}</TableHead>
              <TableHead>{C.openLoans}</TableHead>
              <TableHead>{C.originalAmount}</TableHead>
              <TableHead>{C.currentBalance}</TableHead>
              <TableHead>{C.grants}</TableHead>
              <TableHead>{C.guarantee}</TableHead>
              <TableHead>{C.appraisedValue}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.organizationId}>
                <TableCell className="max-w-xs whitespace-normal break-words font-medium">{row.name}</TableCell>
                <TableCell className="whitespace-normal break-words">{row.insurance?.carrier ?? NOT_RECORDED}</TableCell>
                <TableCell>{row.insurance ? String(row.insurance.policyYear) : NOT_RECORDED}</TableCell>
                <TableCell>
                  <Expires row={row} />
                </TableCell>
                <TableCell>{row.insurance ? formatTriState(row.insurance.recentClaims) : NOT_RECORDED}</TableCell>
                <TableCell>{row.insurance ? formatTriState(row.insurance.poolInterest) : NOT_RECORDED}</TableCell>
                <TableCell>{row.openLoans}</TableCell>
                <TableCell>{row.openLoans > 0 ? <Figure cents={row.originalCents} unrecorded={row.originalUnrecorded} /> : null}</TableCell>
                <TableCell>{row.openLoans > 0 ? <Figure cents={row.balanceCents} unrecorded={row.balanceUnrecorded} /> : null}</TableCell>
                <TableCell>{row.openLoans > 0 ? <Figure cents={row.grantsCents} unrecorded={row.grantsUnrecorded} /> : null}</TableCell>
                <TableCell className="max-w-md whitespace-normal">{row.openLoans > 0 ? <Guarantee row={row} /> : null}</TableCell>
                <TableCell>
                  <Figure cents={row.appraisedCents} unrecorded={row.buildingsWithoutAppraisal} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">{INSURANCE_LOANS_COPY.total}</TableCell>
              <TableCell colSpan={5} />
              <TableCell>{t.openLoans}</TableCell>
              <TableCell>
                <Figure cents={t.originalCents} unrecorded={t.originalUnrecorded} />
              </TableCell>
              <TableCell>
                <Figure cents={t.balanceCents} unrecorded={t.balanceUnrecorded} />
              </TableCell>
              <TableCell>
                <Figure cents={t.grantsCents} unrecorded={t.grantsUnrecorded} />
              </TableCell>
              <TableCell />
              <TableCell>
                <Figure cents={t.appraisedCents} unrecorded={t.buildingsWithoutAppraisal} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
