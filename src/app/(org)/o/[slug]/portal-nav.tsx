import { getPortalMenu, type TileViewer } from "@/lib/org-portal/visible-tiles";
import type { OrganizationType } from "@/lib/authz";
import { PortalNavLinks, type PortalNavEntry } from "./portal-nav-links";

/**
 * The persistent portal-menu row — portal-chrome pipeline (docs/work-log/
 * 2026-08-25-portal-chrome.md), rebuilt by the portal-sitemap-footer pipeline
 * (docs/work-log/2026-10-23-portal-sitemap-footer.md, DECISION-220).
 *
 * Server component. It owns no menu logic of its own: `getPortalMenu()`
 * resolves the visible tiles and `buildPortalMenu()` (`portal-menu.ts`) turns
 * them into one pure structure — Home, one entry per domain with at least one
 * visible operate tile, and Administration. The site-map footer renders that
 * same structure, so a title can never differ between the two. This file only
 * maps each entry to the four-field `PortalNavEntry` a small `'use client'`
 * leaf (`PortalNavLinks`) needs for `usePathname()`-driven active styling.
 * Nothing about Home, the domain anchors or the Administration rule lives
 * here any more; read `portal-menu.ts`'s header for them.
 *
 * ICON KEYS, NOT ICON COMPONENTS — see `PortalNavEntry.icon`'s doc comment in
 * `portal-nav-links.tsx`: this Server Component hands props to a `"use
 * client"` leaf, and an actual `LucideIcon` object crossing that boundary is a
 * confirmed live 500. The menu's `icon` field is already that string key.
 * `children` and `key` are deliberately NOT passed on: the nav row shows
 * top-level entries only.
 *
 * FLAG-ONLY, LIKE ITS DATA SOURCE. No permission check here (DECISION-003):
 * the destination page remains the sole authority. A visible entry is a
 * convenience link, never a grant.
 *
 * Independent of `GlobalNav`'s org-list read — a degraded switcher does not
 * take this row down, and vice versa. This component and `PortalFooter` each
 * call `getPortalMenu()` themselves; the reads underneath are `cache()`d on
 * primitive arguments, so the second caller costs nothing.
 *
 * `organizationType` and `viewer` are REQUIRED props, threaded from
 * `layout.tsx`'s `resolved.kind === "ok"` branch (the same resolve that
 * produces `orgBrand`/`orgMark`), so this adds no new query and the menu is
 * never read for a forbidden, ended, not-found or signed-out visitor
 * (DECISION-040).
 */
export async function PortalNav({
  slug,
  organizationType,
  viewer,
}: {
  slug: string;
  organizationType: OrganizationType;
  /** REQUIRED (member-calendar R1): the ids the per-org tile toggle read
   * needs, from the same `resolveOrgContext()` result as `organizationType`. */
  viewer: TileViewer;
}) {
  const menu = await getPortalMenu(slug, organizationType, viewer);

  const entries: PortalNavEntry[] = menu.map(
    ({ label, href, exact, icon }) => ({ label, href, exact, icon }),
  );

  return <PortalNavLinks entries={entries} />;
}
