import { isFlagEnabled } from "@/lib/flags";
import { DOMAIN_LABELS, DOMAIN_ORDER, visiblePortalTiles } from "@/lib/org-portal/tiles";
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
 * DOMAIN-ANCHOR ENTRIES REPLACE THE OLD ONE-ENTRY-PER-TILE ROW (commit 2 of
 * docs/work-log/2026-08-27-product-ia-scaffold.md, Phase 3 §4, DECISION-117
 * — the architect's Phase 2 nav-scaling ruling). Instead of one nav entry
 * per visible `"operate"` tile (unbounded as the tile universe grows), this
 * computes ONE entry per `PortalDomain` that has at least one flag-visible
 * `"operate"` tile for this org's type — a domain-anchor entry pointing at
 * `/o/<slug>#domain-<key>`, landing on the matching `<section
 * id="domain-<key>">` `DomainTileSections` renders on the home page. Nav
 * entry count is now permanently capped at Home + up to 6 domain anchors +
 * Administration, regardless of how many tiles any one domain accumulates
 * in the future — the entire point of the architect's ruling, operator
 * -accepted (shipped high-frequency tools moving from one click to two is a
 * named, accepted tradeoff, not an oversight).
 *
 * THE `"administration"` DOMAIN IS EXCLUDED FROM THIS COMPUTATION, ALWAYS —
 * see `tiles.ts`'s own `PortalDomain` comment for the full collision
 * rationale. The nav's existing hardcoded "Administration" entry (below,
 * unchanged) already owns that label and that destination
 * (`/o/<slug>/admin`); a second, anchor-based "Administration" entry
 * pointing at `/o/<slug>#domain-administration` would collide on the
 * identical label with a different destination. No tile today actually
 * forces this collision (every `"administration"`-domain tile is
 * `category: "administer"`, so it never reaches `visiblePortalTiles
 * ("operate", ...)` in the first place) — the exclusion is a standing rule
 * for whoever adds the next tile, not an accident of today's data.
 *
 * EVERY DOMAIN-ANCHOR ENTRY IS `exact: true` — see `portal-nav-links.tsx`'s
 * own `matchesEntry` comment for why: `usePathname()` never carries a
 * `#fragment`, so an anchor entry's stripped target is always
 * `/o/<slug>` itself, identical to Home's own target. Marking every anchor
 * `exact` (not `false`) prevents that stripped target from being treated as
 * a path PREFIX, which would otherwise make the entry read as "active" on
 * every single subpage in the org.
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

  const domainsPresent = DOMAIN_ORDER.filter(
    (domain) =>
      domain !== "administration" &&
      tiles.some((tile) => tile.domain === domain),
  );

  const entries: PortalNavEntry[] = [
    { label: "Home", href: `/o/${slug}`, exact: true },
    ...domainsPresent.map((domain) => ({
      label: DOMAIN_LABELS[domain],
      href: `/o/${slug}#domain-${domain}`,
      exact: true,
    })),
    ...(adminHubEnabled
      ? [{ label: "Administration", href: `/o/${slug}/admin`, exact: false }]
      : []),
  ];

  return <PortalNavLinks entries={entries} />;
}
