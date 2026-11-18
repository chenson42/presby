import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { helpHref } from "@/lib/help/urls";
import { REPORTS, type ReportKey, type ReportViewer } from "@/lib/presbytery-reports/contract";
import { HUB_COPY } from "@/lib/presbytery-reports/copy";
import { getReportsHub } from "@/lib/presbytery-reports/hub";
import { OrgAccessError } from "@/lib/authz";

function cardText(key: ReportKey, orgName: string): { description: string; source: string } {
  switch (key) {
    case "vacant_pulpits":
      return HUB_COPY.cards.vacant_pulpits;
    case "membership_trend":
      return HUB_COPY.cards.membership_trend;
    case "viability":
      return { description: HUB_COPY.cards.viability.description(orgName), source: HUB_COPY.cards.viability.source };
    case "per_capita":
      return HUB_COPY.cards.per_capita;
    case "buildings":
      return HUB_COPY.cards.buildings;
    case "insurance_and_loans":
      return HUB_COPY.cards.insurance_and_loans;
  }
}

const CARD = "block min-h-11 rounded-lg border border-border p-4";

/**
 * The "Reports and exports" section of `/o/<slug>/admin/reports`: one card per
 * report. An unlocked card is one whole-card link; a locked card is a `div` with
 * the "Locked" badge and the reason, never a link and never hidden (a hidden
 * card is a "why can't I see this" ticket). The lock state is read live
 * (`presby_has_permission`), and the hub reveals which cards are locked and
 * nothing else. No table, and no heading that contains the hyphenated
 * "Per-Capita" the existing page's own sections use.
 *
 * Computed as a plain value by `renderReportsHub` BEFORE the page's `return`,
 * never as a nested async component (the page's own comment says why). A failed
 * lock read shows an inline error and leaves the rest of the page alone; an
 * `OrgAccessError` goes to the error boundary.
 */
export async function renderReportsHub({
  slug,
  viewer,
  orgName,
}: {
  slug: string;
  viewer: ReportViewer;
  orgName: string;
}): Promise<ReactNode> {
  let held: Record<ReportKey, boolean> | null = null;
  try {
    held = (await getReportsHub(viewer)).held;
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
  }

  return (
    <section className="space-y-4" data-testid="reports-hub">
      <div>
        <h2 className="text-xl font-semibold">{HUB_COPY.heading}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{HUB_COPY.intro}</p>
        <p className="mt-1 text-sm text-muted-foreground">{HUB_COPY.rosterLine(orgName)}</p>
      </div>

      {held === null ? (
        <div role="alert" className="space-y-3 rounded-lg border border-dashed border-border p-4">
          <p className="text-sm text-muted-foreground">{HUB_COPY.loadError}</p>
          <Button asChild className="min-h-11 w-full sm:w-auto">
            <Link href={`/o/${slug}/admin/reports`}>{HUB_COPY.retry}</Link>
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {REPORTS.map((report) => {
            const text = cardText(report.key, orgName);
            const body = (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{report.title}</h3>
                  {held[report.key] ? null : <Badge variant="outline">{HUB_COPY.lockedBadge}</Badge>}
                </div>
                <p className="mt-1 text-sm">{text.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">{text.source}</p>
                {held[report.key] ? null : (
                  <p className="mt-2 text-sm text-muted-foreground">{HUB_COPY.lockedReason(report.permissionPhrase)}</p>
                )}
              </>
            );
            return (
              <li key={report.key}>
                {held[report.key] ? (
                  <Link href={`/o/${slug}/admin/reports/${report.segment}`} className={`${CARD} hover:bg-accent`}>
                    {body}
                  </Link>
                ) : (
                  <div className={`${CARD} bg-muted/30`}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-sm">
        <Link href={helpHref("presbytery-reports")} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
          {HUB_COPY.helpLink}
        </Link>
      </p>
    </section>
  );
}
