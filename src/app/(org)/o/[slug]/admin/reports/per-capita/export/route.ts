import { exportPerCapita, type PerCapitaParams } from "@/lib/presbytery-reports/per-capita";
import { respondWithExport, gateReportRoute, reportText } from "@/lib/presbytery-reports/gate";
import { ROUTE_COPY } from "@/lib/presbytery-reports/copy";
import { parseAllYears, parseBillingYear, rawParam } from "@/lib/presbytery-reports/params";

/**
 * `GET /o/<slug>/admin/reports/per-capita/export[?billingYear=YYYY | ?allYears=1]`
 * - the per-capita CSV (a tier-2 read). `allYears` and `billingYear` together
 * are a 400, as is any invalid value, answered only AFTER the organization-level
 * gate; the `per_capita.manage` key is re-checked inside `exportPerCapita`.
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
  const allYears = parseAllYears(rawParam(search, "allYears"));
  if (!allYears.ok) return reportText(400, ROUTE_COPY.invalidLink);

  let exportParams: PerCapitaParams;
  if (allYears.value) {
    if (rawParam(search, "billingYear") !== undefined) return reportText(400, ROUTE_COPY.invalidLink);
    exportParams = { kind: "all" };
  } else {
    const year = parseBillingYear(rawParam(search, "billingYear"), new Date());
    if (!year.ok) return reportText(400, ROUTE_COPY.invalidYear);
    exportParams = { kind: "year", billingYear: year.value };
  }

  try {
    return respondWithExport(await exportPerCapita(gate, exportParams), slug);
  } catch {
    return reportText(503, ROUTE_COPY.exportFailed);
  }
}
