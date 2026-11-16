import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { appointments } from "@/lib/db/domain/officers";
import { orgTimeZoneInTx } from "@/lib/org-settings";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { todayInOrgZone } from "@/lib/shared/org-time";
import { auditReportExport } from "./audit";
import { reportByKey, type ReportExport, type ReportRead, type ReportViewer } from "./contract";
import { buildVacantPulpitsCsv } from "./csv";
import { deriveVacantPulpits, type VacantPulpitsData } from "./derive";
import { readRoster } from "./roster";

const REPORT = reportByKey("vacant_pulpits");

/**
 * The vacant pulpits read: the key first (live `presby_has_permission` inside
 * this transaction, never the session), then the roster, then this
 * presbytery's own appointments that serve it. No person column is selected,
 * so the report carries call types and dates and never a minister's name.
 * `now` is injectable so the in-force boundaries are tested without a clock.
 */
export async function readVacantPulpits(
  tx: OrgTx,
  viewer: ReportViewer,
  now: Date = new Date(),
): Promise<ReportRead<VacantPulpitsData>> {
  const [held] = await holdsPermissions(tx, viewer, [REPORT.permission]);
  if (!held) return { kind: "forbidden" };

  const roster = await readRoster(tx, viewer.organizationId);
  const today = todayInOrgZone(now, await orgTimeZoneInTx(tx, viewer.organizationId));
  if (roster.length === 0) {
    return { kind: "ok", data: { today, rosterCount: 0, appointmentsRecorded: false, rows: [] } };
  }

  const facts = await tx
    .select({
      id: appointments.id,
      servingOrgId: appointments.servingOrgId,
      callType: appointments.callType,
      startsOn: appointments.startsOn,
      endsOn: appointments.endsOn,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.organizationId, viewer.organizationId),
        inArray(
          appointments.servingOrgId,
          roster.map((r) => r.id),
        ),
      ),
    );
  return { kind: "ok", data: deriveVacantPulpits(roster, facts, today) };
}

/** The page entry. */
export function getVacantPulpits(viewer: ReportViewer, now?: Date): Promise<ReportRead<VacantPulpitsData>> {
  return withOrgContext(viewer.personId, viewer.organizationId, (tx) => readVacantPulpits(tx, viewer, now));
}

/**
 * The route entry: ONE transaction - the same `readVacantPulpits` the page
 * runs, the CSV built from its data, then the audit row. A zero-appointment
 * presbytery has nothing honest to export (the list is not shown), so it is
 * `nothing_to_export` with no audit row.
 */
export function exportVacantPulpits(viewer: ReportViewer, now?: Date): Promise<ReportExport> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx): Promise<ReportExport> => {
    const read = await readVacantPulpits(tx, viewer, now);
    if (read.kind === "forbidden") return { kind: "forbidden" };
    if (!read.data.appointmentsRecorded) return { kind: "nothing_to_export" };
    const csv = buildVacantPulpitsCsv(read.data);
    const rowCount = read.data.rows.length;
    await auditReportExport(tx, viewer, { report: "vacant_pulpits", rowCount });
    return { kind: "ok", csv, rowCount, filenameBase: REPORT.filenameBase };
  });
}
