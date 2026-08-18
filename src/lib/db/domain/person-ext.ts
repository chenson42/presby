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
import { people } from "./people";
import { rollActions } from "./roll";
import { users } from "../schema";

/**
 * Everything a congregation keeps that is neither a roll fact nor a contact
 * detail. See docs/schema-design.md section C.
 *
 * Drawn from fpcw's members table plus the common denominator across Planning
 * Center, Breeze, Rock RMS, and ChurchCRM.
 */

/**
 * Tags are the ONLY tenant-extensible attribute in the schema.
 *
 * Custom fields were designed and then deliberately removed: a per-church field
 * nobody designed has no validation, no reporting, and no enforced sensitivity
 * tier, and it fragments the schema that the whole reusable-component thesis
 * depends on. When a church needs to track something new, that is a support
 * ticket -- and if the need is real it becomes a first-class feature for
 * everyone, not a column in one tenant.
 *
 * Tags cover the ad-hoc grouping case, which is most of what custom fields get
 * used for in the surveyed tools. Breeze's distinction is useful: tags search
 * with OR, structured fields search with AND.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    color: text("color"),
  },
  (t) => [
    unique("tags_org_name_key").on(t.organizationId, t.name),
    unique("tags_id_org_key").on(t.id, t.organizationId),
  ],
);

export const personTags = pgTable(
  "person_tags",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("person_tags_pk").on(t.personId, t.tagId),
    index("person_tags_org_tag_idx").on(t.organizationId, t.tagId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "person_tags_person_fk",
    }),
    foreignKey({
      columns: [t.tagId, t.organizationId],
      foreignColumns: [tags.id, tags.organizationId],
      name: "person_tags_tag_fk",
    }),
  ],
);

/**
 * Sacraments and life events. This IS the register of baptisms required by
 * G-3.0204(b), and it absorbs fpcw's dateBaptized, dateConfirmed, and
 * anniversaryDate.
 *
 * A baptism that also enrolls someone as a baptized member links to its roll
 * action; a baptism of an existing member does not.
 */
export const personMilestones = pgTable(
  "person_milestones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // baptism | confirmation | marriage | ordination | funeral |
    // first_communion | profession_of_faith
    milestone: text("milestone").notNull(),
    occurredOn: date("occurred_on"),
    location: text("location"),
    officiantPersonId: uuid("officiant_person_id"),
    officiantName: text("officiant_name"), // when not in the system
    witnesses: text("witnesses"), // sponsors, godparents, attendants
    performedByOrgId: uuid("performed_by_org_id").references(
      () => organizations.id,
    ),
    rollActionId: uuid("roll_action_id").references(() => rollActions.id),
    notes: text("notes"),
  },
  (t) => [
    index("person_milestones_org_person_idx").on(t.organizationId, t.personId),
    index("person_milestones_register_idx").on(
      t.organizationId,
      t.milestone,
      t.occurredOn,
    ),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "person_milestones_person_fk",
    }),
    foreignKey({
      columns: [t.officiantPersonId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "person_milestones_officiant_fk",
    }),
  ],
);

/**
 * Pastoral care notes. TIER 3, and `clergy_only` is the strictest grant in the
 * system — these carry clergy confidentiality, sit ABOVE financial data in
 * sensitivity, and the AI support worker never receives a grant on this table
 * under any elevation.
 */
export const personNotes = pgTable(
  "person_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // general | pastoral_care | visit | prayer | admin
    noteType: text("note_type").notNull().default("general"),
    // staff | pastoral | clergy_only
    visibility: text("visibility").notNull().default("staff"),
    body: text("body").notNull(),
    occurredOn: date("occurred_on"),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("person_notes_org_person_idx").on(
      t.organizationId,
      t.personId,
      t.createdAt,
    ),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "person_notes_person_fk",
    }),
  ],
);

/**
 * Breeze calls these Follow Ups, Planning Center calls them Workflows. This is
 * the visitor-to-member funnel, paired with people.engagementStatus and the
 * other_participant_enrolled roll action.
 */
export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // first_visit | new_member | inactive_outreach | care
    workflow: text("workflow"),
    step: text("step"),
    assignedToPersonId: uuid("assigned_to_person_id"),
    dueOn: date("due_on"),
    status: text("status").notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (t) => [
    index("follow_ups_org_assignee_idx").on(
      t.organizationId,
      t.assignedToPersonId,
      t.status,
      t.dueOn,
    ),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "follow_ups_person_fk",
    }),
    foreignKey({
      columns: [t.assignedToPersonId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "follow_ups_assignee_fk",
    }),
  ],
);

export const talentTypes = pgTable(
  "talent_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // spiritual_gift | skill | interest | instrument
    category: text("category").notNull(),
    name: text("name").notNull(),
  },
  (t) => [unique("talent_types_id_org_key").on(t.id, t.organizationId)],
);

export const personTalents = pgTable(
  "person_talents",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    talentTypeId: uuid("talent_type_id").notNull(),
    proficiency: text("proficiency"),
    willingToServe: boolean("willing_to_serve").notNull().default(true),
  },
  (t) => [
    unique("person_talents_pk").on(t.personId, t.talentTypeId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "person_talents_person_fk",
    }),
    foreignKey({
      columns: [t.talentTypeId, t.organizationId],
      foreignColumns: [talentTypes.id, talentTypes.organizationId],
      name: "person_talents_type_fk",
    }),
  ],
);

/**
 * Background checks. `expiresOn` is the operationally important column —
 * churches need "whose check lapses in 60 days," and a lapsed check on a
 * nursery volunteer is a real liability.
 *
 * Store the provider reference and a status. NEVER the underlying report.
 */
export const backgroundChecks = pgTable(
  "background_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // criminal | child_protection | driving | credit
    checkType: text("check_type").notNull(),
    provider: text("provider"),
    // requested | in_progress | clear | flagged | expired
    status: text("status").notNull(),
    completedOn: date("completed_on"),
    expiresOn: date("expires_on"),
    reference: text("reference"),
    recordedBy: uuid("recorded_by").references(() => users.id),
  },
  (t) => [
    index("background_checks_expiry_idx").on(
      t.organizationId,
      t.expiresOn,
      t.status,
    ),
    index("background_checks_org_person_idx").on(t.organizationId, t.personId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "background_checks_person_fk",
    }),
  ],
);

/** Tier 3. Children's check-in. */
export const personMedical = pgTable(
  "person_medical",
  {
    personId: uuid("person_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    allergies: text("allergies"),
    medicalNotes: text("medical_notes"),
    medications: text("medications"),
    authorizedPickup: text("authorized_pickup"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [people.id, people.organizationId],
      name: "person_medical_person_fk",
    }),
  ],
);
