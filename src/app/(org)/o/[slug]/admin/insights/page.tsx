import Link from "next/link";
import { ComingSoon, PlaceholderFlagOff } from "@/components/org-portal/coming-soon";
import { DashboardView } from "@/components/presbytery-reports/dashboard-cards";
import { isFlagEnabled } from "@/lib/flags";
import { helpHref } from "@/lib/help/urls";
import { CREDENTIALS_FLAG, OVERSIGHT_FLAG, REPORTS_FLAG } from "@/lib/presbytery-reports/contract";
import { DASHBOARD_COPY } from "@/lib/presbytery-reports/copy";
import { getPresbyteryDashboard } from "@/lib/presbytery-reports/dashboard";
import { gateInsightsPage } from "@/lib/presbytery-reports/gate";
import { defaultBillingYear } from "@/lib/presbytery-reports/params";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";

const AREA = "Insights & Analytics";
const DESCRIPTION =
  "Dashboards, trends, and per-capita/membership insights — universal across every organization type, planned but not yet built.";

/**
 * `/o/<slug>/admin/insights` - a presbytery's read-only dashboard (Increment 4b,
 * slice one, DECISION-342, docs/work-log/2026-11-17-presbytery-dashboard.md):
 * four summary cards over the shipped presbytery reports and the viability list.
 * Every other organization type keeps the inert "coming soon" stub
 * (DECISION-117) with no data read.
 *
 * THE GATE is `gateInsightsPage` (and never `gateReportPage`; `boundaries.test.ts`
 * pins both directions): signed in, the Node-side second-factor recheck, the
 * four-way org miss (DECISION-040), `assertOrgAccess`, the global
 * `org_portal.insights` flag (checked BEFORE the type, so a congregation with
 * insights off still sees "isn't turned on"), then the presbytery type. Each
 * card's authority is its own report's key, checked live inside its own reader's
 * transaction by `getPresbyteryDashboard`; this page decides nothing about keys.
 *
 * Read-only: no form, no action, no export, no audit event (DECISION-339 audits
 * exports only). No query parameter is read: the years are the reports' own
 * defaults, printed on each card and carried explicitly in each link. The
 * reports, oversight and credentials flags are read with the bare
 * `isFlagEnabled` ONLY to decide whether a card or a row is a link; they gate
 * nothing (DECISION-003). No `loading.tsx` may exist under this segment: the
 * gate calls `notFound()` and `redirect()`.
 *
 * The dashboard is computed as a plain value BEFORE the `return`, never as a
 * nested async component (the reports hub's rule), so a Testing Library render
 * sees the same tree a request does. An `OrgAccessError` propagates to
 * `[slug]/error.tsx`.
 */
export default async function InsightsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/insights`;

  const gate = await gateInsightsPage({ slug, path });
  if (!gate.ok) {
    const { state } = gate;
    switch (state.kind) {
      case "org_forbidden":
        return <OrgAccessDenied name={state.name} organizationType={state.organizationType} slug={slug} />;
      case "org_ended":
        return <OrgAccessEnded name={state.name} endedOn={state.endedOn} slug={slug} />;
      case "flag_off":
        return <PlaceholderFlagOff area={AREA} orgName={state.name} />;
      case "not_applicable":
        return <ComingSoon area={AREA} description={DESCRIPTION} slug={slug} />;
    }
  }
  const { identity } = gate;

  const now = new Date();
  const [dashboard, reportsOn, oversightOn, credentialsOn] = await Promise.all([
    getPresbyteryDashboard(identity, now),
    isFlagEnabled(REPORTS_FLAG),
    isFlagEnabled(OVERSIGHT_FLAG),
    isFlagEnabled(CREDENTIALS_FLAG),
  ]);

  return (
    <section className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{DASHBOARD_COPY.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{DASHBOARD_COPY.subtitle(identity.organizationName)}</p>
      </div>

      <DashboardView
        dashboard={dashboard}
        org={identity.organizationName}
        slug={slug}
        flags={{ reportsOn, oversightOn, credentialsOn }}
        retryHref={path}
        billingYear={defaultBillingYear(now)}
      />

      <p className="text-sm">
        <Link
          href={helpHref("presbytery-reports", "insights-and-analytics")}
          className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
        >
          {DASHBOARD_COPY.helpLink}
        </Link>
      </p>
    </section>
  );
}
