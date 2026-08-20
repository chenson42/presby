/**
 * Reserved name of the role that bypasses per-feature checks and is treated
 * as "has every feature in the catalog." A single source of truth — never
 * inline the literal `"admin"` in code or middleware.
 */
export const ADMIN_ROLE = "admin" as const;
export const MEMBER_ROLE = "member" as const;

export const FEATURES = {
  ADMIN_DASHBOARD: "admin.dashboard",
  ADMIN_USERS: "admin.users",
  ADMIN_FLAGS: "admin.flags",
  ADMIN_RELEASE_NOTES: "admin.release_notes",
  ADMIN_FEEDBACK: "admin.feedback",
  ADMIN_AUDIT: "admin.audit",
  ADMIN_EMAIL_QUEUE: "admin.email_queue",
  ADMIN_WHATS_NEW: "admin.whats_new",
  ADMIN_TWO_FACTOR: "admin.two_factor",
  ADMIN_ORGANIZATIONS: "admin.organizations",
  ADMIN_TICKETS: "admin.tickets",
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

export const FEATURE_CATALOG: Array<{
  key: FeatureKey;
  name: string;
  description: string;
  category: string;
}> = [
  {
    key: FEATURES.ADMIN_DASHBOARD,
    name: "Admin dashboard",
    description: "Access the /admin landing page.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_TWO_FACTOR,
    name: "Manage two-factor policy",
    description:
      "Set which congregations require two-factor authentication, and see who is required but not yet enrolled.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_USERS,
    name: "Manage users",
    description: "View users and assign roles.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_ORGANIZATIONS,
    name: "Manage organization branding",
    description:
      "Set a congregation's brand colour, logo and type pairing at onboarding; neutralise an abusive tenant's brand.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_TICKETS,
    name: "Manage support tickets",
    description:
      "Triage the cross-org support ticket queue at /admin/tickets: status, assignment, classification, and replies.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_FLAGS,
    name: "Manage feature flags",
    description: "Toggle environment feature flags on or off.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_RELEASE_NOTES,
    name: "Read release notes",
    description: "View release notes from the admin docs page.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_FEEDBACK,
    name: "Manage feedback",
    description: "View and triage member feedback submissions at /admin/feedback.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_AUDIT,
    name: "View audit log",
    description: "Read the security audit log at /admin/audit.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_EMAIL_QUEUE,
    name: "Email queue",
    description: "View the outbound email queue and retry failed sends.",
    category: "admin",
  },
  {
    key: FEATURES.ADMIN_WHATS_NEW,
    name: "What's new",
    description: "Create, edit, and delete What's new entries visible to members.",
    category: "admin",
  },
];

export function hasFeature(
  userFeatures: string[] | undefined,
  required: FeatureKey,
): boolean {
  return Array.isArray(userFeatures) && userFeatures.includes(required);
}
