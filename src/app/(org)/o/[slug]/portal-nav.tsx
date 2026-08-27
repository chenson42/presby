import { isFlagEnabled } from "@/lib/flags";
import { visiblePortalTiles } from "@/lib/org-portal/tiles";
import type { OrganizationType } from "@/lib/authz";
import { PortalNavLinks, type PortalNavEntry } from "./portal-nav-links";

/**
 * The persistent portal-menu row — portal-chrome pipeline (docs/work-log/
 * 2026-08-25-portal-chrome.md, Phase 3). Server component: resolves
 * `visiblePortalTiles("operate")` (the day-to-day subset of the same
 * flag-only registry the home tile grid already uses) and hands the
 * resulting entries to a small `'use client'` leaf for `usePathname()`-driven
 * active-state styling.
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
 * "ADMINISTRATION" IS ALSO HARDCODED, NOT A `PORTAL_TILES` ROW — same pattern
 * as Home, just appended instead of prepended and conditioned on the
 * `org_portal.admin_hub` flag instead of always-on (portal-reorg pipeline,
 * docs/work-log/2026-08-26-portal-reorg-and-modernization.md, Phase 3). It
 * points at the new `/o/<slug>/admin` hub, which itself lists every
 * `"administer"`-category tile behind its own flag check. This is the same
 * nav mechanism, not a second one.
 *
 * FLAG-ONLY, LIKE ITS DATA SOURCE. This component adds no permission check
 * of its own — the destination page remains the sole authority
 * (tiles.ts's design comment, DECISION-003). A visible entry is a
 * convenience link, never a grant. The "Administration" entry follows the
 * same rule: it appears whenever the flag is on, regardless of the viewer's
 * own permissions — the hub and its destination pages are the sole
 * authority on what a click can actually do.
 *
 * Independent of `GlobalNav`'s org-list read — a degraded switcher does not
 * take this row down, and vice versa (Phase 3 Edge Cases).
 *
 * `organizationType` (bug fix, docs/work-log/
 * 2026-08-27-credentials-tile-org-type.md) is a REQUIRED prop, threaded from
 * `layout.tsx`'s `resolved.kind === "ok"` branch — the same resolve that
 * already produces `orgBrand`/`orgMark` for this render, so this adds no new
 * query. `visiblePortalTiles()`'s signature makes the argument impossible to
 * forget by accident; this component's own prop does the same one layer up.
 */
export async function PortalNav({
  slug,
  organizationType,
}: {
  slug: string;
  organizationType: OrganizationType;
}) {
  const [tiles, adminHubEnabled] = await Promise.all([
    visiblePortalTiles("operate", organizationType),
    isFlagEnabled("org_portal.admin_hub"),
  ]);

  const entries: PortalNavEntry[] = [
    { label: "Home", href: `/o/${slug}`, exact: true },
    ...tiles.map((tile) => ({
      label: tile.label,
      href: tile.href(slug),
      exact: false,
    })),
    ...(adminHubEnabled
      ? [{ label: "Administration", href: `/o/${slug}/admin`, exact: false }]
      : []),
  ];

  return <PortalNavLinks entries={entries} />;
}
