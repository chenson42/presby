import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * The fourth gating axis (docs/work-log/2026-08-27-feature-categories.md,
 * Phase 3) — coarser than organization_feature_toggles, composed by
 * src/lib/org-feature-categories.ts and read into isOrgFeatureEnabled()'s
 * composition in src/lib/org-features.ts. Shape mirrors
 * organization_feature_toggles deliberately (composite PK, FORCE RLS,
 * tenant_isolation) — same table family, one level coarser.
 *
 * DEFAULT-ON: a missing row means the category is ENABLED. This is a
 * deliberate, stated deviation from organization_feature_toggles' own
 * "missing row -> false" convention — see src/lib/org-feature-categories.ts's
 * categoryEnabledInTx() for the full reasoning. Do not "fix" this table or
 * its resolver back to default-false without re-reading that comment; doing
 * so silently reintroduces a real regression for every org with existing
 * per-feature toggle state.
 *
 * CHECK CONSTRAINT, unlike feature_key (schema-layer-open, resolver-validated
 * only): category is a genuinely closed, six-value business taxonomy
 * (PortalDomain minus "administration"), not an open catalog mirroring
 * external flag-key strings. A CHECK is defense-in-depth specifically against
 * Phase 1 Gap 2 ("administration" must never become a selectable category) —
 * worth the schema-layer constraint here in a way it wasn't worth for
 * feature_key's intentionally open catalog. See DECISION-130.
 */
export const organizationFeatureCategories = pgTable(
  "organization_feature_categories",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Closed six-value taxonomy (PortalDomain minus "administration"),
    // enforced by the CHECK constraint below AND by isCategoryKey() at the
    // resolver layer (src/lib/org-feature-categories.ts) — defense in depth.
    category: text("category").notNull(),
    // Default true reinforces, but does not substitute for, the resolver's
    // own missing-row -> true convention: every write always sets this
    // explicitly (toggleOrgFeatureCategory), so this default is never
    // actually exercised by application code today — it exists so a row
    // inserted by some future path without an explicit value still lands on
    // the same semantic the missing-row convention implies, not the opposite.
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Nullable: same rationale as organization_feature_toggles.updatedBy.
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.category] }),
    index("organization_feature_categories_org_idx").on(t.organizationId),
    check(
      "organization_feature_categories_category_check",
      sql`${t.category} in ('people','worship','giving','governance','reports','communications')`,
    ),
  ],
);
