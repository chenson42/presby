import { exportMembershipTrend } from "@/lib/presbytery-reports/membership-trend";
import { respondWithExport, gateReportRoute, reportText } from "@/lib/presbytery-reports/gate";
import { ROUTE_COPY } from "@/lib/presbytery-reports/copy";
import { parseTrendWindow, rawParam } from "@/lib/presbytery-reports/params";

/**
 * `GET /o/<slug>/admin/reports/membership-trend/export[?from&to]` - the
 * long-form trend CSV. A bad year or window is a 400, answered only AFTER the
 * organization-level gate (so probing an organization learns nothing from it);
 * the `statistics.manage` key is re-checked inside `exportMembershipTrend`.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const gate = await gateReportRoute({ request, slug });
  if (!gate.ok) return gate.response;

  const search = new URL(request.url).searchParams;
  const window = parseTrendWindow(rawParam(search, "from"), rawParam(search, "to"), new Date());
  if (!window.ok) return reportText(400, ROUTE_COPY.invalidYear);

  try {
    return respondWithExport(await exportMembershipTrend(gate, window.value), slug);
  } catch {
    return reportText(503, ROUTE_COPY.exportFailed);
  }
}
