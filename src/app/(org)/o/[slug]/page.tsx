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
import { listUpcomingMemberEvents } from "@/lib/calendar";
import { getPortalHomeData } from "@/lib/org-portal/home-data";
import { getViewerGroups } from "@/lib/org-portal/my-groups";
import {
  composeMainRow,
  UPCOMING_EVENTS_LIMIT,
  type Loaded,
} from "@/lib/org-portal/main-row";
import { DOMAIN_LABELS, DOMAIN_ORDER } from "@/lib/org-portal/tiles";
import { visiblePortalTiles } from "@/lib/org-portal/visible-tiles";
import { GreetingBand } from "@/components/shared/greeting-band";
import { FindPersonForm } from "@/components/org-portal/find-person-form";
import { HomeMainRow } from "@/components/org-portal/home-main-row";
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
 * home: a time-aware greeting, find-a-person (only for `directory.view`
 * holders), the main row ("Yours" and "Coming up"), and the flag-gated tile
 * grid `OrgPortalStub`'s four links became. Both branches
 * coexist deliberately (Phase 3: "Remove `OrgPortalStub` ... once the v2
 * path is default; until then both coexist") — this pipeline does not flip
 * the flag on, so nothing here changes what a fork sees until a later
 * increment turns it on.
 *
 * INDEPENDENT FAILURE DOMAINS (DECISION-162). After the gate, ONE
 * `Promise.all` runs the flag reads, the tile registry, the feedback-prompt
 * state and three tenant loaders — `getPortalHomeData`, `getViewerGroups`,
 * `listUpcomingMemberEvents` — each in its own `withOrgContext()` transaction
 * (Postgres aborts a transaction after a failed statement, so independent
 * widgets cannot share one). Each loader goes through `loadWidget` below:
 * `OrgAccessError` re-throws to `error.tsx`; any other failure logs a fixed
 * string with ids only and returns a failed marker. How each renders:
 *
 *   home read fails    → greeting "Welcome."; find-a-person hidden (whether the
 *                        viewer may use the directory is unknown: fail closed);
 *                        household absent
 *   groups read fails  → the groups block is omitted (absence makes no claim)
 *   events read fails  → "Coming up" shows its "can't load" copy (a missing
 *                        card would be indistinguishable from "no events")
 *   events `disabled` / `forbidden` → no card, no message
 *
 * The page asks NO permission question of its own except `directory.view`
 * (via `getPortalHomeData`'s `canViewDirectory`), and reads NO calendar flag —
 * the calendar's per-org toggle and `events.view` are evaluated inside
 * `listUpcomingMemberEvents`, and its `kind` decides the card (DECISION-162).
 * Which cards exist and how many columns is `composeMainRow`, a pure function.
 * No `Suspense` and no `loading.tsx` (the `(org)` contract; a streamed boundary
 * would flush a 200 before an `OrgAccessError` could render).
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

  const ids = {
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
  };

  // org_portal.motion gates ONLY the greeting band's mount fade-in. The
  // feedback prompt state is keyed by the signed-in user's own users.id — NOT
  // resolved.org.personId, a different id space feedbackPromptState does not
  // recognize.
  const [
    motionEnabled,
    directoryEnabled,
    directoryV2Enabled,
    feedbackEnabled,
    home,
    groups,
    events,
    tiles,
    promptState,
  ] = await Promise.all([
    isFlagEnabled("org_portal.motion"),
    isFlagEnabled("org_portal.directory"),
    isFlagEnabled("org_portal.directory_v2"),
    isFlagEnabled("org_portal.feedback"),
    loadWidget("home", ids, () =>
      getPortalHomeData(ids.personId, ids.organizationId),
    ),
    loadWidget("groups", ids, () =>
      getViewerGroups(ids.personId, ids.organizationId),
    ),
    loadWidget("events", ids, () =>
      listUpcomingMemberEvents(ids.personId, ids.organizationId, {
        limit: UPCOMING_EVENTS_LIMIT,
      }),
    ),
    visiblePortalTiles("operate", resolved.org.organizationType, ids),
    getFeedbackPromptState(session.user.id),
  ]);

  const homeData = home.ok ? home.value : null;
  // Unknown (the home read failed) is the same as "no": fail closed.
  const canViewDirectory = homeData?.canViewDirectory === true;
  const plan = composeMainRow({
    household: homeData?.household ?? null,
    groups: groups.ok ? groups.value : [],
    events,
  });
  const showFeedbackPrompt =
    feedbackEnabled && shouldShowFeedbackPrompt(promptState);

  return (
    <div className="space-y-8">
      <GreetingBand
        displayName={homeData?.displayName ?? null}
        motionEnabled={motionEnabled}
      />
      {canViewDirectory && <FindPersonForm slug={resolved.org.slug} />}
      <HomeMainRow
        slug={resolved.org.slug}
        plan={plan}
        householdPageEnabled={directoryEnabled && directoryV2Enabled}
      />
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

/**
 * One widget's read, as an independent failure domain. `OrgAccessError` (the
 * relationship vanished mid-request) re-throws so `error.tsx`'s copy — not a
 * silent degrade — is what the member sees; anything else logs a FIXED string
 * with ids only (never the error, its message or its stack: a driver message
 * can embed a SQL fragment) and returns a failed marker the render handles.
 */
async function loadWidget<T>(
  widget: "home" | "groups" | "events",
  ids: { personId: string; organizationId: string },
  read: () => Promise<T>,
): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    console.error("[org-home] widget read failed; degrading", {
      widget,
      ...ids,
    });
    return { ok: false };
  }
}
