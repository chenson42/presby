import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import {
  getFeedbackPromptState,
  shouldShowFeedbackPrompt,
} from "@/lib/feedback-prompt";
import { isFlagEnabled } from "@/lib/flags";
import { getPortalHomeData } from "@/lib/org-portal/home-data";
import {
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  visiblePortalTiles,
} from "@/lib/org-portal/tiles";
import { GreetingBand } from "@/components/shared/greeting-band";
import { FindPersonForm } from "@/components/org-portal/find-person-form";
import { YoursZone } from "@/components/org-portal/yours-zone";
import { DomainTileSections } from "@/components/shared/domain-tile-sections";
import { TILE_ICONS } from "@/components/org-portal/tile-icons";
import { FeedbackPromptCard } from "@/components/shared/feedback-prompt-card";
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
 *
 * DOMAIN-SECTIONED TILE GRID (commit 2, docs/work-log/
 * 2026-08-27-product-ia-scaffold.md, Phase 3, DECISION-117): the flat
 * `TileGrid` this page rendered directly is replaced with
 * `DomainTileSections`, which buckets the same `visiblePortalTiles("operate",
 * ...)` result into labeled `<section id="domain-<key>">`s that
 * `portal-nav.tsx`'s domain-anchor entries scroll to. No change to WHICH
 * tiles are visible — only how they're grouped on the page.
 *
 * FEEDBACK-PROMPT CARD, LAST CHILD (mid-design operator correction, §6b of
 * the same work-log): the platform's existing dismissible daily prompt card
 * (`src/components/shared/feedback-prompt-card.tsx`, moved here unmodified
 * from `(member)/home/`) renders at the bottom of this page, mirroring
 * `/home`'s own bottom placement — gated on `org_portal.feedback` AND the
 * shared `shouldShowFeedbackPrompt()` suppression rule (opted out / snoozed
 * today / submitted today), using the SAME two functions `/home` calls
 * (`src/lib/feedback-prompt.ts`). `getFeedbackPromptState()` is keyed by the
 * signed-in user's own `session.user.id` (a platform-wide `users.id`), NOT
 * `resolved.org.personId` — the org-scoped person id is a different id
 * space `feedbackPromptState` does not recognize. Flag OFF or
 * daily-suppressed → renders nothing: a passive nudge widget that
 * disappears is not a "coming soon" stub, it's just absent, matching
 * `/home`'s own existing behavior.
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
  // home page down — it degrades to `null`, which GreetingBand and YoursZone
  // both already treat as "nothing to show" rather than an error. Only
  // OrgAccessError (the relationship vanishing mid-request) re-throws, so
  // error.tsx's copy — not a silent "Welcome." — is what a member sees.
  //
  // org_portal.motion (Phase 3, docs/work-log/
  // 2026-08-26-portal-visual-modernization.md) gates ONLY the greeting
  // band's mount fade-in, read alongside the home-data fetch below and
  // threaded through as GreetingBand's required `motionEnabled` prop.
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

  const tiles = await visiblePortalTiles("operate", resolved.org.organizationType);

  // Feedback prompt (mid-design operator correction, §6b): flag-gated AND
  // suppressed by the same shared rule /home applies. Keyed by the
  // signed-in user's own users.id — NOT resolved.org.personId, a different
  // id space feedbackPromptState does not recognize.
  const [feedbackEnabled, promptState] = await Promise.all([
    isFlagEnabled("org_portal.feedback"),
    getFeedbackPromptState(session.user.id),
  ]);
  const showFeedbackPrompt =
    feedbackEnabled && shouldShowFeedbackPrompt(promptState);

  return (
    <div className="space-y-8">
      <GreetingBand
        displayName={homeData?.displayName ?? null}
        motionEnabled={motionEnabled}
      />
      <FindPersonForm slug={resolved.org.slug} />
      <YoursZone slug={resolved.org.slug} household={homeData?.household ?? null} />
      <DomainTileSections
        tiles={tiles}
        getHref={(tile) => tile.href(resolved.org.slug)}
        getIcon={(tile) => TILE_ICONS[tile.key]}
        domainOrder={DOMAIN_ORDER}
        domainLabels={DOMAIN_LABELS}
      />
      {showFeedbackPrompt && <FeedbackPromptCard />}
    </div>
  );
}
