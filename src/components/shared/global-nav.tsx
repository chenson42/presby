import Link from "next/link";
import type { Session } from "next-auth";
import { publicOrgSummary, type UserOrganization } from "@/lib/authz";
import {
  cachedAvailableOrganizations,
  cachedIsPlatformAdmin,
} from "@/lib/nav-data";
import { sessionCanAccessAdmin } from "@/lib/platform-admin";
import { cn } from "@/lib/utils";
import { AvatarMenu } from "@/components/shared/avatar-menu";
import { OrgSwitcher } from "@/components/shared/org-switcher";

/**
 * The signed-in header: brand, organization switcher, avatar menu.
 *
 * Still a Server Component — the two menus are `'use client'` leaves, which is
 * the shape the nav's previous comment predicted for a mobile toggle. The shell
 * does the reading; Radix does the keyboard, focus and escape behavior inside
 * the leaves, and none of it is hand-rolled.
 *
 * TWO CONTROLS, NOT ONE. Context (which congregation) and identity (which
 * person) are different questions asked at very different rates, and Google
 * separates them for that reason. See the avatar-menu and org-switcher files.
 *
 * Everything here is read-guarded independently. A header is not worth a 500:
 * if the organization list is unreachable the switcher degrades to a name or to
 * nothing, and if the platform-admin column is unreachable the two platform
 * items are simply absent. Neither takes the page with it.
 */
export async function GlobalNav({
  session,
  currentOrgSlug = null,
  contentWidthClassName = "max-w-2xl",
}: {
  session: Session;
  /** Set inside `(org)`; the switcher renders this organization as current. */
  currentOrgSlug?: string | null;
  /** Match the width of the `<main>` the shell renders underneath. */
  contentWidthClassName?: string;
}) {
  const userId = session.user.id;

  const [organizations, isPlatformAdmin] = await Promise.all([
    cachedAvailableOrganizations(userId).catch(
      () => null as UserOrganization[] | null,
    ),
    cachedIsPlatformAdmin(userId).catch(() => false),
  ]);

  let currentName =
    (currentOrgSlug &&
      organizations?.find((org) => org.slug === currentOrgSlug)?.name) ||
    null;

  // DEGRADED PATH ONLY. The current organization's name normally comes out of
  // the list read above, so when that read fails there is no name left to
  // render — and a switcher that vanishes mid-outage tells the user their
  // access was revoked. `publicOrgSummary` is a different query against a
  // different table (`organizations` carries no RLS policy; the org tree is
  // public), so it can survive when the membership function does not. It
  // discloses nothing the page below it does not already say: DECISION-040 has
  // the access-denied page naming the organization outright.
  if (organizations === null && currentOrgSlug) {
    try {
      currentName = (await publicOrgSummary(currentOrgSlug))?.name ?? null;
    } catch {
      currentName = null;
    }
  }

  return (
    <header className="border-b border-border bg-background">
      <div
        className={cn(
          "mx-auto flex items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:px-6",
          contentWidthClassName,
        )}
      >
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <Link
            href="/"
            className="shrink-0 rounded-md px-1 py-1 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            presby
          </Link>
          <OrgSwitcher
            currentName={currentName}
            currentSlug={currentOrgSlug}
            organizations={organizations ?? []}
            unavailable={organizations === null}
          />
        </div>
        <nav aria-label="Account" className="flex shrink-0 items-center">
          <AvatarMenu
            name={session.user.name}
            email={session.user.email}
            canAccessAdmin={sessionCanAccessAdmin(session.user)}
            isPlatformAdmin={isPlatformAdmin}
          />
        </nav>
      </div>
    </header>
  );
}
