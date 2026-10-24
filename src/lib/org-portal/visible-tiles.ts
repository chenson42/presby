import "server-only";
import { cache } from "react";
import type { OrganizationType } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { ORG_FEATURE_CATALOG, isOrgFeatureEnabled } from "@/lib/org-features";
import { buildPortalMenu, type PortalMenu } from "@/lib/org-portal/portal-menu";
import {
  PORTAL_TILES,
  type PortalTile,
  type PortalTileCategory,
} from "@/lib/org-portal/tiles";

/**
 * The tiles a viewer sees for one category at one organization — the
 * evaluation half of the tile registry, split out of `tiles.ts` (R1, F135) so
 * that file stays data + types. `tiles.ts` is imported by
 * `org-feature-categories.ts`, which `org-features.ts` imports; this module
 * imports `org-features.ts`, so it must sit on the far side of that chain, not
 * inside it.
 *
 * Filter order, cheapest and most central first, and a tile excluded by an
 * earlier step never triggers a later read:
 *
 *   category -> `orgTypeScope` -> `tile.flagKey` (if it declares one)
 *   -> the catalog entry's own `flag` (if non-null)
 *   -> the per-org toggle (`isOrgFeatureEnabled`, if it declares an
 *      `orgFeatureKey`)
 *
 * Order of the result follows `PORTAL_TILES`'s declaration order, which the
 * grid renders as-is. NEVER a permission check (DECISION-003): the viewer's
 * ids exist only so the org-toggle read can set the RLS org GUC after a
 * membership check (`withOrgContext`); no `*.view`/`*.manage` is consulted
 * here, the destination route stays the sole authority.
 *
 * `viewer` is REQUIRED, like `organizationType`: a caller that forgets it
 * fails at `tsc`, not by silently skipping every toggle-gated tile.
 *
 * A FAILED TOGGLE READ HIDES THAT TILE AND NEVER THROWS (F135). This function
 * runs in the layout's nav and footer, so a throw would take the whole portal
 * chrome down for a tile. Any error — a database blip, an `OrgAccessError`
 * from a membership that ended mid-request — hides the tile and logs the two
 * ids only: never the error message (a driver message can embed a SQL
 * fragment) and never the stack. Same posture as a failed flag read today,
 * which is also "off".
 *
 * Deduplication: nav, footer and the page each call this once per request, but
 * the only expensive step is the toggle read, and `isOrgFeatureEnabled` is
 * already `cache()`-keyed on its primitive arguments, so the second and third
 * callers cost nothing. The per-key resolver below is `cache()`d on primitives
 * too, for the same reason (an object-valued `viewer` would defeat `cache()`'s
 * reference equality).
 */
export interface TileViewer {
  personId: string;
  organizationId: string;
}

const catalogFlagFor = (key: string): string | null =>
  ORG_FEATURE_CATALOG.find((entry) => entry.key === key)?.flag ?? null;

/** Flag(s) first, then the org toggle, for ONE tile. Primitive arguments so
 * `cache()` dedupes across the three callers in a request. Never throws. */
const tileGateOpen = cache(
  async (
    flagKey: string,
    orgFeatureKey: string,
    personId: string,
    organizationId: string,
  ): Promise<boolean> => {
    try {
      if (flagKey !== "" && !(await isFlagEnabled(flagKey))) return false;
      if (orgFeatureKey === "") return true;
      const catalogFlag = catalogFlagFor(orgFeatureKey);
      if (catalogFlag !== null && !(await isFlagEnabled(catalogFlag))) {
        return false;
      }
      return await isOrgFeatureEnabled(personId, organizationId, orgFeatureKey);
    } catch {
      // Ids only — never the message or stack (see the header).
      console.error(
        `[portal-tiles] gate read failed; tile hidden (organization ${organizationId}, person ${personId})`,
      );
      return false;
    }
  },
);

export async function visiblePortalTiles(
  category: PortalTileCategory,
  organizationType: OrganizationType,
  viewer: TileViewer,
): Promise<PortalTile[]> {
  const candidates = PORTAL_TILES.filter(
    (tile) =>
      tile.category === category &&
      (!tile.orgTypeScope || tile.orgTypeScope.includes(organizationType)),
  );
  const checks = await Promise.all(
    candidates.map(async (tile) => ({
      tile,
      enabled: await tileGateOpen(
        tile.flagKey ?? "",
        tile.orgFeatureKey ?? "",
        viewer.personId,
        viewer.organizationId,
      ),
    })),
  );
  return checks.filter((c) => c.enabled).map((c) => c.tile);
}

/**
 * The loader half of the portal menu (DECISION-220/222): reads what
 * `buildPortalMenu()` needs and hands it over. The nav and the footer each
 * call this independently, so neither takes the other down and neither repeats
 * the Administration rule — that rule lives in `buildPortalMenu()` alone.
 *
 * The administer tiles are read ONLY when `org_portal.admin_hub` is on: the
 * menu would not show Administration without the hub, so the read (about six
 * uncached flag reads plus one per-org toggle read) is skipped entirely
 * otherwise. No new `cache()` here — every read underneath is already cached
 * on primitive arguments, so the nav, the footer and the page share them. If
 * one is ever added it must take primitives (an object argument defeats
 * `cache()`).
 *
 * NEVER THROWS: `isFlagEnabled` returns false on error and
 * `visiblePortalTiles` swallows a failed gate read, so a failed read hides a
 * tile or the Administration entry and never takes the chrome down. NEVER a
 * permission check (DECISION-003/162).
 */
export async function getPortalMenu(
  slug: string,
  organizationType: OrganizationType,
  viewer: TileViewer,
): Promise<PortalMenu> {
  const [operateTiles, adminHubEnabled] = await Promise.all([
    visiblePortalTiles("operate", organizationType, viewer),
    isFlagEnabled("org_portal.admin_hub"),
  ]);
  const administerTiles = adminHubEnabled
    ? await visiblePortalTiles("administer", organizationType, viewer)
    : [];
  return buildPortalMenu({
    slug,
    operateTiles,
    administerTiles,
    adminHubEnabled,
  });
}
