import Link from "next/link";
import {
  BookOpen,
  LayoutGrid,
  Landmark,
  MessageSquare,
  Settings,
  Ticket,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { PortalTile } from "@/lib/org-portal/tiles";

/**
 * Render-layer-only icon lookup, keyed on `tile.key` — docs/work-log/
 * 2026-08-26-portal-fpcw-directory-ux.md Phase 3, Increment 1.
 * `src/lib/org-portal/tiles.ts` itself is NOT touched: `PortalTile` stays
 * presentation-agnostic (Phase 2 architect ruling — "no new component").
 * An unmapped key (a future `PORTAL_TILES` addition this map hasn't caught
 * up to yet) falls back to `LayoutGrid` rather than crashing the render —
 * named explicitly in Phase 3 Edge Cases as worth its own regression test.
 */
const TILE_ICONS: Record<string, LucideIcon> = {
  members: UserPlus,
  directory: BookOpen,
  roles: Settings,
  officers: Landmark,
  tickets: Ticket,
  feedback: MessageSquare,
};

/**
 * The gated tool-tile grid. Renders nothing (not an empty section) when
 * every flag behind `tiles` is off, per Phase 3's edge case: "all tile
 * flags off → home renders greeting + search only." 360px: single column,
 * per Phase 3's mobile note; `sm:` widens to two.
 */
export function TileGrid({
  slug,
  tiles,
}: {
  slug: string;
  tiles: PortalTile[];
}) {
  if (tiles.length === 0) return null;

  return (
    <section aria-labelledby="tile-grid-heading" className="space-y-3">
      <h2 id="tile-grid-heading" className="text-xl font-semibold">
        Tools
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((tile) => {
          const Icon = TILE_ICONS[tile.key] ?? LayoutGrid;
          return (
            <Link
              key={tile.key}
              href={tile.href(slug)}
              className="block min-h-11 rounded-lg border border-border p-4 transition-shadow hover:bg-accent hover:text-accent-foreground hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <h3 className="flex items-center gap-2 text-lg font-medium">
                <Icon className="size-4 shrink-0" aria-hidden />
                {tile.label}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {tile.description}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
