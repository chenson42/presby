import { BuildingsView } from "@/components/presbytery-reports/buildings-view";
import { ExportButton } from "@/components/presbytery-reports/export-button";
import { ReportFrame } from "@/components/presbytery-reports/report-frame";
import { ReportLoadError } from "@/components/presbytery-reports/report-states";
import { helpHref } from "@/lib/help/urls";
import { getBuildingsReport } from "@/lib/presbytery-reports/buildings";
import { BUILDINGS_COPY, FRAME_COPY } from "@/lib/presbytery-reports/copy";
import { gateReportPage, runReportRead } from "@/lib/presbytery-reports/gate";
import { ReportGateStateView } from "../report-gate-state";
import { ReportsSectionForbidden } from "../reports-states";

/**
 * `/o/<slug>/admin/reports/buildings`. The gate first; the
 * `congregation_oversight.manage` key is checked inside the reader's own
 * transaction. No query parameter, and no `loading.tsx` anywhere under `reports/`.
 */
export default async function BuildingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/reports/buildings`;

  const gate = await gateReportPage({ slug, path });
  if (!gate.ok) return <ReportGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const read = await runReportRead(() => getBuildingsReport(identity));
  const frame = {
    slug,
    title: BUILDINGS_COPY.title,
    subtitle: BUILDINGS_COPY.subtitle(identity.organizationName),
    notes: [BUILDINGS_COPY.rosterNote, BUILDINGS_COPY.inUseNote, BUILDINGS_COPY.fileNote],
    helpHref: helpHref("presbytery-reports", "buildings"),
    helpLabel: BUILDINGS_COPY.helpLink,
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
        <ReportsSectionForbidden section="congregation oversight" name={identity.organizationName} />
      </ReportFrame>
    );
  }

  return (
    <ReportFrame
      {...frame}
      actions={read.data.rosterCount > 0 ? <ExportButton href={`${path}/export`} label={FRAME_COPY.exportCsv} /> : undefined}
    >
      <BuildingsView data={read.data} />
    </ReportFrame>
  );
}
