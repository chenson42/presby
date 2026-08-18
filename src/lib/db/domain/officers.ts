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
import { memberships } from "./people";
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
      foreignColumns: [memberships.personId, memberships.organizationId],
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
    // Display label only, e.g. "class of 2028". Boards are divided into three
    // classes with one elected each year, and nominating committees plan by
    // class, so churches want to see it. But DATES ARE AUTHORITATIVE: every
    // query, the derived roster, the permission resolver, and the register all
    // read startsOn/endsOn. A class is normally just the year endsOn falls in,
    // and it is null for open-ended offices like clerk of session.
    classYear: integer("class_year"),
    electedOn: date("elected_on"),
    installedOn: date("installed_on"),
    startsOn: date("starts_on").notNull(),
    // null = open-ended (clerk of session, treasurer)
    endsOn: date("ends_on"),
    endReason: text("end_reason"), // completed | resigned | removed | deceased
    minuteReference: text("minute_reference"),
    // Nullable: imported historical terms have no acting user (F24). A church
    // arriving with twenty years of session history cannot invent one, and
    // requiring it would push importers to attribute records to a fake account.
    recordedBy: uuid("recorded_by").references(() => users.id),
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
    // Supports the historical roster query: who was on session on a given date.
    index("officer_terms_roster_idx").on(
      t.organizationId,
      t.office,
      t.startsOn,
    ),
    unique("officer_terms_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "officer_terms_person_fk",
    }),
  ],
);
