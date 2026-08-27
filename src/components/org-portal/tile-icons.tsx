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
