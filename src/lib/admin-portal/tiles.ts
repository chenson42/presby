import { FEATURES, type FeatureKey } from "@/lib/permissions";

/**
 * The platform-portal tool-tile registry — `/admin`'s equivalent of
 * `src/lib/org-portal/tiles.ts`, mirroring its NAME, not its SHAPE
 * (architect Phase 2 ruling, docs/work-log/
 * 2026-08-27-platform-home-and-portal.md; "platform-portal" itself was
 * rejected as a directory name — overloaded term).
 *
 * PURE SYNCHRONOUS DATA. ZERO IMPORTS OF `hasFeature`/`isFlagEnabled`/
 * session/query. This is a hard constraint from the architect's Phase 2
 * ruling (DECISION-123): `FEATURES.*` is already ON the session, so
 * `hasFeature()` is a trivial synchronous array-includes check — filtering
 * happens ONCE, at the page, via the colocated `visibleAdminTiles()` helper
 * in `src/app/(admin)/admin/visible-tiles.ts` (not exported from here — it
 * lives next to its one consumer, the same precedent `src/app/launch/
 * destination.ts` set for pure routing logic). This module must never grow
 * a permission check of its own.
 *
 * `FEATURES.ADMIN_DASHBOARD` is the axis's single "door" feature (formalized
 * by DECISION-123) — it gates whether `/admin` admits a session at all
 * (`src/proxy.ts`'s catch-all `PROTECTION_RULES` entry), never a tile. Every
 * other `admin.*` key gates one tile's visibility once inside. That is why
 * `ADMIN_DASHBOARD` has no row below: 10 tiles for 11 `FEATURES.*` keys.
 *
 * `design-system` and `sites` are deliberately absent — see the work-log's
 * Edge Cases. `design-system` was an explicit operator decision (Phase 1
 * Q5) to drop it from the tile grid entirely, reachable only by URL.
 * `sites` (gated `FEATURES.ADMIN_ORGANIZATIONS`) is a second,
 * previously-unrecognized gap named but explicitly deferred — see
 * `docs/TODO.md`.
 */
export type AdminDomain =
  | "people_access"
  | "platform_operations"
  | "content_communications";

export const ADMIN_DOMAIN_LABELS: Record<AdminDomain, string> = {
  people_access: "People & Access",
  platform_operations: "Platform Operations",
  content_communications: "Content & Communications",
};

export const ADMIN_DOMAIN_ORDER: readonly AdminDomain[] = [
  "people_access",
  "platform_operations",
  "content_communications",
];

export interface AdminTile {
  key: string;
  label: string;
  description: string;
  /** Plain string — no per-org slug on this axis, unlike `PortalTile.href`. */
  href: string;
  requiredFeature: FeatureKey;
  domain: AdminDomain;
}

export const ADMIN_TILES: readonly AdminTile[] = [
  {
    key: "users",
    label: "Users & roles",
    description: "Assign roles to users.",
    href: "/admin/users",
    requiredFeature: FEATURES.ADMIN_USERS,
    domain: "people_access",
  },
  {
    key: "2fa",
    label: "2FA policy",
    description:
      "Choose which congregations require two-factor, and see who is required but not enrolled.",
    href: "/admin/2fa",
    requiredFeature: FEATURES.ADMIN_TWO_FACTOR,
    domain: "people_access",
  },
  {
    key: "organizations",
    label: "Organizations",
    description:
      "Set a congregation's brand colour, logo and type pairing, and see which are still on the default palette.",
    href: "/admin/organizations",
    requiredFeature: FEATURES.ADMIN_ORGANIZATIONS,
    domain: "platform_operations",
  },
  {
    key: "flags",
    label: "Feature flags",
    description: "Toggle environment features.",
    href: "/admin/flags",
    requiredFeature: FEATURES.ADMIN_FLAGS,
    domain: "platform_operations",
  },
  {
    key: "audit",
    label: "Audit log",
    description: "Security events, sign-ins, and flag changes.",
    href: "/admin/audit",
    requiredFeature: FEATURES.ADMIN_AUDIT,
    domain: "platform_operations",
  },
  {
    key: "email_queue",
    label: "Email queue",
    description: "Monitor outbound email and retry failed sends.",
    href: "/admin/email-queue",
    requiredFeature: FEATURES.ADMIN_EMAIL_QUEUE,
    domain: "platform_operations",
  },
  {
    key: "docs",
    label: "Release notes",
    description: "What shipped, when.",
    href: "/admin/docs",
    requiredFeature: FEATURES.ADMIN_RELEASE_NOTES,
    domain: "content_communications",
  },
  {
    key: "whats_new",
    label: "What's new",
    description: "Publish updates for members to see on their home page.",
    href: "/admin/whats-new",
    requiredFeature: FEATURES.ADMIN_WHATS_NEW,
    domain: "content_communications",
  },
  {
    key: "feedback",
    label: "Feedback",
    description: "Review member suggestions and bug reports.",
    href: "/admin/feedback",
    requiredFeature: FEATURES.ADMIN_FEEDBACK,
    domain: "content_communications",
  },
  {
    key: "tickets",
    label: "Tickets",
    // The second present defect this pipeline fixes (DECISION-123/Phase 2):
    // FEATURES.ADMIN_TICKETS already gates /admin/tickets at the RSC layer
    // and has never had a tile. Description matches FEATURE_CATALOG's own
    // ADMIN_TICKETS description verbatim.
    description:
      "Triage the cross-org support ticket queue: status, assignment, classification, and replies.",
    href: "/admin/tickets",
    requiredFeature: FEATURES.ADMIN_TICKETS,
    domain: "content_communications",
  },
] as const;
