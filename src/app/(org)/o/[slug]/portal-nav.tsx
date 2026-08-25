import { visiblePortalTiles } from "@/lib/org-portal/tiles";
import { PortalNavLinks, type PortalNavEntry } from "./portal-nav-links";

/**
 * The persistent portal-menu row — portal-chrome pipeline (docs/work-log/
 * 2026-08-25-portal-chrome.md, Phase 3). Server component: resolves
 * `visiblePortalTiles()` (the exact flag-only registry the home tile grid
 * already uses) and hands the resulting entries to a small `'use client'`
 * leaf for `usePathname()`-driven active-state styling.
 *
 * HOME IS HARDCODED, NOT A `PORTAL_TILES` ROW. `/o/<slug>` always resolves
 * to something — the P0 stub or the rebuilt home, depending on
 * `org_portal.home_v2` — regardless of any OTHER flag, so gating the "Home"
 * link on one would be wrong (Phase 3 Component/Page Plan). It is prepended
 * unconditionally, which is also why the nav row is never fully hidden even
 * when every `PORTAL_TILES` flag is off — this pipeline's own flag
 * (`org_portal.chrome_v2`) is the only thing gating the row's existence at
 * all, decided by the caller (`layout.tsx`), not here.
 *
 * FLAG-ONLY, LIKE ITS DATA SOURCE. This component adds no permission check
 * of its own — the destination page remains the sole authority
 * (tiles.ts's design comment, DECISION-003). A visible entry is a
 * convenience link, never a grant.
 *
 * Independent of `GlobalNav`'s org-list read — a degraded switcher does not
 * take this row down, and vice versa (Phase 3 Edge Cases).
 */
export async function PortalNav({ slug }: { slug: string }) {
  const tiles = await visiblePortalTiles();

  const entries: PortalNavEntry[] = [
    { label: "Home", href: `/o/${slug}`, exact: true },
    ...tiles.map((tile) => ({
      label: tile.label,
      href: tile.href(slug),
      exact: false,
    })),
  ];

  return <PortalNavLinks entries={entries} />;
}
