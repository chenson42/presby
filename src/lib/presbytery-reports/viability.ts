import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { congregationOversight } from "@/lib/db/domain/presbytery";
import { orgTimeZoneInTx } from "@/lib/org-settings";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { auditReportExport } from "./audit";
import { reportByKey, type ReportExport, type ReportRead, type ReportViewer } from "./contract";
import { buildViabilityCsv } from "./csv";
import { deriveViability, type ViabilityData } from "./derive";
import { readRoster } from "./roster";

const REPORT = reportByKey("viability");

/**
 * The viability read. The select list names the score, the redevelopment notes
 * and the update time only: buildings, insurance and coordinates are never
 * read. `last_updated` is a calendar date in the organization's time zone
 * (`updated_at` is a real instant).
 */
export async function readViability(tx: OrgTx, viewer: ReportViewer): Promise<ReportRead<ViabilityData>> {
  const [held] = await holdsPermissions(tx, viewer, [REPORT.permission]);
  if (!held) return { kind: "forbidden" };

  const roster = await readRoster(tx, viewer.organizationId);
  if (roster.length === 0) return { kind: "ok", data: deriveViability([], []) };

  const timeZone = await orgTimeZoneInTx(tx, viewer.organizationId);
  const facts = await tx
    .select({
      aboutOrgId: congregationOversight.aboutOrgId,
      viabilityScore: congregationOversight.viabilityScore,
      redevelopmentNotes: congregationOversight.redevelopmentNotes,
      updatedOn: sql<string>`to_char(${congregationOversight.updatedAt} at time zone ${timeZone}::text, 'YYYY-MM-DD')`,
    })
    .from(congregationOversight)
    .where(
      and(
        eq(congregationOversight.organizationId, viewer.organizationId),
        inArray(
          congregationOversight.aboutOrgId,
          roster.map((r) => r.id),
        ),
      ),
    );
  return { kind: "ok", data: deriveViability(roster, facts) };
}

export function getViability(viewer: ReportViewer): Promise<ReportRead<ViabilityData>> {
  return withOrgContext(viewer.personId, viewer.organizationId, (tx) => readViability(tx, viewer));
}

/** One transaction: the page's read, the CSV from its data, then the audit row. */
export function exportViability(viewer: ReportViewer): Promise<ReportExport> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx): Promise<ReportExport> => {
    const read = await readViability(tx, viewer);
    if (read.kind === "forbidden") return { kind: "forbidden" };
    const csv = buildViabilityCsv(read.data);
    const rowCount = read.data.rows.length;
    await auditReportExport(tx, viewer, { report: "viability", rowCount });
    return { kind: "ok", csv, rowCount, filenameBase: REPORT.filenameBase };
  });
}
