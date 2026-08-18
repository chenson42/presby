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
 * D1 (REVERSED after review): `people` is GLOBAL. A person is one human, and
 * the decisive argument is polity rather than convenience — ministers of Word
 * and Sacrament are members of the PRESBYTERY (G-2.0502, G-2.0503) while ruling
 * elders are members of the CONGREGATION. A pastor's membership therefore sits
 * at one org while their service sits at another. Org-scoped people forced two
 * rows for one human with the roll at one end and the officer term at the
 * other, and made every transfer mint a duplicate that never healed.
 *
 * The split:
 *   people          IDENTITY ONLY. The minimum needed to recognize a human.
 *                   Deliberately thin: it is the one surface shared across
 *                   tenants, so every column on it is a column one church can
 *                   see because another church entered it.
 *   person_profiles Everything a specific organization knows and holds. Roll
 *                   state, household, contact, engagement, integration ids.
 *
 * F2 SURVIVES THE REVERSAL. `person_profiles` carries unique (person_id,
 * organization_id), so every child table still declares a composite foreign
 * key — a row in org B can only reference a person who has a profile in org B.
 * The guarantee is unchanged; only its target moved.
 */

/**
 * GLOBAL. No organization_id, and therefore no standard tenant policy: a person
 * row is visible when the current org holds a profile for them (see
 * 0009_presby_rls.sql).
 *
 * Duplicate detection has to look at rows the caller cannot read. That runs
 * through a narrow, audited, server-side matcher that returns a match token and
 * minimal disclosure, never a row — the same shape as transfer_certificates.
 */
export const people = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // One human, one login. With global people this is finally 1:1.
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    title: text("title"), // Mr, Ms, Mrs, Rev, Dr
    firstName: text("first_name").notNull(),
    preferredName: text("preferred_name"),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    suffix: text("suffix"),
    formerName: text("former_name"), // maiden / previous

    dateOfBirth: date("date_of_birth"),
    // Imported records routinely carry a year and nothing else, and the SASR
    // age brackets still have to bucket them.
    birthYearOnly: boolean("birth_year_only").notNull().default(false),
    dateOfDeath: date("date_of_death"),

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
    index("people_name_idx").on(t.lastName, t.firstName),
    index("people_user_idx").on(t.userId),
  ],
);

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

/**
 * What one organization knows about one person. The composite-FK target for
 * every child table in the schema.
 *
 * A person with profiles at both a congregation and a presbytery is the normal
 * case, not an edge case: every installed pastor, and every ruling elder who
 * serves on a presbytery committee.
 */
export const personProfiles = pgTable(
  "person_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),

    orgUnitId: uuid("org_unit_id"), // parish / campus / district
    householdId: uuid("household_id"),
    householdRole: text("household_role"), // head | spouse | child | other

    // Org-specific facts. Held here rather than on `people` so one church's
    // record of a person is not visible to another church that happens to
    // share them.
    maritalStatus: text("marital_status"),
    anniversaryDate: date("anniversary_date"),
    occupation: text("occupation"),
    employer: text("employer"),
    school: text("school"),
    grade: text("grade"),
    primaryLanguage: text("primary_language"),

    // Object-storage key, not bytes. See F13.
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

    // {"church360": "...", "envelope": "142", "mailchimp": "..."}
    externalIds: jsonb("external_ids").notNull().default({}),
    mailchimpStatus: text("mailchimp_status"),
    mailchimpSyncedAt: timestamp("mailchimp_synced_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // THE composite-FK target. Every child table points here, which is how F2
    // survives `people` going global.
    unique("person_profiles_person_org_key").on(t.personId, t.organizationId),
    unique("person_profiles_id_org_key").on(t.id, t.organizationId),
    index("person_profiles_org_roll_idx").on(t.organizationId, t.currentRoll),
    index("person_profiles_org_household_idx").on(
      t.organizationId,
      t.householdId,
    ),
    index("person_profiles_org_engagement_idx").on(
      t.organizationId,
      t.engagementStatus,
    ),
    foreignKey({
      columns: [t.householdId, t.organizationId],
      foreignColumns: [households.id, households.organizationId],
      name: "person_profiles_household_fk",
    }),
    foreignKey({
      columns: [t.orgUnitId, t.organizationId],
      foreignColumns: [orgUnits.id, orgUnits.organizationId],
      name: "person_profiles_org_unit_fk",
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
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
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
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
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
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "person_relationships_person_fk",
    }),
    foreignKey({
      columns: [t.relatedPersonId, t.organizationId],
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "person_relationships_related_fk",
    }),
  ],
);

/**
 * `person_links` is DELETED by the D1 reversal.
 *
 * Its entire job was joining org-scoped duplicates of the same human. With
 * global `people` there are no duplicates to join, so the table, its bespoke
 * cross-tenant RLS policy, and the disclosure it leaked all disappear. The
 * transfer flow keeps `transfer_certificates`, which was always doing the
 * separate job of authorizing a dismissal/reception pair.
 */
