import { exportVacantPulpits } from "@/lib/presbytery-reports/vacant-pulpits";
import { respondWithExport, gateReportRoute, reportText } from "@/lib/presbytery-reports/gate";
import { ROUTE_COPY } from "@/lib/presbytery-reports/copy";

/**
 * `GET /o/<slug>/admin/reports/vacant-pulpits/export` - the vacant pulpits CSV
 * (docs/work-log/2026-11-15-presbytery-reports.md, Phase 3 "Export routes").
 * `gateReportRoute` runs the shared gate; `exportVacantPulpits` re-checks the
 * `credentials.manage` key inside its own transaction, builds the file from the
 * very read the page runs, and writes the audit row in that same transaction
 * (DECISION-339), so a failed audit insert sends no file (503).
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const gate = await gateReportRoute({ request, slug });
  if (!gate.ok) return gate.response;

  try {
    return respondWithExport(await exportVacantPulpits(gate), slug);
  } catch {
    return reportText(503, ROUTE_COPY.exportFailed);
  }
}
