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
import { OrgWordmark } from "@/components/brand/org-mark";

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

// The wordmark link, not a button: no border, no fill, no hover affordance.
// rounded/px/font-semibold exist for the focus ring's hit area and the
// logotype weight, not to imitate <Button>. Hoisted to a constant (rather
// than inlined in the JSX below) so the ui-ok comment can sit on the line
// directly above the flagged string — a JSX comment can't, without
// rendering as literal page text.
// ui-ok: wordmark link, styled for a focus ring and logotype weight, not a button imitation
const WORDMARK_LINK_CLASS = "shrink-0 rounded-md px-1 py-1 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export async function GlobalNav({
  session,
  currentOrgSlug = null,
  contentWidthClassName = "max-w-2xl",
  orgMark = null,
  signOutRedirectTo,
  feedbackHref,
}: {
  session: Session;
  /** Set inside `(org)`; the switcher renders this organization as current. */
  currentOrgSlug?: string | null;
  /** Match the width of the `<main>` the shell renders underneath. */
  contentWidthClassName?: string;
  /** Passed straight through to `AvatarMenu` — see its own doc comment.
   * Omitted by every caller except `(org)/o/[slug]/layout.tsx`. */
  signOutRedirectTo?: string;
  /**
   * Portal-chrome pipeline (docs/work-log/2026-08-25-portal-chrome.md,
   * Phase 3). Set ONLY by `(org)/o/[slug]/layout.tsx`, and only when
   * `org_portal.chrome_v2` is ON and the slug resolved to an active
   * relationship — every other caller (and `(org)` itself when the flag is
   * OFF) passes nothing, and the "presby" wordmark renders exactly as it
   * does today. GlobalNav does NOT gate on the flag itself and reads no
   * brand data of its own — it stays brand-blind for `(member)`/`(admin)`;
   * the caller already did both the flag check and the membership-verified
   * read (`getOrgMarkForLayout`) before handing this prop over.
   */
  orgMark?: { name: string; markSrc: string | null } | null;
  /**
   * Feedback relocation (docs/work-log/2026-08-27-product-ia-scaffold.md
   * §6a, DECISION-117). Pure passthrough to `AvatarMenu` — same shape as
   * `signOutRedirectTo`. Set ONLY by `(org)/o/[slug]/layout.tsx`, only when
   * `org_portal.feedback` is ON and the slug resolved to an active
   * relationship. GlobalNav does NOT gate on the flag itself.
   */
  feedbackHref?: string;
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
          {orgMark && currentOrgSlug ? (
            // Links to the PUBLIC site, not the portal home (2026-08-26
            // refinement) -- the logo is this organization's mark first,
            // portal chrome second; a visitor clicking it expects the
            // public-facing identity it represents, and the portal itself
            // stays one click away via the account/nav surfaces already on
            // the page.
            <Link
              href={`/site/${currentOrgSlug}`}
              className={cn(WORDMARK_LINK_CLASS, "px-0 py-0")}
              aria-label={`${orgMark.name} public site`}
            >
              {/* The uploaded asset is a wide lockup (icon + name), not a
               * square icon -- OrgMark would crop it; OrgWordmark renders it
               * un-cropped at its own aspect ratio (G7), inline with the nav
               * row the same way fpcw-directory's own header does.
               * plate={false}: this header already sits on plain
               * bg-background, never brand-tinted or dark, so G7's neutral
               * card is redundant chrome here (2026-08-26 refinement). */}
              <OrgWordmark name={orgMark.name} markSrc={orgMark.markSrc} plate={false} />
            </Link>
          ) : (
            <Link href="/" className={WORDMARK_LINK_CLASS}>
              presby
            </Link>
          )}
          <OrgSwitcher
            currentName={currentName}
            currentSlug={currentOrgSlug}
            organizations={organizations ?? []}
            unavailable={organizations === null}
            compact={!!orgMark}
          />
        </div>
        <nav aria-label="Account" className="flex shrink-0 items-center">
          <AvatarMenu
            name={session.user.name}
            email={session.user.email}
            canAccessAdmin={sessionCanAccessAdmin(session.user)}
            isPlatformAdmin={isPlatformAdmin}
            signOutRedirectTo={signOutRedirectTo}
            feedbackHref={feedbackHref}
          />
        </nav>
      </div>
    </header>
  );
}
