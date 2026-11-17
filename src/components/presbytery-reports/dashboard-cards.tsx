import type { ReactNode } from "react";
import Link from "next/link";
import { reportByKey } from "@/lib/presbytery-reports/contract";
import { DASHBOARD_COPY, PER_CAPITA_COPY, TREND_COPY, VACANT_COPY, formatCount, formatDollars } from "@/lib/presbytery-reports/copy";
import type { CardResult, PresbyteryDashboard } from "@/lib/presbytery-reports/dashboard";
import type { PerCapitaSummary, TrendSummary, VacantSummary } from "@/lib/presbytery-reports/dashboard-derive";
import { DashboardMap } from "./dashboard-map";
import { DashboardViabilitySection } from "./dashboard-viability";
import { CardError, CardLocked, DashboardEmpty, DashboardForbidden, DashboardPageError } from "./dashboard-states";

/**
 * The dashboard body (DECISION-342): four summary cards, the congregation map (DECISION-343,
 * absent unless the page passes one) and the viability list.
 * All Server Components. Every card is in exactly one of four states: a figure,
 * "nothing recorded yet" (in words, never a zero), locked, or a load error, and
 * a card never renders another card's state. A link to a report, to Credentials
 * or to an oversight page renders only where the target's own flag is on (the
 * three booleans), as nothing or plain text otherwise: a click must not land on
 * "isn't turned on". The flags are presentational and gate no data.
 */

export interface DashboardFlags {
  reportsOn: boolean;
  oversightOn: boolean;
  credentialsOn: boolean;
}

const LINK = "text-primary underline-offset-4 hover:underline";
const BLOCK_LINK = `inline-flex min-h-11 items-center ${LINK}`;

function Card({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId} className="min-w-0 space-y-3 rounded-lg border border-border p-4">
      <h2 className="break-words text-base font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Headline({ children }: { children: ReactNode }) {
  return <p className="break-words text-3xl font-semibold">{children}</p>;
}

function Line({ children }: { children: ReactNode }) {
  return <p className="break-words text-sm text-muted-foreground">{children}</p>;
}

function Action({ href, show, children }: { href: string; show: boolean; children: ReactNode }) {
  return show ? (
    <p className="text-sm">
      <Link href={href} className={BLOCK_LINK}>
        {children}
      </Link>
    </p>
  ) : null;
}

function lockedPhrase(key: Parameters<typeof reportByKey>[0]): string {
  return reportByKey(key).permissionPhrase;
}

export function MembersCard({
  roster,
  org,
  retryHref,
}: {
  roster: { kind: "ok"; count: number } | { kind: "error" };
  org: string;
  retryHref: string;
}) {
  return (
    <Card title={DASHBOARD_COPY.members.title} testId="dashboard-card-members">
      {roster.kind === "ok" ? (
        <>
          <Headline>{formatCount(roster.count)}</Headline>
          <Line>{DASHBOARD_COPY.members.note(org)}</Line>
        </>
      ) : (
        <CardError retryHref={retryHref} message={DASHBOARD_COPY.members.error} />
      )}
    </Card>
  );
}

function TrendBody({ summary, slug, reportsOn }: { summary: TrendSummary; slug: string; reportsOn: boolean }) {
  const trendHref = `/o/${slug}/admin/reports/membership-trend?from=${summary.from}&to=${summary.to}`;
  if (summary.kind === "none") {
    return (
      <>
        <Headline>{TREND_COPY.dash}</Headline>
        <Line>{TREND_COPY.nothing.title(summary.from, summary.to)}</Line>
        {reportsOn ? <Line>{TREND_COPY.nothing.body}</Line> : null}
        <Action href={`/o/${slug}/admin/reports`} show={reportsOn}>
          {TREND_COPY.nothing.action}
        </Action>
      </>
    );
  }
  if (summary.kind === "no_figure") {
    return (
      <>
        <Headline>{TREND_COPY.dash}</Headline>
        <Line>{DASHBOARD_COPY.trend.noFigure(summary.year)}</Line>
        <Action href={trendHref} show={reportsOn}>
          {DASHBOARD_COPY.trend.link(summary.from, summary.to)}
        </Action>
      </>
    );
  }
  return (
    <>
      <Headline>{formatCount(summary.total)}</Headline>
      <Line>{DASHBOARD_COPY.trend.yearLine(summary.year, summary.reporting, summary.members)}</Line>
      {summary.reporting < summary.members ? <Line>{DASHBOARD_COPY.trend.partialNote}</Line> : null}
      <Action href={trendHref} show={reportsOn}>
        {DASHBOARD_COPY.trend.link(summary.from, summary.to)}
      </Action>
    </>
  );
}

function VacantBody({
  summary,
  slug,
  reportsOn,
  credentialsOn,
}: {
  summary: VacantSummary;
  slug: string;
  reportsOn: boolean;
  credentialsOn: boolean;
}) {
  if (summary.kind === "not_recorded") {
    return (
      <>
        <Headline>{TREND_COPY.dash}</Headline>
        <Line>{VACANT_COPY.zeroAppointments.title}</Line>
        <Line>{credentialsOn ? VACANT_COPY.zeroAppointments.body : DASHBOARD_COPY.vacant.notRecordedNoLink}</Line>
        <Action href={`/o/${slug}/admin/credentials`} show={credentialsOn}>
          {VACANT_COPY.zeroAppointments.action}
        </Action>
      </>
    );
  }
  const link = (
    <Action href={`/o/${slug}/admin/reports/vacant-pulpits`} show={reportsOn}>
      {DASHBOARD_COPY.vacant.link}
    </Action>
  );
  if (summary.kind === "none_vacant") {
    return (
      <>
        <Headline>{VACANT_COPY.noneVacant.title}</Headline>
        <Line>{VACANT_COPY.noneVacant.body}</Line>
        {link}
      </>
    );
  }
  return (
    <>
      <Headline>{VACANT_COPY.count(summary.vacant, summary.total)}</Headline>
      <Line>{VACANT_COPY.note1}</Line>
      {link}
    </>
  );
}

function PerCapitaBody({ summary, slug, reportsOn }: { summary: PerCapitaSummary; slug: string; reportsOn: boolean }) {
  const year = summary.billingYear;
  if (summary.kind === "none") {
    return (
      <>
        <Headline>{TREND_COPY.dash}</Headline>
        <Line>{PER_CAPITA_COPY.empty.title(year)}</Line>
        <Line>
          {summary.rateSet
            ? reportsOn
              ? DASHBOARD_COPY.perCapita.rateSet(year)
              : DASHBOARD_COPY.perCapita.rateSetPlain(year)
            : reportsOn
              ? DASHBOARD_COPY.perCapita.noRate(year)
              : DASHBOARD_COPY.perCapita.noRatePlain(year)}
        </Line>
        <Action href={`/o/${slug}/admin/reports?billingYear=${year}`} show={reportsOn}>
          {PER_CAPITA_COPY.empty.action}
        </Action>
      </>
    );
  }
  return (
    <>
      <div>
        <Headline>{formatDollars(summary.billedCents)}</Headline>
        <Line>{DASHBOARD_COPY.perCapita.billed}</Line>
      </div>
      <Line>{DASHBOARD_COPY.perCapita.paid(formatDollars(summary.paidCents))}</Line>
      <Line>{DASHBOARD_COPY.perCapita.stillOwed(formatDollars(summary.outstandingCents))}</Line>
      <Line>{DASHBOARD_COPY.perCapita.countLine(summary.billedCount, summary.total)}</Line>
      {summary.departedBilled > 0 ? <Line>{DASHBOARD_COPY.perCapita.departed(summary.departedBilled)}</Line> : null}
      <Action href={`/o/${slug}/admin/reports/per-capita?billingYear=${year}`} show={reportsOn}>
        {DASHBOARD_COPY.perCapita.link(year)}
      </Action>
    </>
  );
}

/** A card whose heading can depend on the data (per capita prints its year). */
function Keyed<T>({
  result,
  phrase,
  retryHref,
  children,
}: {
  result: CardResult<T>;
  phrase: string;
  retryHref: string;
  children: (data: T) => ReactNode;
}) {
  if (result.kind === "locked") return <CardLocked permissionPhrase={phrase} />;
  if (result.kind === "error") return <CardError retryHref={retryHref} />;
  return <>{children(result.data)}</>;
}

/**
 * What the page renders once the gate has passed: the forbidden state, the page
 * load error, the empty roster, or the cards and the list. The roster read
 * failing is a card-level error and never the empty state: "couldn't load" must
 * not read as "no congregations".
 */
export function DashboardView({
  dashboard,
  org,
  slug,
  flags,
  retryHref,
  billingYear,
  mapSlot = null,
}: {
  dashboard: PresbyteryDashboard;
  org: string;
  slug: string;
  flags: DashboardFlags;
  retryHref: string;
  /** The year the per-capita card prints when it is locked or failed (the card has no data to name it). */
  billingYear: number;
  /** The client map element (`insights/map-loader.tsx`), built by the page only when it should exist (DECISION-343). */
  mapSlot?: ReactNode;
}) {
  if (dashboard.kind === "forbidden") return <DashboardForbidden />;
  if (dashboard.kind === "error") return <DashboardPageError retryHref={retryHref} />;
  if (dashboard.roster.kind === "ok" && dashboard.roster.count === 0) return <DashboardEmpty />;

  const { cards, roster } = dashboard;
  const { reportsOn, oversightOn, credentialsOn } = flags;
  return (
    <div className="space-y-8">
      <div data-testid="dashboard-cards" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MembersCard roster={roster} org={org} retryHref={retryHref} />

        <Card title={DASHBOARD_COPY.trend.title} testId="dashboard-card-trend">
          <Keyed result={cards.membership_trend} phrase={lockedPhrase("membership_trend")} retryHref={retryHref}>
            {(summary) => <TrendBody summary={summary} slug={slug} reportsOn={reportsOn} />}
          </Keyed>
        </Card>

        <Card title={DASHBOARD_COPY.vacant.title} testId="dashboard-card-vacant">
          <Keyed result={cards.vacant_pulpits} phrase={lockedPhrase("vacant_pulpits")} retryHref={retryHref}>
            {(summary) => <VacantBody summary={summary} slug={slug} reportsOn={reportsOn} credentialsOn={credentialsOn} />}
          </Keyed>
        </Card>

        <Card
          title={DASHBOARD_COPY.perCapita.title(cards.per_capita.kind === "ok" ? cards.per_capita.data.billingYear : billingYear)}
          testId="dashboard-card-per-capita"
        >
          <Keyed result={cards.per_capita} phrase={lockedPhrase("per_capita")} retryHref={retryHref}>
            {(summary) => <PerCapitaBody summary={summary} slug={slug} reportsOn={reportsOn} />}
          </Keyed>
        </Card>
      </div>

      <DashboardMap
        map={dashboard.map}
        viabilityOk={cards.viability.kind === "ok"}
        org={org}
        slug={slug}
        oversightOn={oversightOn}
        retryHref={retryHref}
        slot={mapSlot}
      />

      <DashboardViabilitySection
        state={cards.viability}
        org={org}
        slug={slug}
        oversightOn={oversightOn}
        reportsOn={reportsOn}
        retryHref={retryHref}
      />
    </div>
  );
}
