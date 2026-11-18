import { ExportButton } from "@/components/presbytery-reports/export-button";
import { InsuranceLoansView } from "@/components/presbytery-reports/insurance-loans-view";
import { ReportFrame } from "@/components/presbytery-reports/report-frame";
import { ReportLoadError } from "@/components/presbytery-reports/report-states";
import { helpHref } from "@/lib/help/urls";
import { FRAME_COPY, INSURANCE_LOANS_COPY } from "@/lib/presbytery-reports/copy";
import { gateReportPage, runReportRead } from "@/lib/presbytery-reports/gate";
import { getInsuranceLoans } from "@/lib/presbytery-reports/insurance-loans";
import { ReportGateStateView } from "../report-gate-state";
import { ReportsSectionForbidden } from "../reports-states";

/**
 * `/o/<slug>/admin/reports/insurance-and-loans`. The gate first; the
 * `congregation_oversight.finance` key (tier 2) is checked inside the reader's own
 * transaction. No query parameter, and no `loading.tsx` anywhere under `reports/`.
 */
export default async function InsuranceAndLoansPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/reports/insurance-and-loans`;

  const gate = await gateReportPage({ slug, path });
  if (!gate.ok) return <ReportGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const read = await runReportRead(() => getInsuranceLoans(identity));
  const frame = {
    slug,
    title: INSURANCE_LOANS_COPY.title,
    subtitle: INSURANCE_LOANS_COPY.subtitle(identity.organizationName),
    notes: [INSURANCE_LOANS_COPY.rosterNote, INSURANCE_LOANS_COPY.newestNote, INSURANCE_LOANS_COPY.fileNote],
    helpHref: helpHref("presbytery-reports", "insurance-and-loans"),
    helpLabel: INSURANCE_LOANS_COPY.helpLink,
  };

  if (read.kind === "error") {
    return (
      <ReportFrame {...frame} notes={[]}>
        <ReportLoadError retryHref={path} />
      </ReportFrame>
    );
  }
  if (read.kind === "forbidden") {
    return (
      <ReportFrame {...frame} notes={[]}>
        <ReportsSectionForbidden section="congregation property finances" name={identity.organizationName} />
      </ReportFrame>
    );
  }

  return (
    <ReportFrame
      {...frame}
      actions={read.data.rosterCount > 0 ? <ExportButton href={`${path}/export`} label={FRAME_COPY.exportCsv} /> : undefined}
    >
      <InsuranceLoansView data={read.data} />
    </ReportFrame>
  );
}
