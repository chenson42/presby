import { ADMIN_TILES, type AdminTile } from "@/lib/admin-portal/tiles";
import { hasFeature } from "@/lib/permissions";

/**
 * The one-time filter for `ADMIN_TILES`, colocated with its one consumer
 * (`page.tsx`) per `src/app/launch/destination.ts`'s own precedent for
 * where pure routing/visibility logic lives — not inside the registry
 * itself (architect Phase 2 ruling / DECISION-123: the registry stays pure
 * synchronous data with no `hasFeature`/session/query of its own).
 *
 * `hasFeature()` is a trivial array-includes check on data the session
 * already carries — no per-org DB read the way `visiblePortalTiles()`'s
 * flag lookups are, which is exactly why the platform axis can filter
 * hide-if-not-held while the org-portal axis stays flag-only.
 */
export function visibleAdminTiles(
  features: string[] | undefined,
): AdminTile[] {
  return ADMIN_TILES.filter((tile) => hasFeature(features, tile.requiredFeature));
}
