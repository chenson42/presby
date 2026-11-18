import "server-only";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { readInsuranceLoansReportFacts } from "@/lib/oversight/report-rows";
import { orgTimeZoneInTx } from "@/lib/org-settings";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { todayInOrgZone } from "@/lib/shared/org-time";
import { auditReportExport } from "./audit";
import { reportByKey, type ReportExport, type ReportRead, type ReportViewer } from "./contract";
import { buildInsuranceLoansCsv } from "./csv";
import { deriveInsuranceLoans, type InsuranceLoansData } from "./oversight-derive";
import { readRoster } from "./roster";

const REPORT = reportByKey("insurance_and_loans");

/**
 * The Insurance-and-loans report's read (DECISION-348). The key
 * (`congregation_oversight.finance`, tier 2) is checked live inside this
 * transaction BEFORE anything else is read, then the roster (active member
 * congregations only), the organization's local date (what "expired" is measured
 * against) and the rows from `src/lib/oversight/report-rows.ts`. Policy numbers,
 * notes and lenders are never read. The page and the CSV both come from this one
 * read, so they cannot diverge.
 */
export async function readInsuranceLoans(tx: OrgTx, viewer: ReportViewer, now: Date = new Date()): Promise<ReportRead<InsuranceLoansData>> {
  const [held] = await holdsPermissions(tx, viewer, [REPORT.permission]);
  if (!held) return { kind: "forbidden" };

  const roster = await readRoster(tx, viewer.organizationId);
  const today = todayInOrgZone(now, await orgTimeZoneInTx(tx, viewer.organizationId));
  const facts = await readInsuranceLoansReportFacts(
    tx,
    viewer.organizationId,
    roster.map((r) => r.id),
  );
  return { kind: "ok", data: deriveInsuranceLoans(roster, facts, today) };
}

export function getInsuranceLoans(viewer: ReportViewer, now: Date = new Date()): Promise<ReportRead<InsuranceLoansData>> {
  return withOrgContext(viewer.personId, viewer.organizationId, (tx) => readInsuranceLoans(tx, viewer, now));
}

/** One transaction: the page's read, the CSV from its data, then the audit row. */
export function exportInsuranceLoans(viewer: ReportViewer, now: Date = new Date()): Promise<ReportExport> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx): Promise<ReportExport> => {
    const read = await readInsuranceLoans(tx, viewer, now);
    if (read.kind === "forbidden") return { kind: "forbidden" };
    const csv = buildInsuranceLoansCsv(read.data);
    const rowCount = read.data.rows.length;
    await auditReportExport(tx, viewer, { report: "insurance_and_loans", rowCount });
    return { kind: "ok", csv, rowCount, filenameBase: REPORT.filenameBase };
  });
}
