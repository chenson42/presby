import {
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  type PortalDomain,
  type PortalTile,
} from "@/lib/org-portal/tiles";
import { TileGrid } from "./tile-grid";

/**
 * Buckets a `PortalTile[]` into DOMAIN_ORDER-ordered, labeled `<section>`s —
 * commit 2 of docs/work-log/2026-08-27-product-ia-scaffold.md (Phase 3 §4,
 * DECISION-117). Reused by both `/o/<slug>` (operate tiles) and
 * `/o/<slug>/admin` (administer tiles) — the same component, just handed a
 * differently-filtered `tiles` array by each caller.
 *
 * ONE `<section id="domain-<key>">` + `<h2>` PER NON-EMPTY DOMAIN, in
 * `DOMAIN_ORDER` order — never one per domain in the closed union
 * regardless of content. A domain with zero matching tiles produces NO
 * section and NO heading at all, not an empty shell (Phase 3 Test
 * Expectations) — this is the same filter `portal-nav.tsx`'s anchor
 * computation independently applies to `DOMAIN_ORDER`, so the two are
 * always in sync: an anchor only ever exists for a section that's actually
 * on the page.
 *
 * The `id="domain-<key>"` convention is shared verbatim with
 * `portal-nav.tsx`'s anchor `href`s (`/o/<slug>#domain-<key>`) — both key
 * off the same `PortalDomain` string, so there is no second literal to keep
 * in sync (Phase 3 §4).
 *
 * CARD RENDERING IS DELEGATED TO THE EXISTING `TileGrid`, UNCHANGED IN
 * SHAPE — this component owns ONLY the domain bucketing and the section/
 * heading chrome. `TileGrid` itself no longer renders its own internal
 * heading (that wrapper moved here, the caller, per Phase 3's Component
 * Plan) — it is now a bare card grid.
 *
 * NO SCROLL-MARGIN-TOP COMPENSATION (Phase 3 Edge Cases, confirmed by
 * reading `layout.tsx`/`global-nav.tsx`/`portal-nav.tsx`): nothing in this
 * tree is `position: sticky` today, so an anchor jump lands exactly at the
 * section's own top with no header to duck under. If either nav is ever
 * made sticky, add `scroll-mt-<header-height>` to the `<section>` below AT
 * THAT TIME — not built speculatively against a header that doesn't exist.
 *
 * Returns `null` (not an empty wrapper) when `tiles` is empty, or when
 * every tile's domain happens to bucket into zero non-empty sections (the
 * same can't-actually-happen-today edge case `TileGrid` itself already
 * guards against, kept here too since this is the outermost caller-facing
 * guard for both `/o/<slug>` and the admin hub).
 */
export function DomainTileSections({
  slug,
  tiles,
}: {
  slug: string;
  tiles: PortalTile[];
}) {
  if (tiles.length === 0) return null;

  const buckets = DOMAIN_ORDER.map((domain) => ({
    domain,
    tiles: tiles.filter((tile) => tile.domain === domain),
  })).filter((bucket): bucket is { domain: PortalDomain; tiles: PortalTile[] } =>
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
            {DOMAIN_LABELS[domain]}
          </h2>
          <TileGrid slug={slug} tiles={domainTiles} />
        </section>
      ))}
    </div>
  );
}
