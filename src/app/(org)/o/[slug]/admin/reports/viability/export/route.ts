import { exportViability } from "@/lib/presbytery-reports/viability";
import { respondWithExport, gateReportRoute, reportText } from "@/lib/presbytery-reports/gate";
import { ROUTE_COPY } from "@/lib/presbytery-reports/copy";

/**
 * `GET /o/<slug>/admin/reports/viability/export` - the viability CSV. Same
 * shape as the vacant pulpits route: shared gate, then `exportViability`
 * (the `congregation_oversight.manage` key re-checked inside its transaction,
 * the file and the audit row written in it; DECISION-339).
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
    return respondWithExport(await exportViability(gate), slug);
  } catch {
    return reportText(503, ROUTE_COPY.exportFailed);
  }
}
