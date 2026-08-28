import {
  pgTable,
  text,
  uuid,
  date,
  timestamp,
  index,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { memberships } from "./people";
import { users } from "../schema";

/**
 * Staff and personnel: paid, non-ordained roles across congregation and
 * presbytery (docs/work-log/2026-08-27-staff-and-personnel.md / DECISION-128
 * / DECISION-129).
 *
 * DELIBERATELY ORTHOGONAL to officers.ts's ecclesiastical register — a
 * bookkeeper, custodian, or part-time secretary is a personnel-administration
 * fact, not a "who holds what constitutional office" fact. No FK coupling to
 * ordinations/officerTerms/appointments; a unified "everyone who serves here"
 * view is a read-time union, never a schema join.
 *
 * The presence of a row here IS the "this is paid" signal — no `isPaid`
 * boolean. An unpaid volunteer choir director belongs in groups/
 * groupMemberships instead. Grants nothing by itself, same discipline
 * officerTerms.office already established: `position`/`title` are open, free-
 * text values (church staff titles are an open list, unlike the six-value
 * constitutional office vocabulary D8 governs), never role_grants/app_roles
 * data.
 */
export const staffPositions = pgTable(
  "staff_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // The employer. No aboutOrg/servingOrg split (unlike appointments) —
    // employment carries no constitutional-membership entanglement the way a
    // minister's call does, so organizationId alone is sufficient for both
    // congregation and presbytery employers.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // Free text — church staff titles are an open list (D8 governs
    // tenant-defined SCHEMA, not an open string column; this is the
    // identical shape officer_terms.office already ships under an F22 GIST
    // exclusion). Display value, preserves the caller's casing.
    position: text("position").notNull(),
    // position.trim().toLowerCase(), computed in application code before
    // every insert — the GIST exclusion's actual equality column, so
    // "Secretary" and "secretary" collide as the same open term (architect's
    // Phase 2 normalization flag). Never rendered; never independently
    // editable — the same immutability `position` itself has (no update
    // path, only end + start-new, mirroring officerTerms).
    positionKey: text("position_key").notNull(),
    department: text("department"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"), // null = open-ended
    endReason: text("end_reason"),
    minuteReference: text("minute_reference"),
    // Nullable — same F24 reasoning as officerTerms.recordedBy: an imported
    // historical position has no acting user to attribute it to.
    recordedBy: uuid("recorded_by").references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("staff_positions_org_person_idx").on(t.organizationId, t.personId),
    index("staff_positions_org_position_idx").on(
      t.organizationId,
      t.positionKey,
      t.startsOn,
      t.endsOn,
    ),
    unique("staff_positions_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "staff_positions_person_fk",
    }),
  ],
);
