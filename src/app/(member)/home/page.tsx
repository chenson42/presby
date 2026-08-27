import Link from "next/link";
import { desc } from "drizzle-orm";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { db } from "@/lib/db";
import { whatsNewEntries } from "@/lib/db/schema";
import {
  getFeedbackPromptState,
  shouldShowFeedbackPrompt,
} from "@/lib/feedback-prompt";
import { isFlagEnabled } from "@/lib/flags";
import { isEnterableOrganization, type UserOrganization } from "@/lib/authz";
import {
  cachedIsPlatformAdmin,
  cachedUserOrganizations,
} from "@/lib/nav-data";
import { sessionCanAccessAdmin } from "@/lib/platform-admin";
import { organizationTypeLabel } from "@/lib/org-display";
import { FEATURES } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import { FeedbackPromptCard } from "@/components/shared/feedback-prompt-card";
import { OrganizationsUnavailable } from "@/components/shared/organizations-unavailable";
import { DestinationCard } from "@/components/shared/destination-card";

// Number of What's-new entries shown in the home card.
const WHATS_NEW_HOME_LIMIT = 3;

/**
 * `/home` — the single post-chooser landing surface (DECISION-124).
 *
 * Absorbs `/orgs`'s content (retired to a `next.config.ts` permanent redirect,
 * DECISION-124) behind `platform.merged_home`, a REQUIRED rollout flag —
 * required because its blast radius is every authenticated sign-in through
 * `/launch`, not because the change is risky. The flag gates ONLY this page's
 * own rendering of the "Your organizations"/"Platform"/"Still being set up"
 * sections, never the routing target: `computeDestination()` already returns
 * `"/home"` unconditionally (destination.ts's own precedent — the flag is
 * deliberately never threaded into that pure function, see its own header
 * comment and DECISION-124). Disabling the flag in an incident is therefore a
 * content-only rollback: this page reverts to exactly its pre-merge shape
 * (greeting, Account settings + Admin dashboard quick links, what's-new,
 * feedback) while remaining the correct landing page.
 *
 * NO `nothingToShow` EMPTY STATE, unlike `/orgs`'s original. Reaching `/home`
 * via the chooser reason already requires `enterableOrgs.length >= 1` or
 * platform access — every other `computeDestination` branch lands somewhere
 * else first. Carrying the empty-state block over from `/orgs` (which needed
 * it because it was independently URL-reachable with no upstream guard) would
 * import an untestable branch, not "carry the degrade over" (Phase 3,
 * docs/work-log/2026-08-27-platform-home-and-portal.md).
 */
// cachedAuth() is memoized via React cache() — calling it here after the
// layout already called it costs nothing (same request, same cached result).
// Note: auth() directly is NOT memoized in next-auth v5 beta.31; the
// layout+page each calling auth() fired the Tier-A DB SELECT twice. See
// src/lib/auth/cached-auth.ts for the empirical basis.
export default async function HomePage() {
  const session = await cachedAuth();
  const user = session!.user;

  const name = user.name ?? user.email ?? "there";
  const featuresList = user.features ?? [];
  const isAdmin = featuresList.includes(FEATURES.ADMIN_DASHBOARD);

  const mergedHomeEnabled = await isFlagEnabled("platform.merged_home");

  // Populated only when the flag is on — the DB reads below are the whole
  // point of the flag's content-only rollback: OFF costs nothing beyond the
  // toggle check itself.
  let enterable: UserOrganization[] = [];
  let pending: UserOrganization[] = [];
  let canAccessAdmin = false;
  let isPlatformAdmin = false;

  if (mergedHomeEnabled) {
    let all: UserOrganization[];
    let platformAdmin: boolean;
    try {
      // The memoized readers (`@/lib/nav-data`), not the raw ones — the
      // header above this page reads exactly the same two values in the
      // same request. `/orgs`'s own precedent.
      [all, platformAdmin] = await Promise.all([
        cachedUserOrganizations(user.id),
        cachedIsPlatformAdmin(user.id),
      ]);
    } catch {
      // Org-list failure degrade, carried over verbatim from `/orgs`'s
      // existing all-or-nothing contract: no greeting, no what's-new, no
      // feedback prompt. A DB outage on this connection plausibly also
      // threatens the reads below on the same pool, so this is the
      // conservative, already-tested choice, not a new judgment call.
      return <OrganizationsUnavailable retryHref="/home" />;
    }
    enterable = all.filter(isEnterableOrganization);
    pending = all.filter(
      (org) => org.endedOn === null && org.platformStatus === "invited",
    );
    canAccessAdmin = sessionCanAccessAdmin(user);
    isPlatformAdmin = platformAdmin;
  }

  const showPlatform = canAccessAdmin || isPlatformAdmin;

  // Feedback prompt state — query even for no-role users (their signal is valuable).
  const promptState = await getFeedbackPromptState(user.id);
  const showFeedbackPrompt = shouldShowFeedbackPrompt(promptState);

  // What's-new entries — latest WHATS_NEW_HOME_LIMIT only; zero entries → card hidden.
  const recentWhatsNew = await db
    .select({
      id: whatsNewEntries.id,
      emoji: whatsNewEntries.emoji,
      title: whatsNewEntries.title,
      body: whatsNewEntries.body,
      publishedAt: whatsNewEntries.publishedAt,
    })
    .from(whatsNewEntries)
    .orderBy(desc(whatsNewEntries.publishedAt))
    .limit(WHATS_NEW_HOME_LIMIT);

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">
        Welcome, {name}.
      </h1>

      {mergedHomeEnabled && (
        <>
          {/*
           * The heading is inside the conditional, not above it — an empty
           * "Your organizations" heading reads as broken, not empty
           * (`/orgs`'s own precedent).
           */}
          {enterable.length > 0 && (
            <section className="mt-8 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Your organizations
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {enterable.map((org) => (
                  <DestinationCard
                    key={org.organizationId}
                    href={`/o/${org.slug}`}
                    title={org.name}
                    badge={organizationTypeLabel(org.organizationType)}
                  />
                ))}
              </div>
            </section>
          )}

          {showPlatform && (
            <section className="mt-8 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Platform
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {/*
                 * Two predicates, not one (DECISION-044). `canAccessAdmin` is
                 * the session claim the Edge enforces on /admin;
                 * `isPlatformAdmin` is users.is_platform_admin, read live, and
                 * gates the Developer portal. Holding one does not imply the
                 * other.
                 */}
                {canAccessAdmin && (
                  <DestinationCard
                    href="/admin"
                    title="Admin"
                    badge="Platform"
                    description="Users, roles, flags, and the platform operations shell."
                  />
                )}
                {isPlatformAdmin && (
                  <DestinationCard
                    href="/developer"
                    title="Developer"
                    badge="Platform"
                    description="Schema reference, tables, and entity diagrams."
                  />
                )}
              </div>
            </section>
          )}

          {pending.length > 0 && (
            <section className="mt-8 space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Still being set up
              </h2>
              {/*
               * No card and no link: there is nothing behind an `invited`
               * organization to enter yet. Naming it is safe because the user
               * holds a relationship there.
               */}
              <ul className="space-y-1">
                {pending.map((org) => (
                  <li
                    key={org.organizationId}
                    className="text-sm text-muted-foreground"
                  >
                    {org.name} is being set up. We&apos;ll email you when
                    it&apos;s ready.
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick links
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/account">Account settings</Link>
          </Button>
          {/*
           * Dropped when the merged sections render: the Platform section
           * above already covers /admin, and showing it twice reads as a bug,
           * not a convenience (Phase 3). Flag OFF restores this exactly as it
           * was before the merge.
           */}
          {!mergedHomeEnabled && isAdmin && (
            <Button asChild variant="outline">
              <Link href="/admin">Admin dashboard</Link>
            </Button>
          )}
        </div>
      </section>

      {/* What's-new card — hidden when zero entries; shown above feedback card */}
      {recentWhatsNew.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What&apos;s new
          </h2>
          <ul className="mt-3 space-y-3">
            {recentWhatsNew.map((entry) => (
              <li key={entry.id} className="text-sm">
                {/* XSS invariant: all content rendered as JSX text nodes */}
                {entry.emoji && <span className="mr-1">{entry.emoji}</span>}
                <span className="font-medium">{entry.title}</span>
                <p className="mt-0.5 text-muted-foreground">{entry.body}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <FormattedDate value={entry.publishedAt} mode="date" />
                </p>
              </li>
            ))}
          </ul>
          <Link
            href="/whats-new"
            className="mt-3 inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            See all →
          </Link>
        </section>
      )}

      {/* Daily feedback prompt card — suppressed after snooze/submit/opt-out for today */}
      {showFeedbackPrompt && (
        <section className="mt-8">
          <FeedbackPromptCard />
        </section>
      )}
    </>
  );
}
