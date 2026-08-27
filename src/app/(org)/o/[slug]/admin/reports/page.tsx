import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
  type OrganizationType,
} from "@/lib/authz";
import {
  getCongregationStatisticsRollup,
  getPerCapitaOverview,
} from "@/lib/presbytery";
import { isFlagEnabled } from "@/lib/flags";
import {
  PlaceholderFlagOff,
  PlaceholderNotAvailable,
} from "@/components/org-portal/coming-soon";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { ReportsSectionForbidden, ReportsSectionLoadError } from "./reports-states";
import { StatisticsTable } from "./statistics-table";
import { StatisticsForm } from "./statistics-form";
import { PerCapitaRateForm } from "./per-capita-rate-form";
import { GenerateRecordsButton } from "./generate-records-button";
import { PerCapitaRecordsTable } from "./per-capita-records-table";
import { RecordPaymentForm } from "./record-payment-form";

const REPORTS_FLAG = "org_portal.reports";
const AREA = "Per-Capita, SASR & Imports";
const REPORTS_ORG_TYPES: readonly OrganizationType[] = ["presbytery"];

function yearLink(slug: string, params: Record<string, number>): string {
  const search = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  );
  return `/o/${slug}/admin/reports?${search.toString()}`;
}

/**
 * `/o/<slug>/admin/reports` — Presbytery program Increment 3b Phase 3
 * design (`docs/work-log/2026-08-27-presbytery-program.md`). Replaces the
 * product-IA scaffold's `ComingSoon` body with TWO sections — "Congregation
 * Statistics" and "Per-Capita" — sharing one flag (`org_portal.reports`,
 * reused verbatim) but gated by TWO INDEPENDENT permissions
 * (`statistics.manage`, `per_capita.manage`): each section renders its own
 * forbidden/load-error state rather than assuming one denial covers both
 * (`reports-states.tsx`'s header).
 *
 * TWO YEAR CONCEPTS, TWO QUERY PARAMS: `?year=` (statistics, defaults to
 * last calendar year — the annual report you'd be filing mid-this-year) and
 * `?billingYear=` (per-capita, defaults to the current year, matching
 * Operator Answer 1's arrears practice where the CURRENT year is billed off
 * `year - 2` data). Plain `<Link>` prev/next navigation, no client state —
 * same server-rendered-by-query-param shape the rest of this tree uses for
 * paginated/filtered lists.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string; billingYear?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/reports`)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied
          name={resolved.name}
          organizationType={resolved.organizationType}
          slug={slug}
        />
      );
    case "ended":
      return (
        <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const reportsEnabled = await isFlagEnabled(REPORTS_FLAG);
  if (!reportsEnabled) {
    return <PlaceholderFlagOff area={AREA} orgName={resolved.org.name} />;
  }

  if (!REPORTS_ORG_TYPES.includes(resolved.org.organizationType)) {
    return <PlaceholderNotAvailable area={AREA} orgName={resolved.org.name} />;
  }

  const now = new Date();
  const clampYear = (value: number) => Math.min(2100, Math.max(1900, Math.trunc(value)));
  const statsYear = Number.isFinite(Number(query.year))
    ? clampYear(Number(query.year))
    : now.getFullYear() - 1;
  const billingYear = Number.isFinite(Number(query.billingYear))
    ? clampYear(Number(query.billingYear))
    : now.getFullYear();

  // BOTH SECTIONS' JSX IS COMPUTED HERE, BEFORE THE RETURN — never as a
  // nested async component. React's client renderer (and this file's own
  // `page.test.tsx`, which renders the returned element tree directly with
  // Testing Library) has no built-in support for an async function
  // component the way the RSC server pipeline does; awaiting each section's
  // helper function to a plain JSX value and interpolating the RESULT keeps
  // this page renderable the same way in both a real request and a test,
  // same shape `admin/credentials/page.tsx` uses for its own three
  // sequential reads.
  const statisticsSection = await renderStatisticsSection({
    slug,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    orgName: resolved.org.name,
    year: statsYear,
  });

  const perCapitaSection = await renderPerCapitaSection({
    slug,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    orgName: resolved.org.name,
    billingYear,
  });

  return (
    <section className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">{AREA}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{resolved.org.name}</p>
      </div>

      {statisticsSection}
      {perCapitaSection}
    </section>
  );
}

async function renderStatisticsSection({
  slug,
  personId,
  organizationId,
  orgName,
  year,
}: {
  slug: string;
  personId: string;
  organizationId: string;
  orgName: string;
  year: number;
}) {
  let result;
  try {
    result = await getCongregationStatisticsRollup(personId, organizationId, year);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Congregation Statistics</h2>
        <ReportsSectionLoadError slug={slug} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Congregation Statistics</h2>
        <div className="flex items-center gap-3 text-sm">
          <Link href={yearLink(slug, { year: year - 1 })} className="text-primary underline-offset-4 hover:underline">
            ‹ {year - 1}
          </Link>
          <span className="font-medium">{year}</span>
          <Link href={yearLink(slug, { year: year + 1 })} className="text-primary underline-offset-4 hover:underline">
            {year + 1} ›
          </Link>
        </div>
      </div>

      {result.kind === "forbidden" ? (
        <ReportsSectionForbidden section="statistics" name={orgName} />
      ) : result.kind !== "ok" ? (
        <ReportsSectionLoadError slug={slug} />
      ) : (
        <>
          <StatisticsTable entries={result.data} />
          <div className="max-w-2xl space-y-4">
            <h3 className="text-lg font-semibold">Record statistics</h3>
            <StatisticsForm
              slug={slug}
              year={year}
              congregations={result.data.map((row) => ({
                organizationId: row.organizationId,
                name: row.name,
              }))}
            />
          </div>
        </>
      )}
    </section>
  );
}

async function renderPerCapitaSection({
  slug,
  personId,
  organizationId,
  orgName,
  billingYear,
}: {
  slug: string;
  personId: string;
  organizationId: string;
  orgName: string;
  billingYear: number;
}) {
  let result;
  try {
    result = await getPerCapitaOverview(personId, organizationId, billingYear);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Per-Capita</h2>
        <ReportsSectionLoadError slug={slug} />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Per-Capita</h2>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={yearLink(slug, { billingYear: billingYear - 1 })}
            className="text-primary underline-offset-4 hover:underline"
          >
            ‹ {billingYear - 1}
          </Link>
          <span className="font-medium">{billingYear}</span>
          <Link
            href={yearLink(slug, { billingYear: billingYear + 1 })}
            className="text-primary underline-offset-4 hover:underline"
          >
            {billingYear + 1} ›
          </Link>
        </div>
      </div>

      {result.kind === "forbidden" ? (
        <ReportsSectionForbidden section="per-capita billing" name={orgName} />
      ) : result.kind !== "ok" ? (
        <ReportsSectionLoadError slug={slug} />
      ) : (
        <>
          <div className="max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Rate</h3>
            <PerCapitaRateForm slug={slug} billingYear={billingYear} rate={result.data.rate} />
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold">Records</h3>
              <GenerateRecordsButton
                slug={slug}
                billingYear={billingYear}
                hasRate={result.data.rate !== null}
              />
            </div>
            <PerCapitaRecordsTable records={result.data.records} />
          </div>

          <div className="max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Record a payment</h3>
            <RecordPaymentForm slug={slug} records={result.data.records} />
          </div>
        </>
      )}
    </section>
  );
}
