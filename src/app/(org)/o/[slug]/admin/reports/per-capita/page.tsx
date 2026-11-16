import { ExportButton } from "@/components/presbytery-reports/export-button";
import { PerCapitaView } from "@/components/presbytery-reports/per-capita-view";
import { ReportFrame } from "@/components/presbytery-reports/report-frame";
import { ReportLoadError } from "@/components/presbytery-reports/report-states";
import { YearNav } from "@/components/presbytery-reports/year-nav";
import { helpHref } from "@/lib/help/urls";
import { FRAME_COPY, PER_CAPITA_COPY } from "@/lib/presbytery-reports/copy";
import { gateReportPage, runReportRead } from "@/lib/presbytery-reports/gate";
import { YEAR_MAX, YEAR_MIN, parseBillingYear } from "@/lib/presbytery-reports/params";
import { getPerCapita } from "@/lib/presbytery-reports/per-capita";
import { ReportGateStateView } from "../report-gate-state";
import { ReportsSectionForbidden } from "../reports-states";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `/o/<slug>/admin/reports/per-capita[?billingYear]`. The gate first; the
 * `per_capita.manage` key is checked inside the reader's own transaction. An
 * invalid `billingYear` falls back to the current year (the export route
 * answers 400). No `loading.tsx` anywhere under `reports/`.
 */
export default async function PerCapitaReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const now = new Date();
  const parsed = parseBillingYear(query.billingYear, now);
  const billingYear = parsed.ok ? parsed.value : now.getUTCFullYear();
  const base = `/o/${slug}/admin/reports/per-capita`;
  const path = `${base}?billingYear=${billingYear}`;

  const gate = await gateReportPage({ slug, path });
  if (!gate.ok) return <ReportGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const read = await runReportRead(() => getPerCapita(identity, { kind: "year", billingYear }));
  const frame = {
    slug,
    title: PER_CAPITA_COPY.title,
    subtitle: PER_CAPITA_COPY.subtitle(identity.organizationName, billingYear),
    helpHref: helpHref("presbytery-reports", "per-capita"),
    helpLabel: PER_CAPITA_COPY.helpLink,
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
        <ReportsSectionForbidden section="per-capita billing" name={identity.organizationName} />
      </ReportFrame>
    );
  }

  const data = read.data;
  const actions = (
    <>
      {data.rows.length > 0 ? (
        <ExportButton href={`${base}/export?billingYear=${billingYear}`} label={FRAME_COPY.exportCsv} />
      ) : null}
      {data.anyBillsAnyYear ? <ExportButton href={`${base}/export?allYears=1`} label={FRAME_COPY.exportAllYears} /> : null}
    </>
  );

  return (
    <ReportFrame
      {...frame}
      notes={data.rows.length > 0 ? [PER_CAPITA_COPY.note] : []}
      nav={
        <YearNav
          ariaLabel={PER_CAPITA_COPY.title}
          label={String(billingYear)}
          prev={billingYear - 1 >= YEAR_MIN ? { href: `${base}?billingYear=${billingYear - 1}`, text: `‹ ${billingYear - 1}` } : null}
          next={billingYear + 1 <= YEAR_MAX ? { href: `${base}?billingYear=${billingYear + 1}`, text: `${billingYear + 1} ›` } : null}
        />
      }
      actions={data.rows.length > 0 || data.anyBillsAnyYear ? actions : undefined}
    >
      <PerCapitaView data={data} slug={slug} billingYear={billingYear} />
    </ReportFrame>
  );
}
