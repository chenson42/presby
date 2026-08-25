import Link from "next/link";
import type { PortalTile } from "@/lib/org-portal/tiles";

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
        {tiles.map((tile) => (
          <Link
            key={tile.key}
            href={tile.href(slug)}
            className="block min-h-11 rounded-lg border border-border p-4 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <h3 className="text-lg font-medium">{tile.label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {tile.description}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
