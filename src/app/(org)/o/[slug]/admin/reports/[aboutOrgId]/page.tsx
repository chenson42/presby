import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
  type OrganizationType,
} from "@/lib/authz";
import { getCongregationFilingHistory, type PublishedFilingRow } from "@/lib/presbytery";
import { isFlagEnabled } from "@/lib/flags";
import {
  PlaceholderFlagOff,
  PlaceholderNotAvailable,
} from "@/components/org-portal/coming-soon";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import { ReportsSectionForbidden, ReportsSectionLoadError } from "../reports-states";

const REPORTS_FLAG = "org_portal.reports";
const AREA = "Per-Capita, SASR & Imports";
const REPORTS_ORG_TYPES: readonly OrganizationType[] = ["presbytery"];

/**
 * `/o/<slug>/admin/reports/<aboutOrgId>` — the presbytery's per-congregation
 * filing history (architect Phase 2 ruling 1d). The RECIPIENT reading what
 * it received — the other axis of Two Hierarchies from `/admin/filings`,
 * which is the source council acting on its own act. Withdrawn rows are
 * INCLUDED here and marked (Option A, F52), never filtered — that filtering
 * belongs only to the "current" pick `fetchStatisticsForYear()` makes on the
 * parent `/admin/reports` list.
 *
 * Repeats the `(org)` auth pattern in full and the SAME flag/org-type
 * ordering `/admin/reports` runs — this is a nested route under that flag,
 * not a new tile (Phase 3 Permissions & Flags).
 *
 * `getCongregationFilingHistory()`'s `invalid_target` (an `aboutOrgId` that
 * isn't an actual member congregation of THIS presbytery — the parent-path
 * check) is a real 404, same as `admin/oversight/<aboutOrgId>/page.tsx`'s
 * identical branch.
 */
export default async function CongregationFilingHistoryPage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string }>;
}) {
  const { slug, aboutOrgId } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/reports/${aboutOrgId}`)}`,
    );
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

  let result;
  try {
    result = await getCongregationFilingHistory(
      resolved.org.personId,
      resolved.org.organizationId,
      aboutOrgId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <ReportsSectionLoadError slug={slug} />;
  }

  if (result.kind !== "ok") {
    if (result.kind === "forbidden") {
      return <ReportsSectionForbidden section="filing history" name={resolved.org.name} />;
    }
    if (result.kind === "invalid_target") {
      notFound();
    }
    return <ReportsSectionLoadError slug={slug} />;
  }

  return (
    <section className="space-y-6">
      <div>
        <Link
          href={`/o/${slug}/admin/reports`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to reports
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">{result.data.congregationName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}&apos;s full filing history for this congregation,
          including any withdrawn returns.
        </p>
      </div>

      <FilingHistoryTable rows={result.data.rows} />
    </section>
  );
}

function FilingHistoryTable({ rows }: { rows: PublishedFilingRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No filings on record for this congregation</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Year</TableHead>
          <TableHead className="hidden sm:table-cell">Published</TableHead>
          <TableHead>Minute reference</TableHead>
          <TableHead className="hidden sm:table-cell">Attested by</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const isWithdrawn = row.withdrawnAt !== null;
          return (
            <TableRow key={row.publicationId}>
              <TableCell className="font-medium">{row.reportYear}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                <FormattedDate value={row.publishedAt} mode="date" />
              </TableCell>
              <TableCell className="max-w-[10rem] whitespace-normal">
                {row.minuteReference ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {row.attestedByName ?? "—"}
                {row.attestedRole ? ` (${row.attestedRole})` : null}
              </TableCell>
              <TableCell>
                {isWithdrawn ? (
                  <div>
                    <Badge variant="outline">Withdrawn</Badge>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      <FormattedDate value={row.withdrawnAt as string} mode="date" />
                    </span>
                    {row.withdrawnMinuteReference && (
                      <span className="block text-sm text-muted-foreground">
                        {row.withdrawnMinuteReference}
                      </span>
                    )}
                  </div>
                ) : (
                  <Badge variant="default">Published</Badge>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
