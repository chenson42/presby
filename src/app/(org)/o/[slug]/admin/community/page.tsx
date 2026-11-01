import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  hasPermission,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getDirectory, type DirectoryResult } from "@/lib/directory";
import {
  getCommunityBadges,
  listFormer,
  listInactive,
  listStaff,
  listVisitors,
  type CommunityListResult,
} from "@/lib/community";
import { parseCommunityView } from "@/lib/community-labels";
import { countPendingRollActions } from "@/lib/roll";
import { getSignInMarkers } from "@/lib/onboarding/org-invite";
import { getSelfConnectEnabled } from "@/lib/community-self-connect";
import type { SignInMarker } from "@/lib/onboarding/sign-in-types";
import { isFlagEnabled } from "@/lib/flags";
import { isOrgFeatureEnabled } from "@/lib/org-features";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  MembersFlagOff,
  MembersForbidden,
  MembersLimited,
  MembersLoadError,
} from "./members-states";
import { MembersList } from "./members-list";
import { CommunityNav } from "./community-nav";

const MEMBERS_CREATE_FLAG = "org_portal.members_create";
const CHILDREN_MINISTRY_FLAG = "org_portal.children_ministry";
const STAFF_FLAG = "org_portal.staff";

/**
 * `/o/<slug>/admin/community` — the Community page: the list, its seven views and
 * the "Add person" entry point. Gated on BOTH `org_portal.members_create` (the
 * global flag) AND the matching `organization_feature_toggles` row
 * (DECISION-097's third axis).
 *
 * VIEWS (DECISION-201), server-rendered links in `CommunityNav`: Everyone,
 * Members (active, baptized, affiliate), Participants read the privacy-filtered
 * Directory (`getDirectory()`, `directory.view`); Visitors, Inactive, Staff and Former
 * read `src/lib/community.ts` (`people.manage`, admin-only, never in the
 * Directory).
 *
 * DEGRADE (DECISION-197, F172): a `people.manage` holder without
 * `directory.view` keeps the header, Add person and the three admin views, and
 * sees `MembersLimited` in place of a Directory-backed list. A caller without
 * `people.manage` gets `MembersForbidden`, unchanged. "Add person" is gated on
 * `people.manage` alone (a Visitor needs nothing more); the roll-bearing
 * choices are gated on `roll.propose` inside the wizard and re-checked on the
 * server.
 */
const MEMBERS_PAGE_SIZE = 25;

const HEADING = "Community";

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export default async function CommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ search?: string; view?: string; page?: string }>;
}) {
  const { slug } = await params;
  const {
    search: rawSearch,
    view: rawView,
    page: rawPage,
  } = await searchParams;
  const search = rawSearch?.trim() ?? "";
  const view = parseCommunityView(rawView);
  const page = parsePage(rawPage);

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/community`)}`,
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
        <OrgAccessEnded
          name={resolved.name}
          endedOn={resolved.endedOn}
          slug={slug}
        />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const flagOn = await isFlagEnabled(MEMBERS_CREATE_FLAG);
  const toggleOn = flagOn
    ? await isOrgFeatureEnabled(
        resolved.org.personId,
        resolved.org.organizationId,
        MEMBERS_CREATE_FLAG,
      )
    : false;
  if (!flagOn || !toggleOn) {
    return <MembersFlagOff name={resolved.org.name} heading={HEADING} />;
  }

  // Independent awaited calls, not merged into one Promise.all — same
  // discipline edit/page.tsx's own conditional cards follow.
  const canManage = await hasPermission(
    resolved.org.personId,
    resolved.org.organizationId,
    "people.manage",
  );
  const adminView =
    view === "visitors" || view === "inactive" || view === "staff" || view === "former";
  if (adminView && !canManage) {
    return <MembersForbidden name={resolved.org.name} heading={HEADING} />;
  }

  const personId = resolved.org.personId;
  const organizationId = resolved.org.organizationId;

  let directoryResult: DirectoryResult | null = null;
  let listResult: CommunityListResult | null = null;
  let badges: Awaited<ReturnType<typeof getCommunityBadges>> = {};
  try {
    if (adminView) {
      const opts = { search, page, pageSize: MEMBERS_PAGE_SIZE };
      listResult =
        view === "visitors"
          ? await listVisitors(personId, organizationId, opts)
          : view === "inactive"
            ? await listInactive(personId, organizationId, opts)
            : view === "staff"
              ? await listStaff(personId, organizationId, opts)
              : await listFormer(personId, organizationId, opts);
    } else {
      directoryResult = await getDirectory(personId, organizationId, {
        search,
        ...(view === "members"
          ? { rollStatuses: ["active", "baptized", "affiliate"] as const }
          : view === "participants"
            ? { status: "other_participant" as const }
            : {}),
        page,
        pageSize: MEMBERS_PAGE_SIZE,
      });
      if (canManage && directoryResult.kind === "ok") {
        badges = await getCommunityBadges(
          personId,
          organizationId,
          directoryResult.entries.map((e) => e.personId),
        );
      }
    }
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return (
      <MembersLoadError
        backHref={`/o/${slug}/admin/community`}
        heading={HEADING}
      />
    );
  }

  const directoryForbidden = directoryResult?.kind === "forbidden";
  if (directoryForbidden && !canManage) {
    return <MembersForbidden name={resolved.org.name} heading={HEADING} />;
  }
  if (listResult?.kind === "forbidden") {
    return <MembersForbidden name={resolved.org.name} heading={HEADING} />;
  }

  // The sign-in markers (Community Increment 2b): one reader call for the whole
  // page, only for a `people.manage` viewer. `getSignInMarkers` never throws and
  // answers `{}` on any failure, so a marker (chrome) cannot take the page down.
  const markers: Record<string, SignInMarker> = canManage
    ? await getSignInMarkers(
        {
          organizationId,
          actingPersonId: personId,
          actingUserId: session.user.id,
          actingUserEmail: session.user.email ?? null,
        },
        [
          ...(directoryResult?.kind === "ok" ? directoryResult.entries.map((e) => e.personId) : []),
          ...(listResult?.kind === "ok" ? listResult.rows.map((r) => r.personId) : []),
        ],
      )
    : {};

  // The Inactive row's "Mark as regular" dialog says when a person could be
  // connected automatically, which depends on this toggle. Read once, only for
  // the one list whose rows carry that button; `null` omits the line.
  const selfConnectEnabled =
    view === "inactive" && canManage
      ? await getSelfConnectEnabled(personId, organizationId)
      : null;

  const childrenMinistryFlagOn = await isFlagEnabled(CHILDREN_MINISTRY_FLAG);
  const canViewChildrenRoster = childrenMinistryFlagOn
    ? await hasPermission(personId, organizationId, "children.roster")
    : false;
  // The Staff empty state links to the Staff page only when it is reachable.
  const canStaffLink =
    view === "staff" && (await isFlagEnabled(STAFF_FLAG))
      ? await hasPermission(personId, organizationId, "staff.manage")
      : false;

  // The "N waiting" link: holders of either roll key (`roll.approve` or
  // `roll.propose`), decided inside the lib. A failed count hides the count,
  // never the page.
  let pendingLink: { count: number } | null = null;
  try {
    const counted = await countPendingRollActions(personId, organizationId);
    if (counted.kind === "ok") pendingLink = { count: counted.count };
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{HEADING}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {resolved.org.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewChildrenRoster && (
            <Button asChild variant="outline" className="min-h-11">
              <Link href={`/o/${slug}/admin/community/children`}>
                Children&apos;s roster
              </Link>
            </Button>
          )}
          {pendingLink && (
            <Button asChild variant="outline" className="min-h-11">
              <Link
                href={`/o/${slug}/admin/community/pending`}
                aria-label={
                  pendingLink.count > 0
                    ? `Pending approvals, ${pendingLink.count} waiting`
                    : "Pending approvals"
                }
              >
                Pending approvals
                {pendingLink.count > 0 && (
                  <Badge className="ml-2">{pendingLink.count} waiting</Badge>
                )}
              </Link>
            </Button>
          )}
          {canManage && (
            <Button asChild className="min-h-11">
              <Link href={`/o/${slug}/admin/community/new`}>Add person</Link>
            </Button>
          )}
        </div>
      </div>

      <CommunityNav slug={slug} view={view} search={search} canManage={canManage} />

      {directoryForbidden ? (
        <MembersLimited name={resolved.org.name} />
      ) : directoryResult?.kind === "ok" ? (
        <MembersList
          slug={slug}
          view={view}
          entries={directoryResult.entries}
          badges={badges}
          markers={markers}
          canManage={canManage}
          canStaffLink={canStaffLink}
          search={search}
          pagination={directoryResult.pagination}
        />
      ) : listResult?.kind === "ok" ? (
        <MembersList
          slug={slug}
          view={view}
          rows={listResult.rows}
          badges={badges}
          markers={markers}
          canManage={canManage}
          canStaffLink={canStaffLink}
          search={search}
          pagination={listResult.pagination}
          organization={resolved.org.name}
          selfConnectEnabled={selfConnectEnabled}
        />
      ) : null}
    </section>
  );
}
