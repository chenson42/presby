import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  LayoutGrid,
  Landmark,
  MessageSquare,
  Palette,
  Settings,
  SlidersHorizontal,
  Ticket,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PortalTile } from "@/lib/org-portal/tiles";

/**
 * Render-layer-only icon lookup, keyed on `tile.key` — docs/work-log/
 * 2026-08-26-portal-fpcw-directory-ux.md Phase 3, Increment 1.
 * `src/lib/org-portal/tiles.ts` itself is NOT touched: `PortalTile` stays
 * presentation-agnostic (Phase 2 architect ruling — "no new component").
 * An unmapped key (a future `PORTAL_TILES` addition this map hasn't caught
 * up to yet) falls back to `LayoutGrid` rather than crashing the render —
 * named explicitly in Phase 3 Edge Cases as worth its own regression test.
 *
 * `groups` and `branding` (docs/work-log/2026-08-26-portal-ux-fixes.md,
 * Wave 1B, finding M6) previously had no entry here and both silently fell
 * back to the same `LayoutGrid` glyph — indistinguishable in the grid.
 * `UsersRound` and `Palette` are distinct, semantically-fitting glyphs
 * already available from `lucide-react`; no new dependency.
 */
const TILE_ICONS: Record<string, LucideIcon> = {
  members: UserPlus,
  directory: BookOpen,
  roles: Settings,
  officers: Landmark,
  tickets: Ticket,
  feedback: MessageSquare,
  features: SlidersHorizontal,
  groups: UsersRound,
  branding: Palette,
};

/**
 * The gated tool-tile grid. Renders nothing (not an empty section) when
 * every flag behind `tiles` is off, per Phase 3's edge case: "all tile
 * flags off → home renders greeting + search only." 360px: single column,
 * per Phase 3's mobile note; `sm:` widens to two.
 *
 * ELEVATED CARD, ICON BADGE (docs/work-log/2026-08-26-portal-visual-
 * modernization.md Phase 3 / DECISION-104, revised same day on direct
 * operator feedback that the original full-bleed solid fill looked flat):
 * each tile is a `Button asChild variant="tile"` wrapping the real `<Link>`
 * — a `GET` navigation, not a client action — so the multi-line
 * icon+heading+description+chevron layout goes through the `Button`
 * primitive and its `tile` variant (Component Rule 5/C2) instead of a
 * hand-rolled `className` string. The icon sits in a small rounded
 * `bg-primary/10 text-primary` badge — that's where the brand color now
 * lives, not the whole card — and the description uses the `body`/
 * `text-base` `TYPE_SCALE` role in `text-muted-foreground`. The trailing
 * chevron mirrors presby-site-kit's arrow-at-the-bottom convention
 * (`styles.css:617-624`) with a real `lucide-react` icon, nudging toward the
 * edge on hover (`group-hover:translate-x-0.5`) as the one piece of motion
 * riding the card's own hover state — unconditional, like the shadow/lift it
 * accompanies, per Phase 3's ruling that only the greeting band's mount
 * fade-in is gated behind `org_portal.motion`.
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
            <Button
              key={tile.key}
              asChild
              variant="tile"
              size="lg"
              className="group h-auto w-full min-h-11 gap-3 p-5"
            >
              <Link href={tile.href(slug)}>
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
    </section>
  );
}
