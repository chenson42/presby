import "server-only";
import { withOrgContext } from "@/lib/authz";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { REPORTS, type ReportKey, type ReportViewer } from "./contract";

/**
 * The reports hub's lock state: one `presby_has_permission` read per report key,
 * inside one transaction, live (never the session). It reveals which cards are
 * locked and nothing else - never a row of data.
 */
export async function getReportsHub(viewer: ReportViewer): Promise<{ held: Record<ReportKey, boolean> }> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    const flags = await holdsPermissions(
      tx,
      viewer,
      REPORTS.map((r) => r.permission),
    );
    const held = Object.fromEntries(REPORTS.map((r, i) => [r.key, flags[i] === true])) as Record<ReportKey, boolean>;
    return { held };
  });
}
