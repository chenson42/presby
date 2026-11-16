import "server-only";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { fetchAffiliationWindows, fetchStatisticsForYears } from "@/lib/presbytery";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { auditReportExport } from "./audit";
import { reportByKey, type ReportExport, type ReportRead, type ReportViewer } from "./contract";
import { buildMembershipTrendCsv } from "./csv";
import { deriveMembershipTrend, type MembershipTrendData, type TrendStatFact } from "./derive";
import { readRoster } from "./roster";

const REPORT = reportByKey("membership_trend");

export interface MembershipTrendParams {
  from: number;
  to: number;
}

/**
 * The trend read: the roster, the affiliation windows (the public view, through
 * the existing reader - no second affiliation reader), and ONE multi-year
 * statistics query through `fetchStatisticsForYears`, the single definition of
 * the coalesce. It never loops over years and never re-picks.
 */
export async function readMembershipTrend(
  tx: OrgTx,
  viewer: ReportViewer,
  params: MembershipTrendParams,
): Promise<ReportRead<MembershipTrendData>> {
  const [held] = await holdsPermissions(tx, viewer, [REPORT.permission]);
  if (!held) return { kind: "forbidden" };

  const roster = await readRoster(tx, viewer.organizationId);
  if (roster.length === 0) {
    return { kind: "ok", data: deriveMembershipTrend([], new Map(), new Map(), params.from, params.to) };
  }

  const [windows, stored] = await Promise.all([
    fetchAffiliationWindows(tx, viewer.organizationId),
    fetchStatisticsForYears(tx, viewer.organizationId, params.from, params.to),
  ]);
  const statistics = new Map<number, Map<string, TrendStatFact>>();
  for (const [year, byOrg] of stored) {
    const facts = new Map<string, TrendStatFact>();
    for (const [orgId, row] of byOrg) {
      facts.set(orgId, { endingActive: row.endingActive, provenance: row.provenance });
    }
    statistics.set(year, facts);
  }
  return { kind: "ok", data: deriveMembershipTrend(roster, windows, statistics, params.from, params.to) };
}

export function getMembershipTrend(
  viewer: ReportViewer,
  params: MembershipTrendParams,
): Promise<ReportRead<MembershipTrendData>> {
  return withOrgContext(viewer.personId, viewer.organizationId, (tx) => readMembershipTrend(tx, viewer, params));
}

/** One transaction: the page's read, the CSV from its data, then the audit row. */
export function exportMembershipTrend(viewer: ReportViewer, params: MembershipTrendParams): Promise<ReportExport> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx): Promise<ReportExport> => {
    const read = await readMembershipTrend(tx, viewer, params);
    if (read.kind === "forbidden") return { kind: "forbidden" };
    const csv = buildMembershipTrendCsv(read.data);
    // One file row per congregation-year inside that congregation's window.
    const rowCount = read.data.rows.reduce((n, row) => n + row.cells.filter((c) => c.kind !== "not_member").length, 0);
    await auditReportExport(tx, viewer, {
      report: "membership_trend",
      rowCount,
      fromYear: params.from,
      toYear: params.to,
    });
    return { kind: "ok", csv, rowCount, filenameBase: REPORT.filenameBase };
  });
}
