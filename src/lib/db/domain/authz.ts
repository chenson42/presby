import {
  pgTable,
  text,
  uuid,
  date,
  boolean,
  smallint,
  timestamp,
  index,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, organizationType } from "./org";
import { personProfiles } from "./people";
import { groups } from "./groups";
import { users } from "../schema";

/**
 * Authorization. See docs/schema-design.md section G.
 *
 * Three tiers:
 *   permissions       global, code-seeded, never tenant-writable
 *   constitutional    seeded per organization type, protected from deletion
 *   custom            church-created committee roles
 *
 * NO ROLE CARRIES A WILDCARD (invariant 6), including administrator roles at
 * every level. Only the platform database connection sees across tenants.
 *
 * TODO(starter-divergence): the starter's ADMIN_ROLE in src/lib/permissions.ts
 * is treated as "has every feature in the catalog" — a wildcard. That must be
 * removed before presby ships; a Church Administrator does not read tier 2 or
 * tier 3 by default.
 */
export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(), // 'roll.propose', 'roll.approve', 'ledger.approve'
  module: text("module").notNull(),
  description: text("description").notNull(),
  // 1 directory | 2 financial | 3 pastoral, demographic, medical
  sensitivityTier: smallint("sensitivity_tier").notNull().default(1),
});

export const appRoles = pgTable(
  "app_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // null = seed template applied to every org of organizationTypeScope
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    organizationTypeScope: organizationType("organization_type_scope"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    roleKind: text("role_kind").notNull().default("custom"), // constitutional | custom
    isProtected: boolean("is_protected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("app_roles_org_key").on(t.organizationId, t.key),
    index("app_roles_template_idx").on(t.organizationTypeScope),
  ],
);

export const appRolePermissions = pgTable(
  "app_role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => appRoles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [
    unique("app_role_permissions_pk").on(t.roleId, t.permissionKey),
    index("app_role_permissions_role_idx").on(t.roleId),
  ],
);

/**
 * The unified grant table. A role is granted to EITHER a person OR a group,
 * never both, so provenance is uniform.
 *
 * Group grants exist because without them, adding someone to the Property
 * Committee is two admin tasks and removing them is also two — and the second
 * one never gets done. Orphaned permissions accumulate silently in a
 * volunteer-run church. Binding permissions to membership makes removal
 * automatic.
 *
 * Term boundaries drop access on their own because the resolver reads
 * startsOn/endsOn rather than row existence.
 */
export const roleGrants = pgTable(
  "role_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => appRoles.id, { onDelete: "cascade" }),
    personId: uuid("person_id"),
    groupId: uuid("group_id"),
    startsOn: date("starts_on").notNull().defaultNow(),
    endsOn: date("ends_on"),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantReason: text("grant_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("role_grants_org_person_idx").on(
      t.organizationId,
      t.personId,
      t.startsOn,
      t.endsOn,
    ),
    index("role_grants_org_group_idx").on(
      t.organizationId,
      t.groupId,
      t.startsOn,
      t.endsOn,
    ),
    check(
      "role_grants_principal_check",
      sql`num_nonnulls(${t.personId}, ${t.groupId}) = 1`,
    ),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "role_grants_person_fk",
    }),
    foreignKey({
      columns: [t.groupId, t.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
      name: "role_grants_group_fk",
    }),
  ],
);

/**
 * Downward access, exception 1 of 2.
 *
 * Normally a presbytery gets ZERO direct grants inside a congregation: access
 * flows up by publication, never down by inheritance. The exception is when a
 * presbytery assumes original jurisdiction over a session. Time-boxed, minuted,
 * and surfaced in the congregation's own access log.
 */
export const administrativeCommissions = pgTable(
  "administrative_commissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentOrgId: uuid("parent_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetOrgId: uuid("target_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // original_jurisdiction | limited
    roleId: uuid("role_id").references(() => appRoles.id),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    minuteReference: text("minute_reference"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("administrative_commissions_target_idx").on(
      t.targetOrgId,
      t.startsOn,
      t.endsOn,
    ),
  ],
);

/**
 * Downward access, exception 2 of 2.
 *
 * A small congregation with nobody technical may genuinely want the presbytery
 * to administer their portal. GRANTED BY THE SESSION, never inherited —
 * revocable, time-boxed, and visible in the congregation's access log.
 */
export const orgDelegations = pgTable(
  "org_delegations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    grantorOrgId: uuid("grantor_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    granteeOrgId: uuid("grantee_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => appRoles.id),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    minuteReference: text("minute_reference"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("org_delegations_grantor_idx").on(t.grantorOrgId, t.startsOn),
    index("org_delegations_grantee_idx").on(t.granteeOrgId, t.startsOn),
  ],
);
