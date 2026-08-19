import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { isEnterableOrganization, type UserOrganization } from "@/lib/authz";
import {
  cachedIsPlatformAdmin,
  cachedUserOrganizations,
} from "@/lib/nav-data";
import { sessionCanAccessAdmin } from "@/lib/platform-admin";
import { organizationTypeLabel } from "@/lib/org-display";
import { OrganizationsUnavailable } from "@/components/shared/organizations-unavailable";
import { Button } from "@/components/ui/button";
import { DestinationCard } from "./destination-card";

export const metadata: Metadata = {
  title: "Where would you like to go?",
};

/**
 * `/orgs` — the chooser.
 *
 * IT ALWAYS RENDERS AND NEVER AUTO-FORWARDS, even for a user with exactly one
 * organization. The forwarding decision belongs to `/launch`; if it lived here
 * too, a zero-organization platform admin would be bounced to `/admin` and
 * could never reach the Developer card. It is also how a deep link stays a deep
 * link: the chooser is a convenience, never a gate, and every `/o/*` route
 * authorizes itself independently.
 *
 * CARDS CARRY NO MEMBERSHIP LANGUAGE (DECISION-039). A card is a
 * RELATIONSHIP, not a roll status: the church secretary who worships elsewhere,
 * the ruling elder serving a presbytery committee, and the installed pastor
 * whose membership is at the presbytery all get one. "Member of" is wrong for
 * every one of them and, for the secretary, mildly insulting. Organization name
 * and type, and nothing else.
 *
 * Cards come from `memberships` alone — never from `organizations.path` or
 * `parent_id`. A presbytery staffer who stewards forty non-tenant
 * congregations gets exactly ONE card, for the presbytery. Stewardship in the
 * card list is downward inheritance through the back door, and it would arrive
 * looking like a helpful feature.
 */
export default async function OrgsPage() {
  const session = await cachedAuth();
  // The (member) layout also guards this, but it hard-codes callbackUrl=/home
  // because a layout cannot see the pathname. This page can, so a signed-out
  // visit returns here rather than dumping the user on /home.
  if (!session?.user) redirect("/signin?callbackUrl=/orgs");

  let all: UserOrganization[];
  let isPlatformAdmin: boolean;
  try {
    // The unfiltered list, because this page needs both halves: the enterable
    // organizations become cards, and the ones still being set up become the
    // notice below them. One round trip answers both.
    //
    // The memoized readers (`@/lib/nav-data`), not the raw ones, because the
    // header above this page reads exactly the same two values. Without the
    // shared per-request cache, rendering /orgs would issue each query twice.
    [all, isPlatformAdmin] = await Promise.all([
      cachedUserOrganizations(session.user.id),
      cachedIsPlatformAdmin(session.user.id),
    ]);
  } catch {
    return <OrganizationsUnavailable retryHref="/orgs" />;
  }

  const enterable = all.filter(isEnterableOrganization);
  const pending = all.filter(
    (org) => org.endedOn === null && org.platformStatus === "invited",
  );
  const canAccessAdmin = sessionCanAccessAdmin(session.user);
  const showPlatform = canAccessAdmin || isPlatformAdmin;
  const nothingToShow =
    enterable.length === 0 && pending.length === 0 && !showPlatform;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Where would you like to go?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You can come back to this page at any time.
        </p>
      </div>

      {/*
       * The heading is inside the conditional, not above it. A platform admin
       * with no congregations must not read an empty "Your organizations"
       * heading — an empty section titled as though it should have contents is
       * how a working account looks broken.
       */}
      {enterable.length > 0 && (
        <section className="space-y-3">
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
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Platform
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {/*
             * Two predicates, not one (DECISION-044). `canAccessAdmin` is the
             * session claim the Edge enforces on /admin; `isPlatformAdmin` is
             * users.is_platform_admin, read live, and gates the Developer
             * portal. Holding one does not imply the other, and rendering a
             * card for a surface the Edge will bounce is a worse experience
             * than not rendering it.
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
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Still being set up
          </h2>
          {/*
           * No card and no link: there is nothing behind an `invited`
           * organization to enter yet. Naming it is safe because the user holds
           * a relationship there — this is not the same disclosure as the
           * access-denied page, which must never vary by platform status.
           */}
          <ul className="space-y-1">
            {pending.map((org) => (
              <li key={org.organizationId} className="text-sm text-muted-foreground">
                {org.name} is being set up. We&apos;ll email you when it&apos;s
                ready.
              </li>
            ))}
          </ul>
        </section>
      )}

      {nothingToShow && (
        <section className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium">
            You&apos;re not connected to a congregation yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Your account is set up, but nobody has added you to a church,
            presbytery, or synod.
          </p>
          <Button asChild variant="outline" className="mt-6 min-h-11">
            <Link href="/no-organization">What to do next</Link>
          </Button>
        </section>
      )}
    </div>
  );
}
