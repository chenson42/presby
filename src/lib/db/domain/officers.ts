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
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, orgUnits } from "./org";
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

/**
 * Ministry credentials & pastoral appointments (docs/work-log/
 * 2026-08-26-presbytery-functionality.md, Increment 2 / DECISION-112 /
 * DECISION-116). Distinct from `endedOn`/`endedReason` below: those model
 * TRUE removal from ordered ministry (rare); `status` models everything
 * short of that — a retired or on-leave minister is still ordained.
 * Values adapted verbatim from psvonline-portal's `credentialStatusEnum`
 * (proven prior art, no reason to diverge).
 */
export const credentialStatus = pgEnum("credential_status", [
  "active",
  "honorably_retired",
  "on_leave",
  "exempt_from_active_service",
  "disciplined",
  "removed",
  "deceased",
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
    status: credentialStatus("status").notNull().default("active"),
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
    // Portal home + directory v2, Increment 4 (docs/work-log/
    // 2026-08-24-portal-home-directory.md, Phase 2/3): a household's deacon is
    // a pure DERIVATION from this column, never a hand-editable FK on
    // households/orgUnits (Phase 2 rejected exactly that shape — it repeats
    // F15's shepherd_person_id mistake). Nullable: only district-scoped
    // offices (today, only 'deacon') set it; every other office leaves it
    // null. Composite FK mirrors memberships.orgUnitId's existing pattern
    // (F2) — see the CHECK below binding this to office = 'deacon'.
    orgUnitId: uuid("org_unit_id"),
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
    // Serves "the active deacon for org_unit X" — getParishRoster()'s and
    // DeaconCard's derivation query (Increment 4).
    index("officer_terms_org_unit_idx").on(
      t.organizationId,
      t.orgUnitId,
      t.office,
      t.startsOn,
      t.endsOn,
    ),
    unique("officer_terms_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "officer_terms_person_fk",
    }),
    foreignKey({
      columns: [t.orgUnitId, t.organizationId],
      foreignColumns: [orgUnits.id, orgUnits.organizationId],
      name: "officer_terms_org_unit_fk",
    }),
    check(
      "officer_terms_org_unit_deacon_check",
      sql`${t.orgUnitId} is null or ${t.office} = 'deacon'`,
    ),
  ],
);

/**
 * Pastoral appointments (docs/work-log/2026-08-26-presbytery-functionality.md,
 * Increment 2 / DECISION-112). The third "who serves in what capacity" shape
 * in this file, after ordinations (an event) and officerTerms (a session/
 * diaconate term). A pastoral call is an ecclesiastical office, not a
 * software permission — deliberately NOT expressed through role_grants/
 * app_roles (the same clerk_of_session-stays-a-data-value conflation the
 * officers pipeline already refused) and NOT through officerTerms (its
 * derived-court-roster trigger semantics don't apply to a pastoral call).
 *
 * OWNED BY THE PRESBYTERY, forced structurally rather than chosen
 * stylistically: the composite person FK (personId, organizationId ->
 * memberships) that F2-safety requires can only resolve at the presbytery,
 * since a minister's membership is at the presbytery per D1 — exactly like
 * ordinations' own FK. servingOrgId references organizations directly (a
 * plain FK is legal here: organizations is the one cross-tenant-readable
 * structural table, schema-design.md section 17).
 *
 * The congregation-side read of an appointment recorded about it is
 * explicitly NOT built by this table alone (DECISION-112) — deferred to a
 * future publication mechanism, not solved with a bespoke cross-org RLS
 * policy. No DB-level overlap-exclusion constraint (unlike
 * officer_terms_no_overlap): a pastoral call carries none of the quorum/
 * minute-validity stakes that justified the GIST exclusion there, so an
 * app-level check-before-insert is proportionate (same reasoning
 * DECISION-110 accepted for group_memberships).
 */
export const appointmentCallType = pgEnum("appointment_call_type", [
  "installed_pastor",
  "designated_pastor",
  "stated_supply",
  "interim_pastor",
  "temporary_supply",
  "parish_associate",
]);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // The PRESBYTERY, forced (D1/F2) — never the serving congregation.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // Plain FK — organizations is the one cross-tenant-readable structural
    // table (section 17). Validated at the application layer to be an
    // actual member congregation of this presbytery (parentId +
    // organizationType check) before insert; the DB does not enforce that
    // relationship itself.
    servingOrgId: uuid("serving_org_id")
      .notNull()
      .references(() => organizations.id),
    callType: appointmentCallType("call_type").notNull(),
    startsOn: date("starts_on").notNull(),
    // null = current/open-ended appointment.
    endsOn: date("ends_on"),
    endReason: text("end_reason"),
    minuteReference: text("minute_reference"),
    // Nullable: same F24 reasoning as officerTerms.recordedBy — an imported
    // historical appointment has no acting user to attribute it to.
    recordedBy: uuid("recorded_by").references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("appointments_org_person_idx").on(t.organizationId, t.personId),
    index("appointments_serving_org_idx").on(
      t.servingOrgId,
      t.startsOn,
      t.endsOn,
    ),
    unique("appointments_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "appointments_person_fk",
    }),
  ],
);
