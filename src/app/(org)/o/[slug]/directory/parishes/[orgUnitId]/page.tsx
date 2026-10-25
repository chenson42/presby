import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/shared/pagination";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { getDistrictPage } from "@/lib/parishes";
import { parsePage } from "@/lib/parishes-pure";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import { DirectoryFlagOff } from "../../directory-states";
import { ArchivedNotice } from "../archived-notice";
import { BulkMove } from "../bulk-move";
import { HouseholdRow } from "../household-row";
import { archivedMoveState, householdsLabel, noActiveDistrictsCopy } from "../parish-copy";
import { ParishesForbidden, ParishesLoadError, ParishesOff } from "../parishes-states";
import { RowAssign } from "../row-assign";

/**
 * `/o/<slug>/directory/parishes/<orgUnitId>` - one district's households
 * (docs/work-log/2026-10-25-parish-management.md, Phase 3 "Component / Page
 * Plan"; it closes the "per-parish roster" TODO). For a viewer who can move
 * households each row carries a Move control; an ARCHIVED district shows a notice
 * and, while it still holds households, "Move all N households to...".
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL (the `directory/page.tsx` header has
 * the rationale). Gate order: auth, org membership, the two platform directory
 * flags, then - inside `getDistrictPage()` - the per-org toggle and the viewer's
 * live authority, BEFORE the district is looked up, so a viewer without authority
 * learns nothing about which district ids exist. `not_found` (a malformed id,
 * another organization's, a nonexistent one, a campus) is a 404; the toggle being
 * off is an honest "isn't turned on" (an org setting visible to any member).
 *
 * No user-controlled return parameter: the back link is fixed. NO `loading.tsx`
 * (this segment can `notFound()`; a Suspense boundary would flush a 200 first).
 */
export default async function DistrictPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; orgUnitId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { slug, orgUnitId } = await params;
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const here = `/o/${slug}/directory/parishes/${orgUnitId}`;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(here)}`);
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

  const directoryEnabled = await isFlagEnabled("org_portal.directory");
  const directoryV2Enabled = await isFlagEnabled("org_portal.directory_v2");
  if (!directoryEnabled || !directoryV2Enabled) {
    return <DirectoryFlagOff name={resolved.org.name} />;
  }

  let result;
  try {
    result = await getDistrictPage(
      resolved.org.personId,
      resolved.org.organizationId,
      orgUnitId,
      { page },
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <ParishesLoadError retryHref={here} />;
  }

  switch (result.kind) {
    case "off":
      return <ParishesOff name={resolved.org.name} />;
    case "forbidden":
      return <ParishesForbidden name={resolved.org.name} />;
    case "not_found":
      notFound();
    case "ok":
      break;
  }

  const { district, authority, households, total, activeTargets: targets } = result;
  const totalPages = Math.max(1, Math.ceil(total / result.pageSize));
  // One decision for the notice's sentence AND the control beneath it.
  const moveState = archivedMoveState({
    canMove: authority.canMove,
    householdCount: district.householdCount,
    activeTargetCount: targets.length,
  });

  return (
    <section>
      <Link
        href={`/o/${slug}/directory/parishes`}
        className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Back to Parishes
      </Link>
      <h1 className="mt-3 text-2xl font-semibold break-words">{district.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground break-words">
        {district.deaconName ? <>Deacon: {district.deaconName}</> : <>Deacon: Vacant</>}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant="secondary">{householdsLabel(district.householdCount)}</Badge>
        {district.archived ? <Badge variant="outline">Archived</Badge> : null}
      </div>

      {district.archived ? (
        <ArchivedNotice householdCount={district.householdCount} state={moveState}>
          {moveState === "bulk" || moveState === "over_cap" ? (
            <BulkMove
              slug={slug}
              source={{ orgUnitId: district.orgUnitId, name: district.name }}
              count={district.householdCount}
              targets={targets}
            />
          ) : moveState === "no_target" ? (
            <p className="text-sm text-muted-foreground">
              {noActiveDistrictsCopy(authority.canDefine)}
            </p>
          ) : null}
        </ArchivedNotice>
      ) : null}

      {households.length === 0 ? (
        !district.archived ? (
          <p className="mt-6 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            No households in this district yet.
          </p>
        ) : null
      ) : (
        <ul className="mt-6 space-y-3">
          {households.map((household) => (
            <HouseholdRow key={household.householdId} household={household}>
              {authority.canMove ? (
                <RowAssign
                  slug={slug}
                  mode="move"
                  householdId={household.householdId}
                  householdName={household.name}
                  currentOrgUnitId={district.orgUnitId}
                  targets={targets.map((t) => ({ orgUnitId: t.orgUnitId, name: t.name }))}
                />
              ) : null}
            </HouseholdRow>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Pagination
          page={result.page}
          totalPages={totalPages}
          buildHref={(target) => `${here}${target > 1 ? `?page=${target}` : ""}`}
        />
      </div>
    </section>
  );
}
