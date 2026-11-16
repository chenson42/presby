import { ExportButton } from "@/components/presbytery-reports/export-button";
import { ReportFrame } from "@/components/presbytery-reports/report-frame";
import { ReportLoadError } from "@/components/presbytery-reports/report-states";
import { ViabilityView } from "@/components/presbytery-reports/viability-view";
import { helpHref } from "@/lib/help/urls";
import { FRAME_COPY, VIABILITY_COPY } from "@/lib/presbytery-reports/copy";
import { gateReportPage, runReportRead } from "@/lib/presbytery-reports/gate";
import { getViability } from "@/lib/presbytery-reports/viability";
import { ReportGateStateView } from "../report-gate-state";
import { ReportsSectionForbidden } from "../reports-states";

/**
 * `/o/<slug>/admin/reports/viability`. The gate first; the
 * `congregation_oversight.manage` key is checked inside the reader's own
 * transaction. No `loading.tsx` anywhere under `reports/`.
 */
export default async function ViabilityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/reports/viability`;

  const gate = await gateReportPage({ slug, path });
  if (!gate.ok) return <ReportGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const read = await runReportRead(() => getViability(identity));
  const frame = {
    slug,
    title: VIABILITY_COPY.title,
    subtitle: VIABILITY_COPY.subtitle(identity.organizationName),
    helpHref: helpHref("presbytery-reports", "viability"),
    helpLabel: VIABILITY_COPY.helpLink,
  };

  if (read.kind === "error") {
    return (
      <ReportFrame {...frame}>
        <ReportLoadError retryHref={path} />
      </ReportFrame>
    );
  }
  if (read.kind === "forbidden") {
    return (
      <ReportFrame {...frame}>
        <ReportsSectionForbidden section="congregation oversight" name={identity.organizationName} />
      </ReportFrame>
    );
  }

  return (
    <ReportFrame
      {...frame}
      actions={
        read.data.rows.length > 0 ? <ExportButton href={`${path}/export`} label={FRAME_COPY.exportCsv} /> : undefined
      }
    >
      <ViabilityView data={read.data} slug={slug} />
    </ReportFrame>
  );
}
