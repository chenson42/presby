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
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { personProfiles } from "./people";
import { users } from "../schema";

/**
 * Consent, privacy, and demographics. See docs/schema-design.md section H.
 *
 * PREFERENCES AND CONSENTS ARE DIFFERENT THINGS. A flag is a toggle the person
 * changes freely. A consent is a dated record with a source and, for minors, a
 * granting guardian. The printed directory and the kiosk both need to answer
 * "who agreed, when, and how" — which a boolean cannot.
 */
export const personPrivacy = pgTable(
  "person_privacy",
  {
    personId: uuid("person_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    directoryHidden: boolean("directory_hidden").notNull().default(false),
    hideEmail: boolean("hide_email").notNull().default(false),
    hidePhone: boolean("hide_phone").notNull().default(false),
    hideAddress: boolean("hide_address").notNull().default(false),
    hideBirthday: boolean("hide_birthday").notNull().default(true),
    // Default private (staff-only), carried over from fpcw.
    hideTalents: boolean("hide_talents").notNull().default(true),
    hidePhoto: boolean("hide_photo").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "person_privacy_person_fk",
    }),
  ],
);

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // directory_listing | photo_use | email_marketing | minor_directory | minor_photo
    consentType: text("consent_type").notNull(),
    granted: boolean("granted").notNull(),
    effectiveDate: date("effective_date").notNull(),
    expiresOn: date("expires_on"),
    // self_service | paper_form | staff_entry | import
    source: text("source").notNull(),
    // Parent or guardian, for minors.
    grantedByPersonId: uuid("granted_by_person_id"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("consents_org_person_idx").on(
      t.organizationId,
      t.personId,
      t.consentType,
      t.effectiveDate,
    ),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "consents_person_fk",
    }),
    foreignKey({
      columns: [t.grantedByPersonId, t.organizationId],
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "consents_guardian_fk",
    }),
  ],
);

/**
 * TIER 3. Categories are the exact 2024 SASR values — note that gender moved
 * from binary (2017) to three values, and racial-ethnic is self-identified
 * ("be guided by how an individual describes themselves").
 */
export const personDemographics = pgTable(
  "person_demographics",
  {
    personId: uuid("person_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // woman | man | non_binary_genderqueer
    gender: text("gender"),
    // asian, african, african_american, black, hispanic, middle_eastern,
    // native_american, white, other
    racialEthnic: text("racial_ethnic").array(),
    source: text("source").notNull().default("self"), // self | staff
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "person_demographics_person_fk",
    }),
  ],
);

/**
 * THE SHARPEST EDGE IN THE DATASET.
 *
 * The SASR instructs clerks to record disability "relying on personal knowledge
 * of individuals' disabilities" and explicitly not to survey the congregation.
 * That is staff-observed, health-adjacent data held without consent.
 *
 * Gated behind organizationSettings.settings.trackDisabilityPerPerson. When
 * off, the SASR disability lines are entered as aggregate counts only and this
 * table stays empty.
 */
export const personDisabilities = pgTable(
  "person_disabilities",
  {
    personId: uuid("person_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // hearing | mobility | sight | other
    source: text("source").notNull().default("staff_observed"),
  },
  (t) => [
    unique("person_disabilities_pk").on(t.personId, t.category),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "person_disabilities_person_fk",
    }),
  ],
);
