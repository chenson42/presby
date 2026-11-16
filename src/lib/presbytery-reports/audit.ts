import "server-only";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import type { OrgTx } from "@/lib/authz";
import type { ReportAuditMetadata, ReportViewer } from "./contract";

/**
 * The export's audit row (DECISION-339): written by `insertAuditRow` INSIDE the
 * export's own read transaction, so a failed insert rolls the read back and the
 * route sends no file. Not `recordAudit()`, which opens its own connection and
 * swallows failures. `check:audit` scans only `actions.ts`, so
 * `boundaries.test.ts` pins that every `export*` function calls this and that
 * nothing in the module calls `recordAudit`.
 *
 * The metadata type admits the report key, the row count and the year or
 * window - never a congregation name, a note or an amount.
 */
export async function auditReportExport(
  tx: OrgTx,
  viewer: ReportViewer,
  metadata: Omit<ReportAuditMetadata, "organizationId">,
): Promise<void> {
  await insertAuditRow(tx, {
    action: AUDIT_ACTIONS.PRESBYTERY_REPORT_EXPORTED,
    actor: { userId: viewer.userId, email: viewer.email },
    resourceType: "presbytery_report",
    resourceId: viewer.organizationId,
    metadata: { organizationId: viewer.organizationId, ...metadata },
  });
}
