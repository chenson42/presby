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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./org";
import { people, memberships, households } from "./people";
import { users } from "../schema";

/**
 * The membership roll. See docs/schema-design.md section D.
 *
 * Four rolls, mutually exclusive, per the Session Annual Statistical Report:
 * active, baptized, affiliate, other participant. The roll is the system of
 * record; the directory is a view of it and the SASR is a projection of it.
 *
 * Gains and losses on the SASR are ACTIVE-roll only. The other three rolls are
 * reported as point-in-time counts, so moving from other-participant to active
 * is one gain and needs no matching loss line.
 */
export const rollActionKind = pgEnum("roll_action_kind", [
  // Establishes state without counting as a gain. Used when a congregation
  // joins the platform mid-life with an official prior-year balance but no
  // history. See F7.
  "opening_balance",

  // Gains to the active roll
  "profession_of_faith",
  "reaffirmation",
  "restoration",
  "certificate_received",
  "other_gain",

  // Enrollment on the other rolls (not active-roll gains)
  "baptized_member_enrolled",
  "affiliate_received",
  "other_participant_enrolled",

  // Losses from the active roll
  "certificate_dismissed",
  "death",
  "removed_by_session",
  "renunciation_of_jurisdiction",
  "other_loss",

  // Removal from the other rolls
  "affiliate_ended",
  "other_participant_removed",

  // Corrections. An approved action is never updated or deleted.
  "void",
]);

export const rollActions = pgTable(
  "roll_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    kind: rollActionKind("kind").notNull(),
    effectiveDate: date("effective_date").notNull(),
    resultingRoll: text("resulting_roll"),

    // Frozen at record time. Birthdates are often unknown or later corrected,
    // and the SASR profession-of-faith split at 17/18 must not shift
    // retroactively once a year is reported.
    ageAtAction: integer("age_at_action"),

    // Approval (D3). Rows in `pending` are mutable working state; a trigger
    // freezes the row on approval. Invariant 4 covers approved rows only.
    approvalStatus: text("approval_status").notNull().default("pending"),
    // Free text until the meetings module lands, then an FK to docket_items.
    minuteReference: text("minute_reference"),
    approvedOn: date("approved_on"),
    approvedBy: uuid("approved_by").references(() => users.id),
    denialReason: text("denial_reason"),

    voidsActionId: uuid("voids_action_id").references(
      (): AnyPgColumn => rollActions.id,
    ),
    proposedBy: uuid("proposed_by")
      .notNull()
      .references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("roll_actions_org_person_idx").on(
      t.organizationId,
      t.personId,
      t.effectiveDate,
    ),
    // The clerk's session-agenda worklist, and the seam the future meetings
    // module plugs into.
    index("roll_actions_pending_idx")
      .on(t.organizationId, t.effectiveDate)
      .where(sql`approval_status = 'pending'`),
    index("roll_actions_reporting_idx")
      .on(t.organizationId, t.effectiveDate, t.kind)
      .where(sql`approval_status = 'approved'`),
    unique("roll_actions_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "roll_actions_person_fk",
    }),
  ],
);

/**
 * Two-sided transfers (F9). Neither congregation can write into the other, so a
 * certificate of transfer is issued by the losing church and claimed by the
 * receiving one — which is how certificates actually work.
 *
 * Off-platform churches simply never claim, and the certificate expires.
 *
 * Simplified by the D1 reversal. With global `people` a transfer no longer
 * creates a second person row to reconcile: the human is already the same row,
 * so claiming a certificate just adds a person_profile at the receiving org.
 * issuingPersonId therefore points at global `people`, not at a profile — the
 * receiving org has no profile until it claims.
 *
 * The dismissal/reception action pair IS the linkage; person_links is gone.
 */
export const transferCertificates = pgTable(
  "transfer_certificates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issuingOrgId: uuid("issuing_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    issuingPersonId: uuid("issuing_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    // Optional grouping so a family transfers as a unit rather than as five
    // unrelated certificates the receiving church rebuilds by hand. See F20.
    issuingHouseholdId: uuid("issuing_household_id").references(
      () => households.id,
    ),
    receivingOrgId: uuid("receiving_org_id").references(() => organizations.id),
    claimToken: text("claim_token").notNull().unique(),
    // Minimal disclosure before the certificate is claimed.
    memberName: text("member_name").notNull(),
    issuedOn: date("issued_on").notNull(),
    expiresOn: date("expires_on"),
    dismissalActionId: uuid("dismissal_action_id").references(
      () => rollActions.id,
    ),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    receptionActionId: uuid("reception_action_id").references(
      () => rollActions.id,
    ),
    status: text("status").notNull().default("issued"),
  },
  (t) => [
    index("transfer_certificates_issuing_idx").on(t.issuingOrgId, t.status),
    index("transfer_certificates_receiving_idx").on(t.receivingOrgId, t.status),
  ],
);
