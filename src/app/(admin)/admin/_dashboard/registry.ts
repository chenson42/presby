import { FEATURES, type FeatureKey } from "@/lib/permissions";

/**
 * The dashboard's card registry: PURE DATA. No session, no `hasFeature`, no
 * query, no component (the page maps an id to a component in `cards.tsx`, so
 * a page test can swap that one module for stubs).
 *
 * Order here is the order on screen and is never data-dependent, so every card
 * streams independently. A card is mounted ONLY for a viewer who holds its
 * `requiredFeature`, which is the key of the destination it links to, so no
 * card shows a number the viewer cannot open (E4). Hiding is not
 * authorization: the destination re-checks.
 *
 * The zone names are the nav group names (Organizations, Support, Access and
 * settings) so the operator learns one structure.
 */
export type DashboardCardId =
  | "organizations"
  | "giving"
  | "domains"
  | "sites"
  | "tickets"
  | "feedback"
  | "contact_messages"
  | "email"
  | "two_factor"
  | "accounts"
  | "recent_changes";

export type DashboardZoneKey = "organizations" | "support" | "access" | "recent";

export interface DashboardCardDef {
  id: DashboardCardId;
  zone: DashboardZoneKey;
  title: string;
  requiredFeature: FeatureKey;
}

export interface DashboardZoneDef {
  key: DashboardZoneKey;
  heading: string;
}

export const DASHBOARD_ZONES: readonly DashboardZoneDef[] = [
  { key: "organizations", heading: "Organizations" },
  { key: "support", heading: "Support" },
  { key: "access", heading: "Access and settings" },
  { key: "recent", heading: "Recent operator changes" },
];

export const DASHBOARD_CARDS: readonly DashboardCardDef[] = [
  { id: "organizations", zone: "organizations", title: "Organizations at a glance", requiredFeature: FEATURES.ADMIN_ORGANIZATIONS },
  { id: "giving", zone: "organizations", title: "Giving notices", requiredFeature: FEATURES.ADMIN_ORGANIZATIONS },
  { id: "domains", zone: "organizations", title: "Domains", requiredFeature: FEATURES.ADMIN_ORGANIZATIONS },
  { id: "sites", zone: "organizations", title: "Sites", requiredFeature: FEATURES.ADMIN_ORGANIZATIONS },
  { id: "tickets", zone: "support", title: "Tickets", requiredFeature: FEATURES.ADMIN_TICKETS },
  { id: "feedback", zone: "support", title: "Feedback", requiredFeature: FEATURES.ADMIN_FEEDBACK },
  { id: "contact_messages", zone: "support", title: "Contact messages", requiredFeature: FEATURES.ADMIN_TICKETS },
  { id: "email", zone: "support", title: "Email queue", requiredFeature: FEATURES.ADMIN_EMAIL_QUEUE },
  { id: "two_factor", zone: "access", title: "Two-factor", requiredFeature: FEATURES.ADMIN_TWO_FACTOR },
  { id: "accounts", zone: "access", title: "Locked accounts", requiredFeature: FEATURES.ADMIN_USERS },
  { id: "recent_changes", zone: "recent", title: "Recent operator changes", requiredFeature: FEATURES.ADMIN_AUDIT },
];
