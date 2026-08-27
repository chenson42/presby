import Link from "next/link";
import { ChevronRight, LayoutGrid, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The shape every tile-registry entry must satisfy to render in this grid —
 * generalized off `src/lib/org-portal/tiles.ts`'s `PortalTile` (docs/work-
 * log/2026-08-27-platform-home-and-portal.md, Phase 3, DECISION-125).
 * `key`/`label`/`description`/`domain` are the only fields this component
 * itself reads; everything routing- or href-shaped (`slug` on the org axis,
 * a plain string on the platform axis) is resolved by the caller through
 * `getHref`, never read off the tile directly — that is what makes this one
 * component usable by both axes.
 */
export interface TileLike<TDomain extends string = string> {
  key: string;
  label: string;
  description: string;
  domain: TDomain;
}

/**
 * The gated tool-tile grid — BARE CARD GRID ONLY, no heading, no `<section>`
 * wrapper of its own (the caller, `DomainTileSections`, owns that chrome).
 * Moved from `src/components/org-portal/tile-grid.tsx` and generalized:
 * `slug` is gone from the signature entirely. Both the org-portal callers
 * (`(org)/o/[slug]/page.tsx`, `(org)/o/[slug]/admin/page.tsx`) and the new
 * admin-portal caller (`(admin)/admin/page.tsx`) resolve their own href
 * through the required `getHref` prop — a slug-closure on one axis, a plain
 * string passthrough on the other.
 *
 * `getIcon` is OPTIONAL and may return `undefined` for an unmapped tile key
 * — this component falls back to `LayoutGrid` in that case, same behavior
 * as the org-portal original's `TILE_ICONS[tile.key] ?? LayoutGrid`. Icon
 * lookup itself moved OUT of this component and into two small,
 * axis-owned maps (`src/components/org-portal/tile-icons.tsx`,
 * `src/app/(admin)/admin/tile-icons.ts`) — this component never imports an
 * icon map of its own.
 *
 * Renders `null` (not an empty div) when `tiles` is empty. 360px: single
 * column; `sm:` widens to two.
 *
 * ELEVATED CARD, ICON BADGE (DECISION-104, revised DECISION-105): each tile
 * is a `Button asChild variant="tile"` wrapping the real `<Link>` — a `GET`
 * navigation, not a client action — so the multi-line icon+heading+
 * description+chevron layout goes through the `Button` primitive and its
 * `tile` variant (Component Rule 5) instead of a hand-rolled `className`
 * string. This is also what fixes `/admin/page.tsx`'s previous latent
 * Component-Rule-5 violation (a hand-rolled `<Link className="rounded-lg…">`
 * card) — the admin axis now goes through the identical primitive the
 * org-portal axis already used.
 */
export function TileGrid<
  TDomain extends string,
  TTile extends TileLike<TDomain>,
>({
  tiles,
  getHref,
  getIcon,
}: {
  tiles: TTile[];
  getHref: (tile: TTile) => string;
  /** Undefined for an unmapped key → falls back to LayoutGrid, same as today. */
  getIcon?: (tile: TTile) => LucideIcon | undefined;
}) {
  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {tiles.map((tile) => {
        const Icon = getIcon?.(tile) ?? LayoutGrid;
        return (
          <Button
            key={tile.key}
            asChild
            variant="tile"
            size="lg"
            className="group h-auto w-full min-h-11 gap-3 p-5"
          >
            <Link href={getHref(tile)}>
              <span className="flex items-center justify-center rounded-xl bg-primary/10 p-2 text-primary">
                <Icon className="size-5 shrink-0" aria-hidden />
              </span>
              <h3 className="text-lg font-semibold text-card-foreground">
                {tile.label}
              </h3>
              <p className="text-base text-muted-foreground">
                {tile.description}
              </p>
              <ChevronRight
                className="mt-auto size-4 self-end text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
