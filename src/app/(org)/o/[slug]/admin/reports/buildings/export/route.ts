import { exportBuildingsReport } from "@/lib/presbytery-reports/buildings";
import { respondWithExport, gateReportRoute, reportText } from "@/lib/presbytery-reports/gate";
import { ROUTE_COPY } from "@/lib/presbytery-reports/copy";

/**
 * `GET /o/<slug>/admin/reports/buildings/export` - the Buildings CSV. Same shape as
 * the viability route: shared gate, then `exportBuildingsReport` (the
 * `congregation_oversight.manage` key re-checked inside its transaction, the file and
 * the audit row written in it; DECISION-339, 348). No street address and no note is in
 * the file.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const gate = await gateReportRoute({ request, slug });
  if (!gate.ok) return gate.response;

  try {
    return respondWithExport(await exportBuildingsReport(gate), slug);
  } catch {
    return reportText(503, ROUTE_COPY.exportFailed);
  }
}
