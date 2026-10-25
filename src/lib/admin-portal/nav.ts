import { FEATURES, type FeatureKey } from "@/lib/permissions";

/**
 * The platform console's navigation registry. Replaces the tile registry
 * (`ADMIN_TILES`) it succeeds, under the same constraint (DECISION-123,
 * DECISION-253): PURE SYNCHRONOUS DATA. No `hasFeature`, no session, no query.
 * `FEATURES.*` is already on the session, so filtering happens once, in the
 * co-located `visibleAdminNav()` (`src/app/(admin)/admin/visible-nav.ts`),
 * which is the one place the session's features and this registry meet.
 *
 * `requiredFeature: null` means "the door only": the item needs nothing beyond
 * `FEATURES.ADMIN_DASHBOARD`, which the proxy already enforced to get here.
 * Dashboard and Design system are door-level by design (the design-system page
 * has no key of its own, F281).
 *
 * Hiding is not authorization. Every destination re-checks its own key.
 *
 * The group names are the dashboard's zone names too, so the operator learns
 * one structure.
 */
export interface AdminNavItem {
  label: string;
  href: string;
  /** `null` = door only (`FEATURES.ADMIN_DASHBOARD`). */
  requiredFeature: FeatureKey | null;
  /** Active only on an exact pathname match (the Dashboard). */
  exact?: boolean;
}

export interface AdminNavGroup {
  key: string;
  /** `null` = no visible heading (the Dashboard link stands alone). */
  heading: string | null;
  /** The footer group renders after a divider. */
  footer?: boolean;
  items: readonly AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    key: "home",
    heading: null,
    items: [
      { label: "Dashboard", href: "/admin", requiredFeature: null, exact: true },
    ],
  },
  {
    key: "organizations",
    heading: "Organizations",
    items: [
      {
        label: "Organizations",
        href: "/admin/organizations",
        requiredFeature: FEATURES.ADMIN_ORGANIZATIONS,
      },
      {
        label: "Domains",
        href: "/admin/organizations/domains",
        requiredFeature: FEATURES.ADMIN_ORGANIZATIONS,
      },
      {
        label: "Sites",
        href: "/admin/sites",
        requiredFeature: FEATURES.ADMIN_ORGANIZATIONS,
      },
      {
        label: "Giving health",
        href: "/admin/giving",
        requiredFeature: FEATURES.ADMIN_ORGANIZATIONS,
      },
    ],
  },
  {
    key: "support",
    heading: "Support",
    items: [
      {
        label: "Tickets",
        href: "/admin/tickets",
        requiredFeature: FEATURES.ADMIN_TICKETS,
      },
      {
        label: "Feedback",
        href: "/admin/feedback",
        requiredFeature: FEATURES.ADMIN_FEEDBACK,
      },
      {
        label: "Email queue",
        href: "/admin/email-queue",
        requiredFeature: FEATURES.ADMIN_EMAIL_QUEUE,
      },
    ],
  },
  {
    key: "access",
    heading: "Access and settings",
    items: [
      {
        label: "Users & roles",
        href: "/admin/users",
        requiredFeature: FEATURES.ADMIN_USERS,
      },
      {
        label: "2FA policy",
        href: "/admin/2fa",
        requiredFeature: FEATURES.ADMIN_TWO_FACTOR,
      },
      {
        label: "Feature flags",
        href: "/admin/flags",
        requiredFeature: FEATURES.ADMIN_FLAGS,
      },
      {
        label: "Audit log",
        href: "/admin/audit",
        requiredFeature: FEATURES.ADMIN_AUDIT,
      },
    ],
  },
  {
    key: "content",
    heading: "Content",
    items: [
      {
        label: "What's new",
        href: "/admin/whats-new",
        requiredFeature: FEATURES.ADMIN_WHATS_NEW,
      },
    ],
  },
  {
    key: "reference",
    heading: "Reference",
    footer: true,
    items: [
      {
        label: "Release notes",
        href: "/admin/docs",
        requiredFeature: FEATURES.ADMIN_RELEASE_NOTES,
      },
      {
        label: "Design system",
        href: "/admin/design-system",
        requiredFeature: null,
      },
    ],
  },
];
