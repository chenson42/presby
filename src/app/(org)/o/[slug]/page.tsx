import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { getPortalHomeData } from "@/lib/org-portal/home-data";
import { visiblePortalTiles } from "@/lib/org-portal/tiles";
import { Greeting } from "@/components/org-portal/greeting";
import { FindPersonForm } from "@/components/org-portal/find-person-form";
import { YoursZone } from "@/components/org-portal/yours-zone";
import { TileGrid } from "@/components/org-portal/tile-grid";
import {
  OrgAccessDenied,
  OrgAccessEnded,
  OrgPortalStub,
} from "./org-states";

/**
 * `/o/<slug>` — the organization landing page, and the first route in the
 * `(org)` tree (see the contract in `(org)/layout.tsx`).
 *
 * THE FOUR-WAY MISS RESPONSE (DECISION-040) is the substance of this page's
 * gate, unchanged since P0:
 *
 *   active relationship at a `managed` org  → enter
 *   ENDED relationship at that org          → named and dated
 *   the slug is in the public org tree,     → access denied, naming it, with
 *   but no relationship                       ONE string for `managed`,
 *                                             `invited` and `unmanaged` alike
 *   the slug is nothing                     → 404
 *
 * THE RESOLUTION ORDER IS THE SECURITY PROPERTY. `resolveOrgContext()` resolves
 * the slug INSIDE the user's own relationship set; it never looks
 * `organizations` up by slug and hands the id to `withOrgContext()`, because
 * that table is not tenant-isolated and the lookup succeeds for every
 * organization on the platform.
 *
 * The auth check is here rather than in the layout on purpose: a layout cannot
 * see the pathname, so it would have to guess a `callbackUrl` and lose the deep
 * link — which is exactly the defect `(member)/layout.tsx` carries.
 *
 * PAST THE GATE, THIS PAGE BRANCHES ON `org_portal.home_v2` (Phase 3,
 * Increment 1). OFF renders the unchanged P0 stand-in, `OrgPortalStub` — the
 * regression floor this increment ships against. ON renders the real portal
 * home: a time-aware greeting, find-a-person, the "yours" zone, and the
 * flag-gated tile grid `OrgPortalStub`'s four links became. Both branches
 * coexist deliberately (Phase 3: "Remove `OrgPortalStub` ... once the v2
 * path is default; until then both coexist") — this pipeline does not flip
 * the flag on, so nothing here changes what a fork sees until a later
 * increment turns it on.
 */
export default async function OrgPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}`)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      // A real 404, rendered by not-found.tsx.
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

  // The authoritative gate: an in-transaction membership re-check that reads
  // nothing. `resolveOrgContext` ran outside any transaction and is therefore
  // not the gate; this is. Every `(org)` page calls it — including the ones
  // with no tenant data to read, because the first page that skips it is the
  // hole. It throws OrgAccessError if the relationship vanished in between,
  // which error.tsx catches.
  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const homeV2Enabled = await isFlagEnabled("org_portal.home_v2");

  if (!homeV2Enabled) {
    const directoryEnabled = await isFlagEnabled("org_portal.directory");
    const rolesEnabled = await isFlagEnabled("org_portal.roles");
    const ticketsEnabled = await isFlagEnabled("org_portal.tickets");

    return (
      <OrgPortalStub
        name={resolved.org.name}
        organizationType={resolved.org.organizationType}
        slug={resolved.org.slug}
        directoryEnabled={directoryEnabled}
        rolesEnabled={rolesEnabled}
        ticketsEnabled={ticketsEnabled}
      />
    );
  }

  // getPortalHomeData() reads a NON-ESSENTIAL summary (the viewer's own
  // display name and household). A DB failure here must not take the whole
  // home page down — it degrades to `null`, which Greeting and YoursZone
  // both already treat as "nothing to show" rather than an error. Only
  // OrgAccessError (the relationship vanishing mid-request) re-throws, so
  // error.tsx's copy — not a silent "Welcome." — is what a member sees.
  //
  // org_portal.motion (Phase 3, docs/work-log/
  // 2026-08-26-portal-visual-modernization.md) gates ONLY the greeting
  // band's mount fade-in, read alongside the home-data fetch below and
  // threaded through as Greeting's required `motionEnabled` prop.
  const motionEnabled = await isFlagEnabled("org_portal.motion");

  let homeData: Awaited<ReturnType<typeof getPortalHomeData>> | null = null;
  try {
    homeData = await getPortalHomeData(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    homeData = null;
  }

  const tiles = await visiblePortalTiles("operate");

  return (
    <div className="space-y-8">
      <Greeting
        displayName={homeData?.displayName ?? null}
        motionEnabled={motionEnabled}
      />
      <FindPersonForm slug={resolved.org.slug} />
      <YoursZone slug={resolved.org.slug} household={homeData?.household ?? null} />
      <TileGrid slug={resolved.org.slug} tiles={tiles} />
    </div>
  );
}
