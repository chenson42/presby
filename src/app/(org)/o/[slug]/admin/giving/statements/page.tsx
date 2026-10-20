import Link from "next/link";
import { redirect } from "next/navigation";
import { Printer } from "lucide-react";
import { OrgAccessError } from "@/lib/authz";
import { Button } from "@/components/ui/button";
import { FormField, NativeSelect } from "@/components/giving/form-field";
import {
  listStatements,
  previewStatementRun,
  STATEMENT_FILTERS,
  type ListStatementsResult,
  type PreviewStatementRunResult,
  type StatementFilter,
} from "@/lib/giving/statements";
import { FILTER_LABELS } from "@/lib/giving/statements/copy";
import { parseYearParam } from "@/lib/giving/statements/pure";
import { GivingBackLink, GivingLoadError } from "../giving-admin-states";
import { gateGivingPage } from "../giving-page-gate";
import { ExceptionsPanel } from "./exceptions-panel";
import { IssueStatementsDialog } from "./issue-dialog";
import { SendNoticesButton } from "./notices-button";
import { StatementsTable } from "./statements-table";

/**
 * `/o/<slug>/admin/giving/statements` - the year-end statements run
 * (`giving.view`; issuing and the other actions need `giving.manage`).
 * docs/work-log/2026-10-15-online-giving.md, Flow 11 and Phase 3 "Pages to
 * create". Four states, designed: forbidden / toggle-off (the gate), a load
 * error (never an empty list: "We can't load Giving right now"), empty (a year
 * with no gifts to count, or no statements yet - each with the one thing that
 * fills it) and populated. No `loading.tsx` (a segment that can redirect); the
 * issue run's progress lives in its dialog.
 *
 * The year picker defaults to LAST calendar year and is a plain GET form: the
 * year, the filter and the cursor live in the URL, and there is no JavaScript to
 * hydrate. A year in the future (`?year=2099`) redirects to the default.
 */

const PICKER_YEARS = 7;

export default async function GivingStatementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const path = `/o/${slug}/admin/giving/statements`;
  const gate = await gateGivingPage({ slug, path, anyOf: ["view"], section: "Statements" });
  if (!gate.ok) return gate.node;

  const thisYear = new Date().getUTCFullYear();
  const defaultYear = thisYear - 1;
  const year = parseYearParam(raw.year) ?? defaultYear;
  const filterParam = Array.isArray(raw.filter) ? raw.filter[0] : raw.filter;
  const filter: StatementFilter = (STATEMENT_FILTERS as readonly string[]).includes(filterParam ?? "")
    ? (filterParam as StatementFilter)
    : "all";
  const cursor = typeof raw.cursor === "string" ? raw.cursor : undefined;

  let previewResult: PreviewStatementRunResult;
  let listResult: ListStatementsResult;
  try {
    [previewResult, listResult] = await Promise.all([
      previewStatementRun(gate.org.personId, gate.org.organizationId, year),
      listStatements(gate.org.personId, gate.org.organizationId, { year, filter, cursor }),
    ]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <GivingLoadError slug={slug} href={`${path}?year=${year}`} />;
  }
  if (previewResult.kind === "invalid_year" || listResult.kind === "invalid_year") redirect(path);
  if (previewResult.kind !== "ok" || listResult.kind !== "ok") {
    return <GivingLoadError slug={slug} href={`${path}?year=${year}`} />;
  }
  const { preview } = previewResult;
  const { statements, nextCursor } = listResult;

  const canManage = gate.has.manage;
  const canIssue =
    canManage && gate.has.view && preview.blockers.length === 0 && preview.issuingEnabled && preview.toIssue > 0;
  const years = Array.from({ length: PICKER_YEARS }, (_, i) => thisYear - i);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => b - a);
  const issuedAny = preview.alreadyIssued > 0 || statements.length > 0;
  const query = (over: { filter?: StatementFilter; cursor?: string }) => {
    const p = new URLSearchParams({ year: String(year) });
    const f = over.filter ?? filter;
    if (f !== "all") p.set("filter", f);
    if (over.cursor) p.set("cursor", over.cursor);
    return `${path}?${p.toString()}`;
  };

  return (
    <div className="max-w-4xl space-y-6">
      <GivingBackLink slug={slug} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Year-end statements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The giving statements {gate.org.name} sends each donor after the year ends.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {issuedAny && (
            <Button asChild variant="outline" className="min-h-11">
              <a href={`${path}/print?year=${year}`} download data-testid="print-run-link">
                <Printer className="size-4" aria-hidden />
                Print run (PDF)
              </a>
            </Button>
          )}
          {canManage && preview.noticeCandidates > 0 && (
            <SendNoticesButton slug={slug} year={year} candidates={preview.noticeCandidates} />
          )}
        </div>
      </div>

      <form method="get" action={path} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
        <FormField id="statement-year" label="Year" className="min-w-40">
          <NativeSelect id="statement-year" name="year" defaultValue={String(year)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
                {y === defaultYear ? " (last year)" : ""}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button type="submit" className="min-h-11">
          Show year
        </Button>
      </form>

      <section aria-labelledby="run-heading" className="space-y-4 rounded-lg border border-border p-4" data-testid="run-summary">
        <h2 id="run-heading" className="text-xl font-semibold">
          {year} statements
        </h2>
        {preview.eligibleDonors === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-sm font-medium">No gifts to count for {year}</p>
            <p className="mx-auto mt-1 max-w-md px-4 text-sm text-muted-foreground">
              Statements list each donor&apos;s completed gifts dated in the year. Record or import gifts first.
            </p>
            <Button asChild variant="outline" className="mt-4 min-h-11">
              <Link href={`/o/${slug}/admin/giving/gifts`}>Go to gifts</Link>
            </Button>
          </div>
        ) : (
          <p className="text-sm" data-testid="run-counts">
            <strong>{preview.eligibleDonors}</strong> {preview.eligibleDonors === 1 ? "donor has" : "donors have"} gifts in{" "}
            {year}. <strong>{preview.alreadyIssued}</strong> already {preview.alreadyIssued === 1 ? "has" : "have"} a
            statement; <strong>{preview.toIssue}</strong> {preview.toIssue === 1 ? "is" : "are"} still to issue.
          </p>
        )}

        {preview.blockers.length > 0 && (
          <div role="status" className="rounded-lg border border-border bg-muted p-4 text-sm" data-testid="statement-blockers">
            <p className="font-medium">Statements can&apos;t be issued yet. Still needed:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {preview.blockers.includes("donee_name") && <li>The legal name of the church</li>}
              {preview.blockers.includes("donee_address") && <li>A complete mailing address</li>}
            </ul>
            {canManage && (
              <Button asChild variant="outline" className="mt-3 min-h-11">
                <Link href={`/o/${slug}/admin/giving/settings`}>Open statement details</Link>
              </Button>
            )}
          </div>
        )}

        {!preview.issuingEnabled && (
          <div role="status" className="rounded-lg border border-border bg-muted p-4 text-sm" data-testid="issuing-disabled">
            <p className="font-medium">Issuing statements is switched off on this site.</p>
            <p className="mt-1 text-muted-foreground">
              It is switched on after your accountant has reviewed the statement wording. You can still look at who
              would get a statement and what needs fixing first.
            </p>
          </div>
        )}

        {canIssue && (
          <IssueStatementsDialog slug={slug} year={year} toIssue={preview.toIssue} alreadyIssued={preview.alreadyIssued} />
        )}
        {!canManage && preview.toIssue > 0 && (
          <p className="text-sm text-muted-foreground">Ask your treasurer to issue these; it needs the manage permission.</p>
        )}
      </section>

      <ExceptionsPanel slug={slug} year={year} preview={preview} />

      <section aria-labelledby="list-heading" className="space-y-4">
        <h2 id="list-heading" className="text-xl font-semibold">
          Issued statements
        </h2>
        <nav aria-label="Filter statements" className="flex flex-wrap gap-2">
          {STATEMENT_FILTERS.map((f) => (
            <Button key={f} asChild variant={f === filter ? "default" : "outline"} className="min-h-11">
              <Link href={query({ filter: f })} aria-current={f === filter ? "page" : undefined}>
                {FILTER_LABELS[f]}
                {f === "stale" && preview.stale > 0 ? ` (${preview.stale})` : ""}
              </Link>
            </Button>
          ))}
        </nav>

        {statements.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center" data-testid="statements-empty">
            <p className="text-sm font-medium">
              {filter === "all" ? `No ${year} statements issued yet` : `Nothing in “${FILTER_LABELS[filter]}” for ${year}`}
            </p>
            <p className="mx-auto mt-1 max-w-md px-4 text-sm text-muted-foreground">
              {filter === "all"
                ? "Issued statements appear here, each one a PDF you can download."
                : "Try another view above."}
            </p>
          </div>
        ) : (
          <StatementsTable
            slug={slug}
            year={year}
            statements={statements}
            canManage={canManage}
            issuingEnabled={preview.issuingEnabled}
          />
        )}

        {nextCursor && (
          <div className="flex justify-center">
            <Button asChild variant="outline" className="min-h-11">
              <Link href={query({ cursor: nextCursor })}>Show more</Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
