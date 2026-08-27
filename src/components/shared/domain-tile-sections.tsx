import type { LucideIcon } from "lucide-react";
import { TileGrid, type TileLike } from "./tile-grid";

/**
 * Buckets a `TTile[]` into `domainOrder`-ordered, labeled `<section>`s —
 * moved from `src/components/org-portal/domain-tile-sections.tsx` and
 * generalized (docs/work-log/2026-08-27-platform-home-and-portal.md, Phase
 * 3, DECISION-125). Reused by three callers: `/o/<slug>` (operate tiles),
 * `/o/<slug>/admin` (administer tiles), and the new `/admin` (platform
 * tiles) — each hands this component its own tiles, its own `getHref`
 * closure, and its own `domainOrder`/`domainLabels` pair. Neither this file
 * nor `tile-grid.tsx` imports `@/lib/org-portal/tiles` any more — that is
 * the whole point of the genericization; each axis keeps its own registry
 * and its own domain taxonomy.
 *
 * ONE `<section id="domain-<key>">` + `<h2>` PER NON-EMPTY DOMAIN, in
 * `domainOrder` order — never one per domain in the caller's closed union
 * regardless of content. A domain with zero matching tiles produces NO
 * section and NO heading at all, not an empty shell.
 *
 * The `id="domain-<key>"` convention is shared verbatim with the org
 * portal's `portal-nav.tsx` anchor `href`s (`/o/<slug>#domain-<key>`) — both
 * key off the same domain string, so there is no second literal to keep in
 * sync. The platform axis does not currently have an equivalent nav-anchor
 * consumer, but the convention costs nothing to keep uniform.
 *
 * CARD RENDERING IS DELEGATED TO THE GENERIC `TileGrid`, UNCHANGED IN SHAPE
 * — this component owns ONLY the domain bucketing and the section/heading
 * chrome.
 *
 * Returns `null` (not an empty wrapper) when `tiles` is empty, or when every
 * tile's domain happens to bucket into zero non-empty sections.
 */
export function DomainTileSections<
  TDomain extends string,
  TTile extends TileLike<TDomain>,
>({
  tiles,
  getHref,
  getIcon,
  domainOrder,
  domainLabels,
}: {
  tiles: TTile[];
  getHref: (tile: TTile) => string;
  getIcon?: (tile: TTile) => LucideIcon | undefined;
  /** The domain/labels/order triple the architect's ruling names. */
  domainOrder: readonly TDomain[];
  domainLabels: Record<TDomain, string>;
}) {
  if (tiles.length === 0) return null;

  const buckets = domainOrder
    .map((domain) => ({
      domain,
      tiles: tiles.filter((tile) => tile.domain === domain),
    }))
    .filter(
      (bucket): bucket is { domain: TDomain; tiles: TTile[] } =>
        bucket.tiles.length > 0,
    );

  if (buckets.length === 0) return null;

  return (
    <div className="space-y-8">
      {buckets.map(({ domain, tiles: domainTiles }) => (
        <section
          key={domain}
          id={`domain-${domain}`}
          aria-labelledby={`domain-${domain}-heading`}
          className="space-y-3"
        >
          <h2 id={`domain-${domain}-heading`} className="text-xl font-semibold">
            {domainLabels[domain]}
          </h2>
          <TileGrid tiles={domainTiles} getHref={getHref} getIcon={getIcon} />
        </section>
      ))}
    </div>
  );
}
