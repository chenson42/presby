import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
  type OrganizationType,
} from "@/lib/authz";
import { listOwnFilings, type FilingRow } from "@/lib/filings";
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
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { FilingsSectionForbidden, FilingsLoadError } from "./filings-states";
import { WithdrawDialog } from "./withdraw-dialog";

const FILINGS_FLAG = "org_portal.filings";
const AREA = "Statistical Filings";
const FILINGS_ORG_TYPES: readonly OrganizationType[] = ["congregation"];

/**
 * `/o/<slug>/admin/filings` — the congregation's own filing history +
 * withdraw (DECISION-152, architect Phase 2 ruling 1a). The source council
 * acting on its own published act — the other axis of Two Hierarchies from
 * `/admin/reports`, which is why this is a separate route rather than a
 * second mode of that page.
 *
 * Same auth/flag/org-type preamble ORDER every `(org)` page under
 * `admin/` runs (`admin/reports/page.tsx`, `admin/oversight/
 * [aboutOrgId]/page.tsx`): `cachedAuth()` -> `resolveOrgContext()` (four-way
 * miss) -> `assertOrgAccess()` -> flag -> org type -> the data read.
 *
 * Closes, as a side effect, the "zero UI consumers" gap Phase 1 named for
 * the congregation's own filing history — no publish form here yet (Phase 1
 * Out of Scope; the empty state says so plainly rather than reading as
 * broken).
 */
export default async function FilingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/filings`)}`);
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

  const filingsEnabled = await isFlagEnabled(FILINGS_FLAG);
  if (!filingsEnabled) {
    return <PlaceholderFlagOff area={AREA} orgName={resolved.org.name} />;
  }

  if (!FILINGS_ORG_TYPES.includes(resolved.org.organizationType)) {
    return <PlaceholderNotAvailable area={AREA} orgName={resolved.org.name} />;
  }

  let result;
  try {
    result = await listOwnFilings(resolved.org.personId, resolved.org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold">{AREA}</h1>
        <FilingsLoadError slug={slug} />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{AREA}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{resolved.org.name}</p>
      </div>

      {result.kind === "forbidden" ? (
        <FilingsSectionForbidden name={resolved.org.name} />
      ) : result.kind !== "ok" ? (
        <FilingsLoadError slug={slug} />
      ) : (
        <FilingsTable slug={slug} filings={result.data} />
      )}
    </section>
  );
}

/**
 * The filing-history list, server-rendered — one row per publication this
 * congregation has ever made, newest first (`listOwnFilings()`'s own
 * ordering). A "current" row is one nothing else in the list supersedes and
 * that has not itself been withdrawn — only THAT row carries the Withdraw
 * action (Phase 3 Component Plan: "the current, non-superseded,
 * non-withdrawn row only").
 *
 * Kept inline rather than a separate `filings-table.tsx` file — this is
 * page-specific composition with a single call site, the same shape
 * `admin/reports/page.tsx`'s own `renderStatisticsSection()` helper uses,
 * not a reusable component.
 */
function FilingsTable({ slug, filings }: { slug: string; filings: FilingRow[] }) {
  if (filings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No filings on record yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Filing a new statistical return isn&apos;t built on this page yet —
          this page shows the history of returns your presbytery has already
          received and lets you withdraw one if it was filed in error.
        </p>
      </div>
    );
  }

  const supersededIds = new Set(
    filings.map((f) => f.supersedesId).filter((id): id is string => id !== null),
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Year</TableHead>
          <TableHead className="hidden sm:table-cell">Published</TableHead>
          <TableHead>Minute reference</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filings.map((filing) => {
          const isSuperseded = supersededIds.has(filing.publicationId);
          const isWithdrawn = filing.withdrawnAt !== null;
          const isCurrent = !isSuperseded && !isWithdrawn;

          return (
            <TableRow key={filing.publicationId}>
              <TableCell className="font-medium">{filing.reportYear}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                <FormattedDate value={filing.publishedAt} mode="date" />
              </TableCell>
              <TableCell className="max-w-[10rem] whitespace-normal">
                {filing.minuteReference ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {isWithdrawn ? (
                  <div>
                    <Badge variant="outline">Withdrawn</Badge>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      <FormattedDate value={filing.withdrawnAt as string} mode="date" />
                    </span>
                    {filing.withdrawnMinuteReference && (
                      <span className="block text-sm text-muted-foreground">
                        {filing.withdrawnMinuteReference}
                      </span>
                    )}
                  </div>
                ) : isSuperseded ? (
                  <Badge variant="secondary">Superseded</Badge>
                ) : (
                  <Badge variant="default">Current</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                {isCurrent && (
                  <WithdrawDialog
                    slug={slug}
                    publicationId={filing.publicationId}
                    reportYear={filing.reportYear}
                  />
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
