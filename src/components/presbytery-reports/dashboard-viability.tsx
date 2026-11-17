import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DASHBOARD_COPY, FRAME_COPY, VIABILITY_COPY, HUB_COPY } from "@/lib/presbytery-reports/copy";
import type { ViabilityList, ViabilityListRow } from "@/lib/presbytery-reports/dashboard-derive";
import { REPORTS } from "@/lib/presbytery-reports/contract";
import { CardError, CardLocked } from "./dashboard-states";
import { ReportEmpty } from "./report-states";
import { ViabilityBadge } from "./viability-view";

const LINK = "text-primary underline-offset-4 hover:underline";
const BLOCK_LINK = `inline-flex min-h-11 items-center ${LINK}`;

function CongregationName({ row, slug, oversightOn }: { row: ViabilityListRow; slug: string; oversightOn: boolean }) {
  // The name is tenant-entered text: React text only, never HTML.
  return oversightOn ? (
    <Link href={`/o/${slug}/admin/oversight/${row.organizationId}`} className={`${BLOCK_LINK} break-words font-medium`}>
      {row.name}
    </Link>
  ) : (
    <span className="break-words font-medium">{row.name}</span>
  );
}

function ViabilityListBody({
  list,
  slug,
  oversightOn,
  reportsOn,
}: {
  list: ViabilityList;
  slug: string;
  oversightOn: boolean;
  reportsOn: boolean;
}) {
  if (list.rows.length === 0) return <ReportEmpty title={FRAME_COPY.noMembers} />;
  return (
    <div className="space-y-4">
      <ul data-testid="dashboard-viability-cards" className="space-y-3 sm:hidden">
        {list.rows.map((row) => (
          <li key={row.organizationId} className="min-w-0 rounded-lg border border-border p-4">
            <div className="min-w-0">
              <CongregationName row={row} slug={slug} oversightOn={oversightOn} />
            </div>
            <div className="mt-2">
              <ViabilityBadge row={row} />
            </div>
          </li>
        ))}
      </ul>

      <div data-testid="dashboard-viability-table" className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{VIABILITY_COPY.columns.congregation}</TableHead>
              <TableHead>{VIABILITY_COPY.columns.viability}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.rows.map((row) => (
              <TableRow key={row.organizationId}>
                <TableCell className="max-w-xs whitespace-normal">
                  <CongregationName row={row} slug={slug} oversightOn={oversightOn} />
                </TableCell>
                <TableCell>
                  <ViabilityBadge row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {list.anyNotAssessed && oversightOn ? (
        <div className="text-sm">
          <p className="text-muted-foreground">{VIABILITY_COPY.assessNote}</p>
          <Link href={`/o/${slug}/admin/oversight`} className={BLOCK_LINK}>
            {VIABILITY_COPY.assessLink}
          </Link>
        </div>
      ) : null}

      {reportsOn ? (
        <p className="text-sm">
          <Link href={`/o/${slug}/admin/reports/viability`} className={BLOCK_LINK}>
            {DASHBOARD_COPY.viability.viewReport}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The viability section: always rendered for a holder of
 * `congregation_oversight.manage` (the same key the oversight page needs, so no
 * name is offered that its holder cannot follow). A cards-below-`sm`, table-above
 * list like the reports' (DECISION-342, Phase 1 Gap 8). Locked and error states
 * affect this section only.
 */
export function DashboardViabilitySection({
  state,
  org,
  slug,
  oversightOn,
  reportsOn,
  retryHref,
}: {
  state: { kind: "ok"; data: ViabilityList } | { kind: "locked" } | { kind: "error" };
  org: string;
  slug: string;
  oversightOn: boolean;
  reportsOn: boolean;
  retryHref: string;
}) {
  const phrase = REPORTS.find((r) => r.key === "viability")?.permissionPhrase ?? "";
  return (
    <section aria-labelledby="dashboard-viability-heading" data-testid="dashboard-viability" className="space-y-3">
      <div>
        <h2 id="dashboard-viability-heading" className="text-xl font-semibold">
          {DASHBOARD_COPY.viability.title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{HUB_COPY.cards.viability.description(org)}</p>
      </div>
      {state.kind === "locked" ? (
        <CardLocked permissionPhrase={phrase} />
      ) : state.kind === "error" ? (
        <CardError retryHref={retryHref} message={DASHBOARD_COPY.viability.error} />
      ) : (
        <ViabilityListBody list={state.data} slug={slug} oversightOn={oversightOn} reportsOn={reportsOn} />
      )}
    </section>
  );
}
