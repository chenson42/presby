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
  uniqueIndex,
  check,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, orgUnits } from "./org";
import { users } from "../schema";

/**
 * People, memberships, households, and contact detail.
 * See docs/schema-design.md section B.
 *
 * D1: `people` is GLOBAL and holds the person's own data. The decisive argument
 * is polity — ministers of Word and Sacrament are members of the PRESBYTERY
 * (G-2.0502, G-2.0503) while ruling elders are members of the CONGREGATION, so
 * one human's roll and service routinely sit at different orgs.
 *
 * THE LINE: is a row about the PERSON, or about the RELATIONSHIP?
 *
 *   About the person       people, addresses, contact_methods
 *                          Link straight to person_id. No organization_id at
 *                          all. An address is the same address whichever
 *                          congregation is looking, and duplicating it per org
 *                          means an installed pastor's phone number is entered
 *                          twice and diverges.
 *
 *   About the relationship memberships, and every org record ABOUT a person:
 *                          roll_actions, officer_terms, person_notes, tags,
 *                          talents, background_checks, privacy, demographics.
 *                          These keep the composite (person_id,
 *                          organization_id) key, which is what stops Church B
 *                          writing notes about someone they have no
 *                          relationship with (F2).
 *
 * The earlier draft applied the composite key to everything, including the
 * person's own contact detail. That was over-applied.
 */

/**
 * GLOBAL. The person and their personal data.
 *
 * Visibility is governed by `memberships`: a person row is readable when the
 * current org holds a membership for them. See the person_visible_via_membership
 * policy in 0009_presby_rls.sql, and F21 for why creating a membership is not a
 * plain INSERT.
 */
export const people = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // One human, one login.
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Name
    title: text("title"), // Mr, Ms, Mrs, Rev, Dr
    firstName: text("first_name").notNull(),
    preferredName: text("preferred_name"),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    suffix: text("suffix"),
    formerName: text("former_name"), // maiden / previous

    // Personal facts. These belong to the human, not to any congregation's
    // record of them.
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

    // RETIRED (drizzle/0078, DECISION-285). Photos are org-scoped now:
    // person_photos / person_photo_designations (./person-photos), because a
    // photo, and the consent behind it, belong to the relationship, not the
    // human (G1). Held null on every connection by the CHECK
    // people_photo_key_retired (0078 section 4); read by no stored function
    // and by no TypeScript. The declaration stays until 0079 drops the
    // columns (and people_photo_key_lower_idx), because check:schema-parity
    // compares columns in both directions (F334). Do not read or write it.
    photoKey: text("photo_key"),
    photoUpdatedAt: timestamp("photo_updated_at", { withTimezone: true }),

    // Soft merge. Invariant 7: a person row is never hard-deleted.
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => people.id,
    ),

    /**
     * TEST-FIXTURE DELETION WINDOW, AND NOTHING ELSE (N-6, drizzle/0048
     * section 8) — the people-table twin of `organizations.deletableUntil`
     * (D10, drizzle/0044). Enforced by `presby_guard_people_delete()`, a
     * BEFORE DELETE trigger Drizzle cannot express: it refuses the DELETE
     * unless this is non-null and in the future, and it fires on the
     * `getPlatformDb()` owner path too, which a revoke never reaches (F44).
     * Stamp it with `fixtureDeletableUntil()` at fixture INSERT, never at
     * teardown. Production person rows never carry a value here.
     */
    deletableUntil: timestamp("deletable_until", { withTimezone: true }),

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

/**
 * Deterministic identity. GLOBAL.
 *
 * Email cannot be the key on `people`, and the evidence is in the sibling
 * projects: fpcw stores `emails text[]` commented "All emails as array for
 * matching", and westervillelions carries SHARED_HOUSEHOLD_EMAIL env vars
 * because a real couple shares one address. Add children and older members with
 * no email at all, and a natural key is null for a large share of any roll.
 *
 * So identity stays a surrogate uuid and identifiers become evidence, with the
 * uniqueness scoped to where it is actually safe:
 *
 *   VERIFIED and not shared  -> globally unique. Deterministic match.
 *   unverified, or shared    -> not unique. A matching signal only.
 *
 * That partial constraint is the whole design. It gives exact matching for the
 * cases that support it without breaking on the shared household address that
 * every church has.
 */
export const personIdentifiers = pgTable(
  "person_identifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    // email | phone | church360 | pcusa_id | legacy
    kind: text("kind").notNull(),
    // Lowercased, trimmed; phones reduced to digits. Match on this, display the
    // original from contact_methods.
    valueNormalized: text("value_normalized").notNull(),
    // Verified means we proved this person controls it (clicked a link, signed
    // in), not merely that a church typed it in.
    isVerified: boolean("is_verified").notNull().default(false),
    // The household address two spouses share. Explicitly opts out of
    // uniqueness rather than silently colliding.
    isShared: boolean("is_shared").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    source: text("source"), // self_service | import | staff_entry
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("person_identifiers_person_idx").on(t.personId),
    index("person_identifiers_lookup_idx").on(t.kind, t.valueNormalized),
    // Unique ONLY where uniqueness is actually safe.
    uniqueIndex("person_identifiers_verified_unique_idx")
      .on(t.kind, t.valueNormalized)
      .where(sql`is_verified and not is_shared`),
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
    // "Mail one directory per household." Points at a member's address rather
    // than duplicating it, since a household address IS its members' address.
    mailingAddressId: uuid("mailing_address_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("households_org_name_idx").on(t.organizationId, t.name),
    // Households per district and the Unassigned query (F263, drizzle/0068
    // section 3).
    index("households_org_unit_idx").on(t.organizationId, t.orgUnitId),
    unique("households_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.orgUnitId, t.organizationId],
      foreignColumns: [orgUnits.id, orgUnits.organizationId],
      name: "households_org_unit_fk",
    }),
    // NOT EXPRESSIBLE HERE: trigger households_org_unit_target_guard
    // (drizzle/0068 section 6) refuses a newly set archived, campus or
    // missing district. org_unit_id means deacon district only
    // (DECISION-243) and is written only by src/lib/parishes.ts.
  ],
);

/**
 * THE LINK. A person's relationship with one organization, carrying their roll
 * status there.
 *
 * A transfer does not move or copy a person: it ends the membership at the
 * losing church and opens one at the receiving church, against the same
 * `people` row. A pastor holds two at once — membership at the presbytery,
 * service at the congregation.
 *
 * This is also the composite-FK target for every org record ABOUT a person, so
 * F2's guarantee is unchanged: a row in org B can only reference a person who
 * has a membership in org B.
 *
 * Named to parallel `group_memberships`: that is the person-to-group link, this
 * is the person-to-organization link.
 */
export const memberships = pgTable(
  "memberships",
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

    // Pastoral axis. Never reported; distinct from the constitutional roll.
    // Plain text, not an enum — three recognized values in application code
    // as of docs/work-log/2026-08-27-staff-and-personnel.md (DECISION-129):
    // "visitor" (default — pastoral-track, carries firstVisitDate/howHeard),
    // "regular" (admits a row into getDirectory()'s/findPersonMatches()'s
    // default eligibility, alongside a roll-member current_roll value), and
    // "staff" (a known, anchored contact who is NOT a roll candidate —
    // written by createPerson()'s `rollAction: { kind: "none" }` arm;
    // distinct from "visitor"'s pastoral-care connotations, and DELIBERATELY
    // excluded from getDirectory()'s/findPersonMatches()'s 'regular'-only OR
    // branch so a staff-only anchor row never leaks into the public
    // directory or the admin/community roster).
    engagementStatus: text("engagement_status").notNull().default("visitor"),
    firstVisitDate: date("first_visit_date"),
    howHeard: text("how_heard"),

    // Projection of APPROVED roll actions, maintained by trigger. A cache for
    // the directory only — reports replay via rollAsOf(). See F6.
    currentRoll: text("current_roll"),
    currentRollSince: date("current_roll_since"),

    // Set when the person is dismissed by certificate or otherwise leaves. The
    // row is retained: invariant 7, and the register needs the history.
    endedOn: date("ended_on"),
    endedReason: text("ended_reason"),

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
    // THE composite-FK target for org records about a person.
    unique("memberships_person_org_key").on(t.personId, t.organizationId),
    // A person is an ACTIVE member of exactly one congregation. The other three
    // rolls may coexist elsewhere - an affiliate member is by definition an
    // active member of another church (G-1.0403) - but two active memberships
    // are constitutionally impossible.
    //
    // Only the global people model can express this. Under org-scoped people it
    // was unenforceable, because the two memberships lived in different rows
    // with no shared identity to constrain.
    uniqueIndex("memberships_one_active_roll_idx")
      .on(t.personId)
      .where(sql`current_roll = 'active' and ended_on is null`),
    unique("memberships_id_org_key").on(t.id, t.organizationId),
    // Supports the person_visible_via_membership RLS policy's EXISTS.
    index("memberships_person_idx").on(t.personId),
    index("memberships_org_roll_idx").on(t.organizationId, t.currentRoll),
    index("memberships_org_household_idx").on(t.organizationId, t.householdId),
    index("memberships_org_engagement_idx").on(
      t.organizationId,
      t.engagementStatus,
    ),
    foreignKey({
      columns: [t.householdId, t.organizationId],
      foreignColumns: [households.id, households.organizationId],
      name: "memberships_household_fk",
    }),
    foreignKey({
      columns: [t.orgUnitId, t.organizationId],
      foreignColumns: [orgUnits.id, orgUnits.organizationId],
      name: "memberships_org_unit_fk",
    }),
  ],
);

/**
 * GLOBAL. An address is the person's, not a congregation's record of it.
 *
 * Tradeoff, stated plainly: a church that shares a person with another church
 * sees the address that other church entered. That is the cost of not
 * duplicating it, and it is the right default for a connectional platform where
 * a pastor's congregation and presbytery are looking at the same human. Per-org
 * *display* is still controlled by `person_privacy`.
 */
export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
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
  (t) => [index("addresses_person_idx").on(t.personId)],
);

/**
 * GLOBAL, for the same reason as addresses.
 *
 * End-dated, never deleted, identity immutable (DECISION-215,
 * drizzle/0064_presby_person_emails.sql). Removing an address sets `ended_at`;
 * editing one ends the row and inserts a replacement, so `verified_at` never
 * travels to a different mailbox (F214). Every reader filters
 * `ended_at is null`. `src/lib/contact-methods/store.ts` is the only writer in
 * `src/`.
 *
 * What this builder cannot express, and where it is enforced:
 *   - `contact_methods_guard_write` (0064 section 6): BEFORE INSERT OR UPDATE,
 *     every role. id, person_id, kind, value and created_at are immutable; an
 *     ended row is frozen; a non-owner may not set or change `verified_at`,
 *     may not insert an ended row, and has `created_at` forced to
 *     clock_timestamp().
 *   - `contact_methods_primary_required` (0064 section 7): a DEFERRABLE
 *     INITIALLY DEFERRED, SECURITY DEFINER constraint trigger. At commit, a
 *     person with active email rows must have an active main one. With
 *     `contact_methods_one_primary_uq` below, "exactly one active main" holds
 *     at every commit.
 *   - DELETE is revoked from presby_app and presby_platform (0064 section 8).
 *     The owner keeps it (fixture cascades), a `paper` residual.
 *   - FORCE RLS and the four person-level policies (0009, 0028), unchanged.
 *   - The `presby_person_email(person, purpose)` reader (0064 section 9).
 */
export const contactMethods = pgTable(
  "contact_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // email | phone (contact_methods_kind_check)
    // Email: personal | work | other | null. Phone: mobile | home | work | null.
    subtype: text("subtype"),
    // Email values are stored normalized (lower, trimmed): see the shape CHECK.
    value: text("value").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    // Owner path only, in practice presby_accept_invitation (guard, above).
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // The database default is clock_timestamp() (0064 section 2, D2); the
    // guard forces it on every non-owner insert. Order: is_primary desc,
    // created_at, id (display); created_at, id (promotion).
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    // Null = active.
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("contact_methods_person_idx").on(t.personId),
    uniqueIndex("contact_methods_one_primary_uq")
      .on(t.personId, t.kind)
      .where(sql`is_primary and ended_at is null`),
    uniqueIndex("contact_methods_person_email_uq")
      .on(t.personId, sql`lower(btrim(${t.value}))`)
      .where(sql`kind = 'email' and ended_at is null`),
    index("contact_methods_email_norm_idx")
      .on(sql`lower(btrim(${t.value}))`)
      .where(sql`kind = 'email' and ended_at is null`),
    check("contact_methods_kind_check", sql`${t.kind} in ('email', 'phone')`),
    check(
      "contact_methods_subtype_check",
      sql`(${t.kind} = 'email' and (${t.subtype} is null or ${t.subtype} in ('personal', 'work', 'other'))) or (${t.kind} = 'phone' and (${t.subtype} is null or ${t.subtype} in ('mobile', 'home', 'work')))`,
    ),
    check(
      "contact_methods_value_shape",
      sql`(${t.kind} = 'email' and ${t.value} = lower(btrim(${t.value})) and char_length(${t.value}) <= 254 and ${t.value} ~ '^[^@[:space:],]+@[^@[:space:],]+\\.[^@[:space:],]+$') or (${t.kind} = 'phone' and ${t.value} = btrim(${t.value}) and ${t.value} <> '')`,
    ),
    check(
      "contact_methods_ended_not_primary",
      sql`${t.endedAt} is null or not ${t.isPrimary}`,
    ),
  ],
);

/**
 * Relationships the household cannot express. Planning Center stores these in
 * custom fields, which is a known weakness — guardian and emergency contact are
 * load-bearing for children's check-in, so they are first-class here.
 *
 * GLOBAL: a parent is a parent regardless of which church is looking.
 */
export const personRelationships = pgTable(
  "person_relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    relatedPersonId: uuid("related_person_id").references(() => people.id, {
      onDelete: "cascade",
    }),
    relatedName: text("related_name"), // when the other party is not in the system
    relationship: text("relationship").notNull(),
    isEmergencyContact: boolean("is_emergency_contact").notNull().default(false),
    notes: text("notes"),
  },
  (t) => [index("person_relationships_person_idx").on(t.personId)],
);
