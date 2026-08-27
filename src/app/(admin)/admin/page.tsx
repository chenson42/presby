import { auth } from "@/auth";
import { GreetingBand } from "@/components/shared/greeting-band";
import { DomainTileSections } from "@/components/shared/domain-tile-sections";
import {
  ADMIN_DOMAIN_LABELS,
  ADMIN_DOMAIN_ORDER,
} from "@/lib/admin-portal/tiles";
import { ADMIN_TILE_ICONS } from "./tile-icons";
import { visibleAdminTiles } from "./visible-tiles";

/**
 * `/admin` — the platform portal hub. Rewritten in full, commit 1 of
 * docs/work-log/2026-08-27-platform-home-and-portal.md (Phase 3,
 * DECISION-123/125).
 *
 * FIXES TWO PRESENT DEFECTS the design named: (1) every `ADMIN_DASHBOARD`
 * holder previously saw all ten hand-rolled cards regardless of which
 * `admin.*` features they actually held (a `support_operator` got denied on
 * eight of them at their own destination); (2) `FEATURES.ADMIN_TICKETS` has
 * gated `/admin/tickets` at the RSC layer since it shipped, but never had a
 * tile here — it does now.
 *
 * FILTERING HAPPENS ONCE, HERE, VIA `visibleAdminTiles()` — hide-if-not-held
 * (`hasFeature()`), per the architect's Phase 2 ruling and DECISION-123.
 * `src/lib/admin-portal/tiles.ts` itself stays pure synchronous data; this
 * page is the one place the session's `features` array and the registry
 * meet. Every `/admin/*` destination independently re-checks its own
 * `hasFeature()` regardless of what this hub renders (verified in Phase 1) —
 * hiding a tile here adds no authorization surface.
 *
 * FIXES THE LATENT COMPONENT-RULE-5 VIOLATION: the previous hand-rolled
 * `<Link className="rounded-lg border...">` card is gone — every tile now
 * routes through the same `Button variant="tile"` primitive
 * (`src/components/shared/tile-grid.tsx`) the org-portal axis already used,
 * via the generic, domain-sectioned `DomainTileSections`.
 *
 * `GreetingBand` (relocated shared component, DECISION-125) replaces the
 * previous bare `<h1>Welcome, {name}.</h1>` + roles paragraph.
 * `motionEnabled` is hardcoded `false` — there is no `org_portal.motion`
 * equivalent on this axis, and inventing one for a single mount fade-in
 * isn't justified by this pipeline.
 *
 * `demo.new_dashboard`'s example banner is RETIRED, not carried over — it
 * was a teaching example for `isFlagEnabled()` wired to a flag that never
 * gated a real "new dashboard," and the codebase has since accumulated real
 * examples (`org_portal.*`, this very pipeline's own `platform.merged_home`).
 * Its seed row is deleted in `scripts/seed.ts` in the same commit.
 *
 * EMPTY STATE (reachable — see `visible-tiles.test.ts`'s `ADMIN_DASHBOARD`-
 * only case and the work-log's Edge Cases): a hypothetical role holding only
 * the "door" feature and no other `admin.*` key is admitted by the Edge but
 * matches zero tiles. `DomainTileSections` already returns `null` on zero
 * tiles; this wraps that with a dashed-border empty-state card per
 * `docs/ui-standards.md`'s Empty States rule, rather than a blank grid.
 */
export default async function AdminDashboard() {
  const session = await auth();

  const tiles = visibleAdminTiles(session?.user?.features);

  return (
    <div className="space-y-8">
      <GreetingBand
        displayName={session?.user?.name ?? null}
        motionEnabled={false}
      />

      {tiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium">
            You don&apos;t have access to any admin tools yet.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Contact a platform administrator to request the features you
            need.
          </p>
        </div>
      ) : (
        <DomainTileSections
          tiles={tiles}
          getHref={(tile) => tile.href}
          getIcon={(tile) => ADMIN_TILE_ICONS[tile.key]}
          domainOrder={ADMIN_DOMAIN_ORDER}
          domainLabels={ADMIN_DOMAIN_LABELS}
        />
      )}
    </div>
  );
}
