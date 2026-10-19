import { ChevronDown, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import { MEMBER_GIVING } from "@/lib/giving/giving-copy";
import type { MyStatement } from "@/lib/giving/self";

/**
 * "Year-end statements": the member's own statements, newest year first, each a
 * plain link to the member download route (an attachment). docs/work-log/
 * 2026-10-15-online-giving.md, Flow 12 and the Batch 5a orchestrator ruling 1:
 * statements are listed under the member's donor ROOT; the ones a newer version
 * replaced, and the ones issued to a record that was later merged into theirs
 * (when the root has its own statement for that year), sit under an "Earlier
 * versions" disclosure - never hidden, and still
 * downloadable. The treasurer's "out of date" flag is NOT shown here: it is the
 * treasurer's to-do, and a member can do nothing about it.
 *
 * The disclosure is a native `<details>`; its `<summary>` carries no `display`
 * utility (that breaks `<details>` on iOS - CLAUDE.md, Verify in a Browser), so
 * its layout lives on an inner span. A server component with no hooks: it works
 * before hydration.
 */

function StatementCard({ slug, statement, why }: { slug: string; statement: MyStatement; why?: string }) {
  return (
    <li className="rounded-lg border border-border bg-card p-4 text-card-foreground" data-testid="statement-row">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-base font-medium">{statement.taxYear} giving statement</p>
        {statement.version > 1 && <Badge variant="outline">{MEMBER_GIVING.correctedBadge}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Issued <FormattedDate value={statement.issuedAt} mode="date" />
        {statement.version > 1 ? ` · version ${statement.version}` : ""}
      </p>
      {why && <p className="mt-1 text-sm text-muted-foreground">{why}</p>}
      <div className="mt-3">
        <Button asChild variant="outline" className="min-h-11">
          <a
            href={`/o/${slug}/giving/statements/${statement.id}/download`}
            download
            aria-label={`${MEMBER_GIVING.download}: ${statement.taxYear} giving statement, version ${statement.version}`}
          >
            <Download className="size-4" aria-hidden />
            {MEMBER_GIVING.download}
          </a>
        </Button>
      </div>
    </li>
  );
}

export function StatementsList({ slug, statements }: { slug: string; statements: MyStatement[] }) {
  if (statements.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center" data-testid="statements-empty">
        <p className="text-sm font-medium">{MEMBER_GIVING.statementsEmptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{MEMBER_GIVING.statementsEmptyBody}</p>
      </div>
    );
  }
  // A merge-source statement is an earlier version only when the root holds its
  // own statement for that year; otherwise it is the member's only statement for
  // the year and stays at the top level (operator ruling, 2026-10-19).
  const rootYears = new Set(statements.filter((s) => !s.superseded && !s.mergedSource).map((s) => s.taxYear));
  const isCurrent = (s: MyStatement) => !s.superseded && (!s.mergedSource || !rootYears.has(s.taxYear));
  const current = statements.filter(isCurrent);
  const previous = statements.filter((s) => !isCurrent(s));
  return (
    <div className="space-y-4">
      {current.length > 0 && (
        <ul className="space-y-2" data-testid="statements-list">
          {current.map((s) => (
            <StatementCard key={s.id} slug={slug} statement={s} why={s.mergedSource ? MEMBER_GIVING.previousCombined : undefined} />
          ))}
        </ul>
      )}
      {previous.length > 0 && (
        <details className="group rounded-lg border border-border" data-testid="statements-previous">
          <summary className="cursor-pointer list-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
            <span className="flex min-h-11 items-center justify-between gap-2 px-4 text-base font-medium">
              {MEMBER_GIVING.previousSummary(previous.length)}
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
            </span>
          </summary>
          <div className="space-y-3 border-t border-border p-4">
            <p className="text-sm text-muted-foreground">{MEMBER_GIVING.previousHelp}</p>
            <ul className="space-y-2" data-testid="statements-previous-list">
              {previous.map((s) => (
                <StatementCard
                  key={s.id}
                  slug={slug}
                  statement={s}
                  why={s.superseded ? MEMBER_GIVING.previousReplaced : MEMBER_GIVING.previousCombined}
                />
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}
