import {
  pgTable,
  pgEnum,
  text,
  uuid,
  date,
  integer,
  timestamp,
  index,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { personProfiles } from "./people";
import { users } from "../schema";

/**
 * Ordination and officer terms. See docs/schema-design.md section E.
 *
 * ORDINATION IS LIFELONG; SERVICE IS TERMED. A person off session is still an
 * ordained ruling elder. Conflating the two irritates every clerk who uses the
 * system, and it breaks the register.
 *
 * The registers required by G-3.0204(b) are views over these tables plus
 * personMilestones — do not build them separately.
 */
export const orderedMinistry = pgEnum("ordered_ministry", [
  "ruling_elder",
  "deacon",
  "minister_of_word_and_sacrament",
]);

export const ordinations = pgTable(
  "ordinations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    ministry: orderedMinistry("ministry").notNull(),
    ordainedOn: date("ordained_on").notNull(),
    ordainingOrgId: uuid("ordaining_org_id").references(() => organizations.id),
    minuteReference: text("minute_reference"),
    // Removal from ordered ministry. Rare, but it exists.
    endedOn: date("ended_on"),
    endedReason: text("ended_reason"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ordinations_org_person_idx").on(t.organizationId, t.personId),
    index("ordinations_org_ministry_idx").on(t.organizationId, t.ministry),
    unique("ordinations_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "ordinations_person_fk",
    }),
  ],
);

/**
 * A term of active service. Unlike rollActions this table is MUTABLE (F10): a
 * resignation or death sets endsOn and endReason on the existing row, because a
 * term is a span, not an event. Changes are captured by auditEvents rather than
 * by immutability.
 *
 * A trigger propagates endsOn into the derived groupMemberships rows so session
 * access drops the day the term does.
 *
 * G-2.0404 caps aggregate service at six years but allows presbytery exemption,
 * so that rule is a report, not a constraint.
 */
export const officerTerms = pgTable(
  "officer_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // ruling_elder | deacon | clerk_of_session | moderator | treasurer | trustee
    office: text("office").notNull(),
    // The rotating class, e.g. 2028. Boards are divided into classes with one
    // class elected each year.
    classYear: integer("class_year"),
    electedOn: date("elected_on"),
    installedOn: date("installed_on"),
    startsOn: date("starts_on").notNull(),
    // null = open-ended (clerk of session, treasurer)
    endsOn: date("ends_on"),
    endReason: text("end_reason"), // completed | resigned | removed | deceased
    minuteReference: text("minute_reference"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("officer_terms_org_office_idx").on(
      t.organizationId,
      t.office,
      t.startsOn,
      t.endsOn,
    ),
    index("officer_terms_org_person_idx").on(t.organizationId, t.personId),
    unique("officer_terms_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [personProfiles.personId, personProfiles.organizationId],
      name: "officer_terms_person_fk",
    }),
  ],
);
