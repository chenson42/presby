import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { resolveOrgContext, type OrganizationType } from "@/lib/authz";
import { getOrgBrandForLayout, getOrgMarkForLayout } from "@/lib/brand/read-org-brand";
import { isFlagEnabled } from "@/lib/flags";
import { getOrgProfileForFooter, type OrgProfileForFooter } from "@/lib/sites";
import { BrandTokens } from "@/components/brand/brand-tokens";
import { GlobalNav } from "@/components/shared/global-nav";
import { PortalFooter } from "@/components/org-portal/portal-footer";
import { PortalNav } from "./portal-nav";
import { cn } from "@/lib/utils";

/**
 * The organization shell.
 *
 * It lives at `[slug]` rather than at `(org)` because the header names the
 * organization you are in, and only a layout inside the dynamic segment can see
 * which one that is.
 *
 * STILL NOT THE GATE, and it must never become one. `page.tsx` resolves the
 * slug and calls `assertOrgAccess()`; this layout reads the session only so the
 * header knows whose menus to draw. It passes the slug to `GlobalNav`, which
 * looks it up in the user's OWN organization list — so a slug the user has no
 * relationship with simply does not match, and the switcher falls back to its
 * no-context rendering rather than naming an organization as "current" that the
 * user was just denied.
 *
 * The header renders on the access-denied, relationship-ended and 404 pages too.
 * That is the point: those are the pages a user most needs a way out of, and
 * the switcher is the way out.
 *
 * BRAND EMISSION (P0.5 slice c, commit `c4`) hangs off the exact same
 * "renders on every page under here" property, deliberately. This layout
 * resolves the slug against the user's OWN membership set — same mechanism
 * `page.tsx` uses, independently, for its own gate — and only when that
 * resolves to an ACTIVE relationship does it ask `getOrgBrandForLayout()` for
 * this organization's tokens. Every other outcome (`forbidden`, `ended`,
 * `not-found`, no session) leaves `orgBrand` at `null`, `<BrandTokens>`
 * renders `null`, and the access-denied / ended / 404 pages this layout
 * wraps stay on the platform palette — DECISION-040's byte-identical copy is
 * untouched, because nothing here varies STRUCTURE or TEXT, only which
 * custom properties a `<style>` tag declares. `getOrgBrandForLayout()` itself
 * re-verifies membership inside `withOrgContext()` regardless of what this
 * resolve found, so a relationship that vanishes in the gap degrades to
 * `null`, not to a crash or to someone else's colours.
 *
 * PORTAL CHROME (docs/work-log/2026-08-25-portal-chrome.md, Phase 3) hangs
 * off the SAME "active relationship only" gate, behind its own flag
 * (`org_portal.chrome_v2`) so the header-identity swap and the persistent
 * nav row ship — and roll back — as one unit. The flag is read in parallel
 * with `resolveOrgContext()` (nothing about it depends on that resolve), but
 * `orgMark`/the `<PortalNav>` row are only ever populated inside the SAME
 * `resolved.kind === "ok"` branch `orgBrand` already uses — flag ON with a
 * `forbidden`/`ended`/`not-found`/no-session outcome renders neither, same
 * as brand emission, so DECISION-040's byte-identical copy on those pages
 * stays untouched.
 *
 * PORTAL FOOTER (docs/work-log/2026-08-26-portal-fpcw-directory-ux.md, Phase
 * 3, Increment 3) is a THIRD, INDEPENDENT flag (`org_portal.chrome_v3`) —
 * deliberately NOT folded into `chrome_v2`, which is already fully rolled
 * out with no partial-rollout room to extend (Phase 1's own finding). Read
 * in the SAME `Promise.all` as `resolveOrgContext()`/`chrome_v2`, and — same
 * DECISION-040 discipline as `orgBrand`/`orgMark`/`showPortalNav` — the
 * footer's data fetch (`getOrgProfileForFooter`) and its render both happen
 * ONLY inside the `resolved.kind === "ok"` branch. `<PortalFooter>` renders
 * as a sibling after `<main>`, inside the `session?.user` branch only —
 * never on the no-session fallback header.
 */
export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await cachedAuth();

  let orgBrand: Awaited<ReturnType<typeof getOrgBrandForLayout>> = null;
  let orgMark: { name: string; markSrc: string | null } | null = null;
  let showPortalNav = false;
  // Bug fix, docs/work-log/2026-08-27-credentials-tile-org-type.md: threaded
  // into BOTH `<PortalNav>` and `<PortalFooter>` — the two independent
  // `visiblePortalTiles()` callers this layout wires up — from the SAME
  // `resolved.kind === "ok"` branch `orgBrand`/`orgMark` already use, no new
  // query. Set unconditionally inside that branch (not gated on either
  // `chromeV2Enabled` or `chromeV3Enabled`) because chrome_v2 and chrome_v3
  // are independent rollback units and either could be the only one on.
  let orgOrganizationType: OrganizationType | null = null;
  let showFooter = false;
  let footerProfile: OrgProfileForFooter | null = null;
  let footerOrgName = "";
  if (session?.user) {
    const [resolved, chromeV2Enabled, chromeV3Enabled] = await Promise.all([
      resolveOrgContext(session.user.id, slug),
      isFlagEnabled("org_portal.chrome_v2"),
      isFlagEnabled("org_portal.chrome_v3"),
    ]);
    if (resolved.kind === "ok") {
      orgOrganizationType = resolved.org.organizationType;
      // BOTH ids from the SAME resolution, not `session.user.id` — see
      // read-org-brand.ts's header comment for why that distinction is
      // load-bearing (`users.id` vs. `people.id`) and not a style choice.
      if (chromeV2Enabled) {
        const [brand, mark] = await Promise.all([
          getOrgBrandForLayout(resolved.org.organizationId, resolved.org.personId),
          getOrgMarkForLayout(resolved.org.organizationId, resolved.org.personId),
        ]);
        orgBrand = brand;
        orgMark = { name: resolved.org.name, markSrc: mark?.markSrc ?? null };
        showPortalNav = true;
      } else {
        orgBrand = await getOrgBrandForLayout(
          resolved.org.organizationId,
          resolved.org.personId,
        );
      }

      // Footer is gated on its OWN flag, independently of chrome_v2 — see
      // this file's header comment.
      if (chromeV3Enabled) {
        footerProfile = await getOrgProfileForFooter(
          resolved.org.organizationId,
          resolved.org.personId,
        );
        footerOrgName = resolved.org.name;
        showFooter = true;
      }
    }
  }

  return (
    <>
      <BrandTokens brand={orgBrand?.tokens ?? null} lightOnly={orgBrand?.lightOnly ?? false} />
      {session?.user ? (
        <>
          <GlobalNav
            session={session}
            currentOrgSlug={slug}
            contentWidthClassName="max-w-6xl"
            orgMark={orgMark}
            signOutRedirectTo={`/site/${slug}`}
          />
          {showPortalNav && orgOrganizationType ? (
            <PortalNav slug={slug} organizationType={orgOrganizationType} />
          ) : null}
        </>
      ) : (
        // Unreachable in practice — every page under here redirects a signed-out
        // visitor to /signin. Rendered anyway so that a future route which
        // forgets to, or a render that races a sign-out in another tab, gets a
        // header with a way home instead of a crash on `session.user`.
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex max-w-6xl items-center px-4 py-3 sm:px-6">
            <Link href="/" className="text-sm font-semibold">
              presby
            </Link>
          </div>
        </header>
      )}
      <main
        className={cn(
          "mx-auto max-w-6xl px-6 py-12",
          orgBrand?.fontPairing.bodyClassName,
        )}
      >
        {children}
      </main>
      {session?.user && showFooter && orgOrganizationType ? (
        <PortalFooter
          slug={slug}
          organizationName={footerOrgName}
          organizationType={orgOrganizationType}
          profile={footerProfile}
        />
      ) : null}
    </>
  );
}
