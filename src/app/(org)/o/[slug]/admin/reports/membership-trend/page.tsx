import { ExportButton } from "@/components/presbytery-reports/export-button";
import { MembershipTrendView } from "@/components/presbytery-reports/membership-trend-view";
import { ReportFrame } from "@/components/presbytery-reports/report-frame";
import { ReportLoadError } from "@/components/presbytery-reports/report-states";
import { YearNav } from "@/components/presbytery-reports/year-nav";
import { helpHref } from "@/lib/help/urls";
import { FRAME_COPY, TREND_COPY } from "@/lib/presbytery-reports/copy";
import { gateReportPage, runReportRead } from "@/lib/presbytery-reports/gate";
import { getMembershipTrend } from "@/lib/presbytery-reports/membership-trend";
import { YEAR_MAX, YEAR_MIN, defaultTrendWindow, parseTrendWindow } from "@/lib/presbytery-reports/params";
import { ReportGateStateView } from "../report-gate-state";
import { ReportsSectionForbidden } from "../reports-states";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `/o/<slug>/admin/reports/membership-trend[?from&to]`. The gate first; the
 * `statistics.manage` key is checked inside the reader's own transaction. An
 * invalid `from`/`to` falls back to the default window (the export route
 * answers 400 for the same input). No `loading.tsx` anywhere under `reports/`.
 */
export default async function MembershipTrendPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const now = new Date();
  const parsed = parseTrendWindow(query.from, query.to, now);
  const window = parsed.ok ? parsed.value : defaultTrendWindow(now);
  const path = `/o/${slug}/admin/reports/membership-trend?from=${window.from}&to=${window.to}`;

  const gate = await gateReportPage({ slug, path });
  if (!gate.ok) return <ReportGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const read = await runReportRead(() => getMembershipTrend(identity, window));
  const frame = {
    slug,
    title: TREND_COPY.title,
    subtitle: TREND_COPY.subtitle(identity.organizationName, window.from, window.to),
    helpHref: helpHref("presbytery-reports", "membership-trend"),
    helpLabel: TREND_COPY.helpLink,
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
        <ReportsSectionForbidden section="statistics" name={identity.organizationName} />
      </ReportFrame>
    );
  }

  const span = window.to - window.from + 1;
  const base = `/o/${slug}/admin/reports/membership-trend`;
  const earlier = window.from - span >= YEAR_MIN ? { from: window.from - span, to: window.to - span } : null;
  const later = window.to + span <= YEAR_MAX ? { from: window.from + span, to: window.to + span } : null;

  return (
    <ReportFrame
      {...frame}
      notes={read.data.rosterCount > 0 ? [TREND_COPY.note1(identity.organizationName), TREND_COPY.note2] : []}
      nav={
        <YearNav
          ariaLabel={TREND_COPY.title}
          label={TREND_COPY.windowLabel(window.from, window.to)}
          prev={earlier ? { href: `${base}?from=${earlier.from}&to=${earlier.to}`, text: `‹ ${TREND_COPY.earlier}` } : null}
          next={later ? { href: `${base}?from=${later.from}&to=${later.to}`, text: `${TREND_COPY.later} ›` } : null}
        />
      }
      actions={
        read.data.hasData ? (
          <ExportButton href={`${base}/export?from=${window.from}&to=${window.to}`} label={FRAME_COPY.exportCsv} />
        ) : undefined
      }
    >
      <MembershipTrendView data={read.data} slug={slug} />
    </ReportFrame>
  );
}
