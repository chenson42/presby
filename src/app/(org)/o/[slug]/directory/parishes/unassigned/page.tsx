import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pagination } from "@/components/shared/pagination";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { getUnassignedPage } from "@/lib/parishes";
import {
  UNASSIGNED_GROUPS,
  parseHide,
  parsePage,
  serializeHide,
} from "@/lib/parishes-pure";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import { DirectoryFlagOff } from "../../directory-states";
import { HouseholdRow } from "../household-row";
import { ParishesForbidden, ParishesLoadError, ParishesOff } from "../parishes-states";
import { RowAssign } from "../row-assign";
import { GroupToggles } from "./group-toggles";

/**
 * `/o/<slug>/directory/parishes/unassigned` - the households in no district
 * (docs/work-log/2026-10-25-parish-management.md, Phase 3 "Component / Page
 * Plan"; copy C6). A triage list, not a handful: four exclusive population
 * groups (Members, Participants, Visitors, Others), toggled in the URL's
 * `?hide=` (allowlist-parsed, never persisted), 25 households a page, and an
 * Assign control per row for a viewer who may move households.
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL (see `directory/page.tsx`). The
 * toggle and the viewer's live authority are checked inside
 * `getUnassignedPage()` before any household is read. Names arrive already
 * masked ("Private" for a directory-hidden person the viewer may not see). The
 * back link is fixed - no user-controlled return parameter. NO `loading.tsx`.
 */
export default async function UnassignedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ hide?: string | string[]; page?: string | string[] }>;
}) {
  const { slug } = await params;
  const { hide: rawHide, page: rawPage } = await searchParams;
  const hidden = parseHide(rawHide);
  const page = parsePage(rawPage);
  const basePath = `/o/${slug}/directory/parishes/unassigned`;
  const hideValue = serializeHide(hidden);

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(basePath)}`);
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
    result = await getUnassignedPage(
      resolved.org.personId,
      resolved.org.organizationId,
      { hide: hidden, page },
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <ParishesLoadError retryHref={hideValue ? `${basePath}?hide=${hideValue}` : basePath} />;
  }

  if (result.kind === "off") return <ParishesOff name={resolved.org.name} />;
  if (result.kind === "forbidden") return <ParishesForbidden name={resolved.org.name} />;

  const { counts, households, totalShown, authority, activeTargets } = result;
  const totalAll = counts.members + counts.participants + counts.visitors + counts.others;
  const allHidden = UNASSIGNED_GROUPS.every((group) => hidden.has(group));
  const totalPages = Math.max(1, Math.ceil(totalShown / result.pageSize));

  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (hideValue) params.set("hide", hideValue);
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <section>
      <Link
        href={`/o/${slug}/directory/parishes`}
        className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Back to Parishes
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">Households with no district</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Households with at least one living, current person that aren&apos;t in any district yet.
      </p>

      {totalAll === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          <p>Every household is in a district.</p>
          <Link
            href={`/o/${slug}/directory/parishes`}
            className="mt-2 inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Back to Parishes
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <GroupToggles basePath={basePath} hidden={hidden} counts={counts} />
            <p className="mt-2 text-xs text-muted-foreground">
              A household appears under the first group that fits: Members, then Participants,
              then Visitors, then Others. Others are households where everyone is only listed or
              on staff.
            </p>
          </div>

          {authority.canMove && activeTargets.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground" data-testid="no-targets">
              There are no districts to assign to yet.{" "}
              {authority.canDefine ? (
                <Link
                  href={`/o/${slug}/directory/parishes`}
                  className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Add a district
                </Link>
              ) : (
                "Ask your congregation's administrator to add them."
              )}
            </p>
          ) : null}

          {allHidden ? (
            <p className="mt-6 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              Every group is hidden. Show a group to see its households.
            </p>
          ) : totalShown === 0 ? (
            // Some groups are hidden and the groups still shown are empty. Never blank: a blank
            // list reads as "every household is in a district", which is false here.
            <div
              className="mt-6 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground"
              data-testid="none-in-groups-shown"
            >
              <p>No households in the groups shown.</p>
              <Link
                href={basePath}
                className="mt-2 inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Show all groups
              </Link>
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {households.map((household) => (
                <HouseholdRow key={household.householdId} household={household}>
                  {authority.canMove && activeTargets.length > 0 ? (
                    <RowAssign
                      slug={slug}
                      mode="assign"
                      householdId={household.householdId}
                      householdName={household.name}
                      currentOrgUnitId={null}
                      targets={activeTargets.map((t) => ({
                        orgUnitId: t.orgUnitId,
                        name: t.name,
                      }))}
                    />
                  ) : null}
                </HouseholdRow>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <Pagination page={result.page} totalPages={totalPages} buildHref={pageHref} />
          </div>
        </>
      )}
    </section>
  );
}
