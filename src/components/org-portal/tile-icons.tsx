import {
  BarChart3,
  BookOpen,
  FileBarChart,
  Gavel,
  HandCoins,
  Landmark,
  Megaphone,
  Music,
  Palette,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { PortalDomain } from "@/lib/org-portal/tiles";

/**
 * The org-portal's tile-key → icon lookup — moved out of
 * `tile-grid.tsx` (which left `src/components/org-portal/` entirely for
 * `src/components/shared/`, docs/work-log/2026-08-27-platform-home-and-
 * portal.md, Phase 3, DECISION-125) into its own small, axis-owned map. The
 * generic `TileGrid`/`DomainTileSections` never import this — the org-portal
 * call sites (`(org)/o/[slug]/page.tsx`, `(org)/o/[slug]/admin/page.tsx`)
 * pass it in through the `getIcon` prop. `src/lib/org-portal/tiles.ts`
 * itself is NOT touched: `PortalTile` stays presentation-agnostic.
 *
 * An unmapped key (a future `PORTAL_TILES` addition this map hasn't caught
 * up to yet) resolves to `undefined` here, which `TileGrid` falls back to
 * `LayoutGrid` for, rather than crashing the render.
 */
export const TILE_ICONS: Record<string, LucideIcon> = {
  members: UserPlus,
  directory: BookOpen,
  roles: Settings,
  officers: Landmark,
  tickets: Ticket,
  features: SlidersHorizontal,
  groups: UsersRound,
  branding: Palette,
  giving: HandCoins,
  worship: Music,
  committees: Gavel,
  oversight: ShieldCheck,
  reports: FileBarChart,
  insights: BarChart3,
  communications: Megaphone,
};

/**
 * The persistent portal nav's (`portal-nav.tsx`) domain → icon lookup —
 * docs/work-log/2026-08-28-directory-visual-refresh.md, Phase 4, item 3.
 *
 * DELIBERATELY REUSES `TILE_ICONS` VALUES rather than picking a second,
 * independent icon per domain — the operator's own ask was "check whether
 * `PortalTile.domain`'s categories line up with this nav's own categories,
 * and reuse the SAME icon choices" so the nav row and the tile grid read as
 * one consistent icon vocabulary rather than two that happen to share
 * labels. Each entry below is the icon of that domain's most representative
 * (most universal / first-listed / flagship) tile in `PORTAL_TILES`:
 *   - people          -> `groups`' UsersRound (a plain multi-person glyph;
 *                        `members`' UserPlus reads as "add," not "people")
 *   - worship         -> `worship`'s own Music
 *   - giving          -> `giving`'s own HandCoins
 *   - governance      -> `officers`' Landmark (the universal, congregation-
 *                        visible governance tile; `committees`/`oversight`
 *                        are presbytery-only)
 *   - reports         -> `reports`'s own FileBarChart (over `insights`'
 *                        BarChart3 — "Reports & Insights" names Reports
 *                        first)
 *   - communications  -> `communications`'s own Megaphone
 *   - administration  -> `roles`' Settings (the nav's own hardcoded
 *                        "Administration" entry has no single tile of its
 *                        own to borrow from; Settings is the generic
 *                        "administer this" glyph already in use for one of
 *                        that hub's own tiles)
 *
 * `PortalDomain` has no `"home"` member (Home is a hardcoded nav entry, not
 * a `PORTAL_TILES` domain — see `portal-nav.tsx`'s own header) so Home's
 * icon is chosen directly in `portal-nav.tsx`, not here.
 */
export const NAV_DOMAIN_ICONS: Record<PortalDomain, LucideIcon> = {
  people: UsersRound,
  worship: Music,
  giving: HandCoins,
  governance: Landmark,
  reports: FileBarChart,
  communications: Megaphone,
  administration: Settings,
};
