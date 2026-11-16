import { FormattedDate } from "@/components/shared/formatted-date";
import { ExportButton } from "@/components/presbytery-reports/export-button";
import { ReportFrame } from "@/components/presbytery-reports/report-frame";
import { ReportLoadError } from "@/components/presbytery-reports/report-states";
import { VacantPulpitsView } from "@/components/presbytery-reports/vacant-pulpits-view";
import { helpHref } from "@/lib/help/urls";
import { FRAME_COPY, VACANT_COPY } from "@/lib/presbytery-reports/copy";
import { gateReportPage, runReportRead } from "@/lib/presbytery-reports/gate";
import { getVacantPulpits } from "@/lib/presbytery-reports/vacant-pulpits";
import { ReportGateStateView } from "../report-gate-state";
import { ReportsSectionForbidden } from "../reports-states";

/**
 * `/o/<slug>/admin/reports/vacant-pulpits` (docs/work-log/2026-11-15-presbytery-reports.md).
 * The gate first (session, second-factor recheck, the four-way org miss, flag,
 * organization type); the `credentials.manage` key is checked inside the
 * reader's own transaction. No `loading.tsx` here or anywhere under `reports/`:
 * a Suspense boundary would turn a `notFound()` into a 404 served at HTTP 200.
 */
export default async function VacantPulpitsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/reports/vacant-pulpits`;

  const gate = await gateReportPage({ slug, path });
  if (!gate.ok) return <ReportGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const read = await runReportRead(() => getVacantPulpits(identity));
  const frame = {
    slug,
    title: VACANT_COPY.title,
    helpHref: helpHref("presbytery-reports", "vacant-pulpits"),
    helpLabel: VACANT_COPY.helpLink,
  };

  if (read.kind === "error") {
    return (
      <ReportFrame {...frame} subtitle={identity.organizationName}>
        <ReportLoadError retryHref={path} />
      </ReportFrame>
    );
  }
  if (read.kind === "forbidden") {
    return (
      <ReportFrame {...frame} subtitle={identity.organizationName}>
        <ReportsSectionForbidden section="credentials" name={identity.organizationName} />
      </ReportFrame>
    );
  }

  const data = read.data;
  const exportable = data.appointmentsRecorded && data.rows.length > 0;
  return (
    <ReportFrame
      {...frame}
      subtitle={
        <>
          {VACANT_COPY.subtitleLead(identity.organizationName)} <FormattedDate value={data.today} mode="date" />.
        </>
      }
      notes={data.rosterCount > 0 && data.appointmentsRecorded ? [VACANT_COPY.note1, VACANT_COPY.note2] : []}
      actions={exportable ? <ExportButton href={`${path}/export`} label={FRAME_COPY.exportCsv} /> : undefined}
    >
      <VacantPulpitsView data={data} slug={slug} />
    </ReportFrame>
  );
}
