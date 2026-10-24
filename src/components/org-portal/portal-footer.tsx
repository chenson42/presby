import Link from "next/link";
import { cn } from "@/lib/utils";
import { getPortalMenu, type TileViewer } from "@/lib/org-portal/visible-tiles";
import type { OrganizationType } from "@/lib/authz";
import type { OrgProfileForFooter } from "@/lib/sites";

const LINK_CLASS =
  "flex min-h-11 items-center hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The portal footer — Increment 3 of docs/work-log/
 * 2026-08-26-portal-fpcw-directory-ux.md. Server Component, no `'use
 * client'`: nothing here needs interactivity.
 *
 * ONE STRUCTURE WITH THE NAV (portal-sitemap-footer pipeline, docs/work-log/
 * 2026-10-23-portal-sitemap-footer.md, DECISION-220/221): the footer renders
 * the same `PortalMenu` the nav row does (`buildPortalMenu()` in
 * `src/lib/org-portal/portal-menu.ts`), so a title can never differ between
 * them. Home, the domain entries and the Administration rule all live in that
 * builder, not here.
 *
 * INDEPENDENT READ, LIKE `PortalNav`'s OWN PRECEDENT: calls `getPortalMenu()`
 * itself rather than accepting the menu as a prop from `layout.tsx`/
 * `PortalNav` — the "self-sufficient, independently-read chrome" shape both
 * components document (a degraded footer does not take the nav down, and
 * vice versa). The reads underneath are `cache()`-keyed on primitive ids, so
 * the second caller in a request costs nothing.
 *
 * THREE BLOCKS, IN ORDER, per Phase 3's Component Plan:
 *
 *   1. Contact info — org name + address + a `tel:` phone link. Omitted
 *      ENTIRELY (not an empty bordered section, not a "no contact info on
 *      file" placeholder) when `profile` is `null` or both `address` and
 *      `phone` are `null` — a brand-new tenant with no `organization_profiles`
 *      row yet must render a working footer, not a broken layout or missing-
 *      data copy (Phase 1 Gap 3 / Phase 3 Edge Cases). Checked as
 *      `profile?.address || profile?.phone` (truthy on either), never
 *      `!!profile` alone, so a row with only ONE of the two fields set still
 *      renders that one line. The address/phone lines render at `text-base`
 *      (`TYPE_SCALE`'s `body` role), an explicit override of the wrapping
 *      div's ambient `text-sm` — `TYPE_SCALE` itself forbids `dense`/
 *      `text-sm` for a paragraph a member needs to read (docs/work-log/
 *      2026-08-26-portal-visual-modernization.md Phase 3). The org-name
 *      label, the site map, and the copyright line stay `text-sm` — all
 *      legitimate label/metadata/legal-boilerplate uses `TYPE_SCALE`'s
 *      `dense` role explicitly permits.
 *   2. Site map — `<nav aria-label="Footer">`. Home is a leading plain link
 *      row, NOT a column. Every other menu entry with at least one child is a
 *      column: a plain-text `<h2>` heading (never a link, so the footer holds
 *      one "Community" link, to the page, and no second one to an anchor) and
 *      a `<ul aria-labelledby>` of the entry's children. An entry with no
 *      children renders no column — never a heading without items, never an
 *      empty `<ul>`. Administration's only child is "Administration
 *      overview" (operator ruling Q1: the footer never lists individual
 *      administer tiles). A `comingSoon` child shows the words "Coming soon"
 *      as plain muted text. The columns sit in a WRAPPING grid (2 / 3 / 4
 *      columns at the base / `sm` / `lg` breakpoints) rather than a fixed
 *      count, labels wrap (`min-w-0`, `break-words`), and links keep the 44px
 *      target. NEVER `<details>`: the iOS `<details>`/`<summary>` failure is
 *      recorded in CLAUDE.md's Verify-in-a-Browser invariant. No active-state
 *      styling — this is a footer, not the persistent nav row.
 *   3. Copyright line.
 *
 * ADDRESS RENDERS AS PLAIN TEXT, NOT A MAPS DEEP LINK — the "URL-encode into
 * a maps link" behavior belongs to the unrelated public-site profile display
 * (`PublishedSite.profile`, a presby-site-kit consumer). No such requirement
 * was named for this footer; inventing one would be scope creep (Phase 3
 * Component Plan, explicit).
 *
 * NO `*-brand[-*]` UTILITY CLASS HERE, deliberately — this file lives under
 * `src/components/`, which `check-brand-scope.mjs`'s C1 rule does not permit
 * (only `src/app/(org)/` and `src/app/(public)/` may use that class family).
 * Every color below resolves through a semantic token already legal
 * tree-wide (`border-border`, `text-muted-foreground`, `text-foreground`).
 *
 * GATE DISCIPLINE IS THE CALLER'S JOB, NOT THIS COMPONENT'S: `layout.tsx`
 * only renders `<PortalFooter>` inside its `resolved.kind === "ok"` branch,
 * behind `org_portal.chrome_v3` — this component itself performs no
 * membership or flag check, matching `PortalNav`'s own division of labor.
 *
 * `organizationType` (bug fix, docs/work-log/
 * 2026-08-27-credentials-tile-org-type.md): a REQUIRED prop, threaded from
 * `layout.tsx`'s `resolved.kind === "ok"` branch alongside `footerProfile`/
 * `footerOrgName` — the same resolve, no new query, and the reason the menu is
 * never read for a forbidden, ended, not-found or signed-out visitor
 * (DECISION-040).
 */
export async function PortalFooter({
  slug,
  organizationName,
  organizationType,
  viewer,
  profile,
}: {
  slug: string;
  organizationName: string;
  organizationType: OrganizationType;
  /** REQUIRED (member-calendar R1): the ids the per-org tile toggle read
   * needs, from the same `resolveOrgContext()` result as `organizationType`. */
  viewer: TileViewer;
  profile: OrgProfileForFooter | null;
}) {
  const menu = await getPortalMenu(slug, organizationType, viewer);
  const hasContactInfo = Boolean(profile?.address || profile?.phone);
  const home = menu.find((entry) => entry.key === "home");
  const columns = menu.filter(
    (entry) => entry.key !== "home" && entry.children.length > 0,
  );

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-8 text-sm text-muted-foreground">
        {hasContactInfo && (
          <div className="space-y-1">
            <p className="font-medium text-foreground">{organizationName}</p>
            {profile?.address && (
              <p className="text-base">{profile.address}</p>
            )}
            {profile?.phone && (
              <a
                href={`tel:${profile.phone}`}
                className="flex min-h-11 w-fit items-center text-base hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {profile.phone}
              </a>
            )}
          </div>
        )}
        <nav aria-label="Footer" className="space-y-4">
          {home && (
            <Link href={home.href} className={cn(LINK_CLASS, "w-fit")}>
              {home.label}
            </Link>
          )}
          {columns.length > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {columns.map((entry) => (
                <div key={entry.key} className="min-w-0">
                  <h2
                    id={`footer-menu-${entry.key}`}
                    className="break-words text-sm font-semibold text-foreground"
                  >
                    {entry.label}
                  </h2>
                  <ul aria-labelledby={`footer-menu-${entry.key}`}>
                    {entry.children.map((child) => (
                      <li key={child.key}>
                        <Link
                          href={child.href}
                          className={`${LINK_CLASS} flex-wrap gap-x-2 py-1 break-words`}
                        >
                          {child.label}
                          {child.comingSoon && (
                            <span className="text-sm">Coming soon</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </nav>
        <p>
          © {new Date().getFullYear()} {organizationName}. All rights
          reserved.
        </p>
      </div>
    </footer>
  );
}
