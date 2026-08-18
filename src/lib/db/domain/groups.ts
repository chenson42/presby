import {
  pgTable,
  text,
  uuid,
  date,
  boolean,
  timestamp,
  index,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./org";
import { memberships } from "./people";

/**
 * Groups. See docs/schema-design.md section F.
 *
 * A group is a fact about people; a role is a grant of authority. Rock RMS
 * collapses the two (a security role IS a group). We do not, because of one
 * Presbyterian case: THE SESSION IS NOT A GROUP OF PEOPLE, IT IS A COURT. Its
 * membership is constitutionally determined by who holds an active ruling elder
 * term. If a staff member could add someone to it, the court would be invalid
 * and every action it minuted would be questionable.
 */
export const groupTypes = pgTable(
  "group_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // null = platform-wide template seeded per organization type
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(), // committee | small_group | choir | team | court
    name: text("name").notNull(),
  },
  (t) => [index("group_types_org_idx").on(t.organizationId, t.key)],
);

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupTypeId: uuid("group_type_id")
      .notNull()
      .references(() => groupTypes.id),
    name: text("name").notNull(),
    description: text("description"),
    // managed = staff edit the roster.
    // derived = the roster is materialized from officerTerms by trigger and
    //           direct writes are rejected. This enforces invariant 5.
    membershipSource: text("membership_source").notNull().default("managed"),
    derivedFrom: text("derived_from"), // session | diaconate
    isProtected: boolean("is_protected").notNull().default(false),
    meetsWhen: text("meets_when"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("groups_org_idx").on(t.organizationId, t.name),
    unique("groups_id_org_key").on(t.id, t.organizationId),
    // Every org is seeded with its derived groups at creation, and the
    // officerTerms trigger fails loudly if one is missing. See F16.
    unique("groups_org_derived_key").on(t.organizationId, t.derivedFrom),
    check(
      "groups_derived_check",
      sql`${t.membershipSource} = 'managed' or ${t.derivedFrom} is not null`,
    ),
  ],
);

/**
 * Group membership is org-scoped independently of where a person's membership
 * roll sits. A ruling elder whose roll is at a congregation but who serves on a
 * presbytery committee simply holds a person_profile at each — one global
 * `people` row, two profiles. This is also how an installed pastor works, since
 * ministers of Word and Sacrament are members of the presbytery (G-2.0502).
 *
 * Rows with source = 'derived' are owned by the officerTerms trigger. The
 * derived roster is MATERIALIZED here rather than exposed as a view, because
 * the permission resolver reads this table — a view would make session members
 * invisible to it, and a role granted to the Session group would resolve to
 * nobody. See F3.
 */
export const groupMemberships = pgTable(
  "group_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").notNull(),
    personId: uuid("person_id").notNull(),
    groupRole: text("group_role").notNull().default("member"), // chair | leader | member
    source: text("source").notNull().default("managed"), // managed | derived
    startsOn: date("starts_on").notNull().defaultNow(),
    endsOn: date("ends_on"),
  },
  (t) => [
    index("group_memberships_org_group_idx").on(
      t.organizationId,
      t.groupId,
      t.startsOn,
      t.endsOn,
    ),
    index("group_memberships_org_person_idx").on(t.organizationId, t.personId),
    foreignKey({
      columns: [t.groupId, t.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
      name: "group_memberships_group_fk",
    }),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "group_memberships_person_fk",
    }),
  ],
);
