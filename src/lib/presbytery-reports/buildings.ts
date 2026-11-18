import "server-only";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { readBuildingsReportFacts } from "@/lib/oversight/report-rows";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { auditReportExport } from "./audit";
import { reportByKey, type ReportExport, type ReportRead, type ReportViewer } from "./contract";
import { buildBuildingsCsv } from "./csv";
import { deriveBuildings, type BuildingsData } from "./oversight-derive";
import { readRoster } from "./roster";

const REPORT = reportByKey("buildings");

/**
 * The Buildings report's read (DECISION-348). The key (`congregation_oversight.manage`,
 * tier 1) is checked live inside this transaction, then the roster (active member
 * congregations only), then the rows from `src/lib/oversight/report-rows.ts`, so the
 * tables are never named here. Retired and removed buildings are not in the report.
 * The page and the CSV both come from this one read, so they cannot diverge.
 */
export async function readBuildingsReport(tx: OrgTx, viewer: ReportViewer): Promise<ReportRead<BuildingsData>> {
  const [held] = await holdsPermissions(tx, viewer, [REPORT.permission]);
  if (!held) return { kind: "forbidden" };

  const roster = await readRoster(tx, viewer.organizationId);
  const facts = await readBuildingsReportFacts(
    tx,
    viewer.organizationId,
    roster.map((r) => r.id),
  );
  return { kind: "ok", data: deriveBuildings(roster, facts) };
}

export function getBuildingsReport(viewer: ReportViewer): Promise<ReportRead<BuildingsData>> {
  return withOrgContext(viewer.personId, viewer.organizationId, (tx) => readBuildingsReport(tx, viewer));
}

/** One transaction: the page's read, the CSV from its data, then the audit row. */
export function exportBuildingsReport(viewer: ReportViewer): Promise<ReportExport> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx): Promise<ReportExport> => {
    const read = await readBuildingsReport(tx, viewer);
    if (read.kind === "forbidden") return { kind: "forbidden" };
    const csv = buildBuildingsCsv(read.data);
    const rowCount = read.data.rows.length;
    await auditReportExport(tx, viewer, { report: "buildings", rowCount });
    return { kind: "ok", csv, rowCount, filenameBase: REPORT.filenameBase };
  });
}
