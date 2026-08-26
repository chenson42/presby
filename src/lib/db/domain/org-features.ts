import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * Per-org feature enablement — the third gating axis (DECISION-097,
 * docs/work-log/2026-08-25-member-management.md "Per-Org Feature Enablement —
 * Architectural Ruling").
 *
 * Two mechanisms already exist and stay separate (DECISION-003):
 *   `feature_flags`   the global, platform-wide kill switch — does a feature
 *                     exist ANYWHERE, regardless of tenant.
 *   `permissions`     WHO within an entitled org may use it, resolved per
 *                     person by `presby_has_permission()`.
 *
 * This table is neither. It answers "does this feature exist for THIS org" —
 * one congregation can turn on member-creation while another leaves it off,
 * independent of every other org of the same type. Compose, never replace:
 * the gate order is flag -> org toggle -> permission, cheapest and most
 * centrally-controlled first.
 *
 * GENUINELY composite PK, unlike `organizationSettings`/`organizationBrands`
 * (those are degenerate — one row per org, PK is `organization_id` alone).
 * This table carries many rows per org, one per feature key, so
 * `(organization_id, feature_key)` is the real key — stated explicitly per
 * the same "or the next reviewer 'fixes' it" instinct `organizationBrands`'
 * own comment names.
 *
 * `feature_key` deliberately carries no FK to `feature_flags.key` — the two
 * catalogs are allowed to name the same string (by convention, not
 * constraint) without one table owning the other; `ORG_FEATURE_CATALOG`
 * (src/lib/org-features.ts, api-developer layer) is the actual whitelist a
 * write validates against.
 *
 * FORCE RLS, standard `tenant_isolation` policy — this table is read/written
 * through `presby_app` from `(org)`'s own `/o/[slug]/admin/features`, never
 * `getPlatformDb()` (contrast `organization_brands`, which today is
 * platform-operator-only). See
 * drizzle/0026_presby_org_feature_toggles.sql for the RLS policy and the
 * `org_features.manage` permission-catalog row.
 */
export const organizationFeatureToggles = pgTable(
  "organization_feature_toggles",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Same string as feature_flags.key, by convention only — no FK (see
    // header comment). Validated against ORG_FEATURE_CATALOG at the
    // resolver layer, not the schema layer.
    featureKey: text("feature_key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Nullable: a row inserted before any human toggle exists (there isn't
    // one today — every row is written by an explicit admin action — but the
    // column doesn't assume that will always be true).
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.featureKey] }),
    index("organization_feature_toggles_org_idx").on(t.organizationId),
  ],
);
