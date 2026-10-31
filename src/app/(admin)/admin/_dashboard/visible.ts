import { hasFeature } from "@/lib/permissions";
import {
  DASHBOARD_CARDS,
  DASHBOARD_ZONES,
  type DashboardCardDef,
  type DashboardZoneDef,
} from "./registry";

/**
 * The one place the session's `features` and the card registry meet. A zone
 * with no visible card is omitted, so a support operator sees only "Support".
 * Synchronous: `hasFeature()` is an array-includes on a session claim.
 */
export function visibleDashboardZones(
  features: string[] | undefined,
): Array<{ zone: DashboardZoneDef; cards: DashboardCardDef[] }> {
  return DASHBOARD_ZONES.map((zone) => ({
    zone,
    cards: DASHBOARD_CARDS.filter(
      (c) => c.zone === zone.key && hasFeature(features, c.requiredFeature),
    ),
  })).filter((z) => z.cards.length > 0);
}
