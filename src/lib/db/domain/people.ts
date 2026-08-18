import {
  pgTable,
  text,
  uuid,
  date,
  boolean,
  numeric,
  timestamp,
  jsonb,
  index,
  unique,
  foreignKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, orgUnits } from "./org";
import { users } from "../schema";

/**
 * People, households, and contact detail. See docs/schema-design.md section B.
 *
 * Every foreign key between tenant-owned tables is composite (id,
 * organization_id) — a plain `references people(id)` would let a row in org B
 * point at a person in org A, and RLS filters reads, not bad writes. See F2.
 */
export const households = pgTable(
  "households",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // "The Smith Family"
    formalName: text("formal_name"), // "Mr. and Mrs. John Smith"
    informalName: text("informal_name"), // "John and Mary"
    // SASR reports household count as "potential giving units".
    isGivingUnit: boolean("is_giving_unit").notNull().default(true),
    orgUnitId: uuid("org_unit_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("households_org_name_idx").on(t.organizationId, t.name),
    unique("households_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.orgUnitId, t.organizationId],
      foreignColumns: [orgUnits.id, orgUnits.organizationId],
      name: "households_org_unit_fk",
    }),
  ],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Auth link only. Most people never sign in and have no user row.
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    orgUnitId: uuid("org_unit_id"),

    // Name
    title: text("title"), // Mr, Ms, Mrs, Rev, Dr
    firstName: text("first_name").notNull(),
    preferredName: text("preferred_name"),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    suffix: text("suffix"),
    formerName: text("former_name"), // maiden / previous

    // Core facts
    dateOfBirth: date("date_of_birth"),
    // Imported records routinely carry a year and nothing else, and the SASR
    // age brackets still have to bucket them.
    birthYearOnly: boolean("birth_year_only").notNull().default(false),
    dateOfDeath: date("date_of_death"),
    maritalStatus: text("marital_status"),
    anniversaryDate: date("anniversary_date"),
    occupation: text("occupation"),
    employer: text("employer"),
    school: text("school"),
    grade: text("grade"),
    primaryLanguage: text("primary_language"),

    // Household
    householdId: uuid("household_id"),
    householdRole: text("household_role"), // head | spouse | child | other

    // Photo. Stored as an object-storage key, not bytes — see F13.
    photoKey: text("photo_key"),
    photoUpdatedAt: timestamp("photo_updated_at", { withTimezone: true }),

    // Pastoral axis. Never reported; distinct from the constitutional roll.
    engagementStatus: text("engagement_status").notNull().default("visitor"),
    firstVisitDate: date("first_visit_date"),
    howHeard: text("how_heard"),

    // Projection of APPROVED roll actions, maintained by trigger. A cache for
    // the directory only — reports replay via rollAsOf(). See F6.
    currentRoll: text("current_roll"),
    currentRollSince: date("current_roll_since"),

    // Integration: {"church360": "...", "envelope": "142", "mailchimp": "..."}
    externalIds: jsonb("external_ids").notNull().default({}),
    mailchimpStatus: text("mailchimp_status"),
    mailchimpSyncedAt: timestamp("mailchimp_synced_at", { withTimezone: true }),

    // Soft merge. Invariant 7: a person row is never hard-deleted.
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => people.id,
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("people_org_name_idx").on(t.organizationId, t.lastName, t.firstName),
    index("people_org_roll_idx").on(t.organizationId, t.currentRoll),
    index("people_org_household_idx").on(t.organizationId, t.householdId),
    index("people_org_engagement_idx").on(t.organizationId, t.engagementStatus),
    index("people_org_user_idx").on(t.organizationId, t.userId),
    unique("people_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.householdId, t.organizationId],
      foreignColumns: [households.id, households.organizationId],
      name: "people_household_fk",
    }),
    foreignKey({
      columns: [t.orgUnitId, t.organizationId],
      foreignColumns: [orgUnits.id, orgUnits.organizationId],
      name: "people_org_unit_fk",
    }),
  ],
);

export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    householdId: uuid("household_id"),
    personId: uuid("person_id"), // person-level overrides household
    addressType: text("address_type").notNull(), // home | seasonal | mailing | work
    line1: text("line1"),
    line2: text("line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country").default("US"),
    latitude: numeric("latitude"),
    longitude: numeric("longitude"),
    // Snowbirds. The SASR names them explicitly as a common affiliate case.
    seasonStart: date("season_start"),
    seasonEnd: date("season_end"),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    index("addresses_org_household_idx").on(t.organizationId, t.householdId),
    index("addresses_org_person_idx").on(t.organizationId, t.personId),
    check(
      "addresses_subject_check",
      sql`${t.householdId} is not null or ${t.personId} is not null`,
    ),
    foreignKey({
      columns: [t.householdId, t.organizationId],
      foreignColumns: [households.id, households.organizationId],
      name: "addresses_household_fk",
    }),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "addresses_person_fk",
    }),
  ],
);

export const contactMethods = pgTable(
  "contact_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    kind: text("kind").notNull(), // email | phone
    subtype: text("subtype"), // mobile | home | work
    value: text("value").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [
    index("contact_methods_org_person_idx").on(t.organizationId, t.personId),
    index("contact_methods_org_value_idx").on(
      t.organizationId,
      sql`lower(${t.value})`,
    ),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "contact_methods_person_fk",
    }),
  ],
);

/**
 * Relationships the household cannot express. Planning Center stores these in
 * custom fields, which is a known weakness — guardian and emergency contact are
 * load-bearing for children's check-in, so they are first-class here.
 */
export const personRelationships = pgTable(
  "person_relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    relatedPersonId: uuid("related_person_id"),
    relatedName: text("related_name"), // when the other party is not in the system
    relationship: text("relationship").notNull(),
    isEmergencyContact: boolean("is_emergency_contact").notNull().default(false),
    notes: text("notes"),
  },
  (t) => [
    index("person_relationships_org_person_idx").on(
      t.organizationId,
      t.personId,
    ),
    check(
      "person_relationships_target_check",
      sql`${t.relatedPersonId} is not null or ${t.relatedName} is not null`,
    ),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "person_relationships_person_fk",
    }),
    foreignKey({
      columns: [t.relatedPersonId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "person_relationships_related_fk",
    }),
  ],
);

/**
 * The one deliberate seam between organizations (D1). Links two `people` rows
 * that are the same human at different orgs — a ruling elder serving on a
 * presbytery committee, or a completed transfer of membership.
 *
 * NOT tenant-scoped, and therefore NOT composite-keyed. Its RLS policy is
 * bespoke: visible when the current org owns either side.
 */
export const personLinks = pgTable(
  "person_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personAId: uuid("person_a_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    personBId: uuid("person_b_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    linkReason: text("link_reason").notNull(),
    establishedBy: uuid("established_by").references(() => users.id),
    establishedAt: timestamp("established_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("person_links_pair_key").on(t.personAId, t.personBId),
    check("person_links_order_check", sql`${t.personAId} < ${t.personBId}`),
  ],
);
