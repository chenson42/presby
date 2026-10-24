import {
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  type PortalDomain,
  type PortalTile,
} from "@/lib/org-portal/tiles";

/**
 * The portal's menu as ONE pure structure — portal-sitemap-footer pipeline
 * (docs/work-log/2026-10-23-portal-sitemap-footer.md, DECISION-220). The nav
 * row and the site-map footer both render this, so a title can never differ
 * between them: each reads the same entries by construction.
 *
 * PURE: no `server-only`, no React, no database, no flag read. The reads live
 * in `getPortalMenu()` (`visible-tiles.ts`), which resolves the tiles and
 * calls `buildPortalMenu()`. IMPORT DIRECTION IS ONE WAY: this file imports
 * `tiles.ts`; `tiles.ts` must NEVER import this file (F135 — the cycle
 * tiles -> org-features -> org-feature-categories -> tiles). This file also
 * imports nothing from `org-features`, `visible-tiles` or any client file.
 *
 * OUTPUT IS PLAIN SERIALIZABLE DATA — strings and booleans only. Every `href`
 * is already a string (never an `href(slug)` function) and `icon` is a key
 * (never a component), because the nav hands entries to a `'use client'` leaf
 * and a non-plain object crossing that boundary has caused a live 500
 * (`portal-nav-links.tsx`, `PortalNavEntry.icon`).
 *
 * THREE KINDS OF ENTRY, in this order:
 *   1. Home — always, first, no children.
 *   2. One entry per `PortalDomain` (in `DOMAIN_ORDER`) with at least one
 *      visible operate tile; its children are those tiles. The
 *      `"administration"` domain NEVER becomes a domain entry, and an operate
 *      tile carrying `domain: "administration"` is dropped (a standing rule,
 *      stated once, here).
 *   3. Administration — last, present if and only if `adminHubEnabled` AND at
 *      least one administer tile is visible. Its only child is the
 *      "Administration overview" link (operator ruling Q1). `administerTiles`
 *      is used for `.length` alone and is never copied into `children`, so
 *      "the footer lists no administer tile" is a property of the data.
 *
 * NO TWO TOP-LEVEL ENTRIES SHARE A LABEL. One accepted residual (operator
 * ruling Q2): on the home page the "Community" menu pill (to the section) and
 * the "Community" tile card (to `/admin/community`) read the same and go to
 * different places.
 *
 * NO PERMISSION CHECK, EVER (DECISION-003/162): the menu is flag-, toggle- and
 * org-type-gated through the tiles it is handed; each destination stays the
 * sole authority on what a click can do.
 */

export const HOME_LABEL = "Home";
export const ADMIN_OVERVIEW_LABEL = "Administration overview";

export interface PortalMenuChild {
  key: string;
  label: string;
  href: string;
  comingSoon: boolean;
}

export interface PortalMenuEntry {
  key: "home" | PortalDomain;
  label: string;
  href: string;
  exact: boolean;
  /** Always equal to `key`; kept as its own field so the nav's mapping to
   * `PortalNavEntry` is one line. A string key, never a component. */
  icon: "home" | PortalDomain;
  children: PortalMenuChild[];
}

export type PortalMenu = readonly PortalMenuEntry[];

export function buildPortalMenu(input: {
  slug: string;
  /** Already filtered by `visiblePortalTiles("operate", …)`. */
  operateTiles: readonly PortalTile[];
  /** Already filtered by `visiblePortalTiles("administer", …)`; `[]` when
   * the loader skipped the read because the hub flag is off. */
  administerTiles: readonly PortalTile[];
  adminHubEnabled: boolean;
}): PortalMenu {
  const { slug, operateTiles, administerTiles, adminHubEnabled } = input;

  const entries: PortalMenuEntry[] = [
    {
      key: "home",
      label: HOME_LABEL,
      href: `/o/${slug}`,
      exact: true,
      icon: "home",
      children: [],
    },
  ];

  for (const domain of DOMAIN_ORDER) {
    if (domain === "administration") continue;
    const tiles = operateTiles.filter((tile) => tile.domain === domain);
    if (tiles.length === 0) continue;
    entries.push({
      key: domain,
      label: DOMAIN_LABELS[domain],
      href: `/o/${slug}#domain-${domain}`,
      // Every anchor entry is `exact` — see `portal-nav-links.tsx`'s
      // `matchesEntry`: `usePathname()` never carries a fragment, so a
      // non-exact anchor would read as active on every subpage.
      exact: true,
      icon: domain,
      children: tiles.map((tile) => ({
        key: tile.key,
        label: tile.label,
        href: tile.href(slug),
        comingSoon: tile.comingSoon === true,
      })),
    });
  }

  if (adminHubEnabled && administerTiles.length > 0) {
    entries.push({
      key: "administration",
      label: DOMAIN_LABELS.administration,
      href: `/o/${slug}/admin`,
      exact: false,
      icon: "administration",
      children: [
        {
          key: "administration-overview",
          label: ADMIN_OVERVIEW_LABEL,
          href: `/o/${slug}/admin`,
          comingSoon: false,
        },
      ],
    });
  }

  return entries;
}
