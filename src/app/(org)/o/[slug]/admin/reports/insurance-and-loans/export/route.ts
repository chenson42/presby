import { exportInsuranceLoans } from "@/lib/presbytery-reports/insurance-loans";
import { respondWithExport, gateReportRoute, reportText } from "@/lib/presbytery-reports/gate";
import { ROUTE_COPY } from "@/lib/presbytery-reports/copy";

/**
 * `GET /o/<slug>/admin/reports/insurance-and-loans/export` - the Insurance and loans
 * CSV. Same shape as the viability route: shared gate (which includes the Node-side
 * second-factor recheck the finance key's holders are under), then `exportInsuranceLoans`
 * (the `congregation_oversight.finance` key re-checked inside its transaction before any
 * row is read, the file and the audit row written in it; DECISION-339, 348). No policy
 * number, lender, street address or note is in the file.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const gate = await gateReportRoute({ request, slug });
  if (!gate.ok) return gate.response;

  try {
    return respondWithExport(await exportInsuranceLoans(gate), slug);
  } catch {
    return reportText(503, ROUTE_COPY.exportFailed);
  }
}
