import {
  ADMIN_NAV_GROUPS,
  type AdminNavGroup,
} from "@/lib/admin-portal/nav";
import { hasFeature } from "@/lib/permissions";

/**
 * The one place the session's `features` and the nav registry meet
 * (DECISION-123's rule, carried over from the tile registry): hide what is not
 * held. `hasFeature()` is an array-includes on a session claim, so this is
 * synchronous and costs no read.
 *
 * A group with no visible item is omitted. An item with
 * `requiredFeature: null` is door-level and is always kept (the proxy has
 * already admitted the viewer on `FEATURES.ADMIN_DASHBOARD`).
 *
 * Hiding adds no authorization surface: every destination re-checks its own key.
 */
export function visibleAdminNav(
  features: string[] | undefined,
): AdminNavGroup[] {
  return ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        item.requiredFeature === null ||
        hasFeature(features, item.requiredFeature),
    ),
  })).filter((group) => group.items.length > 0);
}
