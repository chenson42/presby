import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * The ecclesiastical hierarchy. See docs/schema-design.md section A.
 *
 * `organizations` is deliberately NOT tenant-isolated: the org tree is public
 * information (PC(USA) publishes congregation and presbytery lists). Anything
 * sensitive lives in `organizationSettings`, which carries the standard policy.
 */
export const organizationType = pgEnum("organization_type", [
  "general_assembly",
  "synod",
  "presbytery",
  "congregation",
  "new_worshiping_community",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id").references((): AnyPgColumn => organizations.id),
    organizationType: organizationType("organization_type").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // Materialized ancestry, trigger-maintained. Migrated to `ltree` in SQL so
    // "every congregation under this presbytery" is an index scan, not a
    // recursive CTE on every request.
    path: text("path").notNull(),
    status: text("status").notNull().default("active"),
    // D9. Most congregations in a presbytery will NOT be tenants, so the
    // presbytery's launch-day job is managing data about churches that are not
    // on the platform.
    //
    //   managed    a real tenant. Invariant 2 applies in full: the parent
    //              council gets nothing from inside except by publication,
    //              commission, or session-granted delegation.
    //   unmanaged  in the hierarchy but not a tenant. Records are STEWARDED by
    //              the parent council, because there is no session on the
    //              platform to grant anything.
    //   invited    onboarding; stewarded pending handover.
    //
    // Stewardship must LAPSE when an org becomes managed. A presbytery still
    // writing into a church's records after that church joins is precisely the
    // trust failure publish-upward exists to prevent.
    platformStatus: text("platform_status").notNull().default("unmanaged"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("organizations_parent_idx").on(t.parentId),
    index("organizations_type_idx").on(t.organizationType),
    // Target of every composite tenant foreign key. See schema-design F2.
    unique("organizations_id_key").on(t.id),
  ],
);

/**
 * Per-org sensitive configuration, split out of `organizations` so the org tree
 * can stay publicly readable. Resolved in review round 1.
 */
export const organizationSettings = pgTable("organization_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Office of the General Assembly church PIN, used for SASR submission.
  pcusaPin: text("pcusa_pin"),
  // Includes sessionServesAsTrustees, hasDeacons, trackDisabilityPerPerson.
  settings: jsonb("settings").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Optional subdivision inside a congregation. fpcw calls these parishes;
 * elsewhere they are deacon districts, care groups, or campuses (multi-site).
 *
 * NOTE (F15): the design had `shepherd_person_id` here, which created a
 * circular composite foreign key with `people.org_unit_id`. The shepherd is
 * derived from a group instead — it was already a group concept.
 */
export const orgUnits = pgTable(
  "org_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitType: text("unit_type").notNull(), // parish | campus | district
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("org_units_org_idx").on(t.organizationId, t.unitType),
    unique("org_units_id_org_key").on(t.id, t.organizationId),
  ],
);
