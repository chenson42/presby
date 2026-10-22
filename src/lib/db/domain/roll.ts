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
  uniqueIndex,
  foreignKey,
  check,
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

    // Self-referential AND composite (B-M3, drizzle/0048 section 7). THE
    // ROLL IS THE SYSTEM OF RECORD, so this is the highest-value of the five
    // composites: a void must cite an action in its own congregation's roll.
    // No lazy thunk is needed — the `(t) => [...]` array below is not invoked
    // until after the module finishes loading, unlike `.references()` on a
    // column, which is evaluated inside the same synchronous pgTable() call.
    voidsActionId: uuid("voids_action_id"),
    // Nullable for the same reason as officer_terms.recorded_by (F24):
    // opening_balance and imported actions predate the platform.
    proposedBy: uuid("proposed_by").references(() => users.id),
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
    // Composite Tenant Keys (F2 / B-M3). DDL: drizzle/0048 section 7.
    foreignKey({
      columns: [t.voidsActionId, t.organizationId],
      // Self-reference via `t`, not `rollActions` — see events.ts's
      // events_parent_fk for why (TS7022 circularity).
      foreignColumns: [t.id, t.organizationId],
      name: "roll_actions_voids_fk",
    }),
    // B-L6: this FK column had no index at all (measured 2026-09-25).
    index("roll_actions_voids_idx").on(t.voidsActionId),

    // drizzle/0061 section 5 (S2): F173 as a database property.
    // resulting_roll equals the kind's mapping (src/lib/roll-action-kinds.ts
    // ROLL_ACTION_KIND_TO_ROLL; a DB test pins the two equal), opening_balance
    // exempt. Mirrors the migration text; the migration is the ground truth.
    check(
      "roll_actions_resulting_roll_matches_kind",
      sql`kind = 'opening_balance'
        or resulting_roll is not distinct from case kind
             when 'profession_of_faith' then 'active'
             when 'reaffirmation' then 'active'
             when 'restoration' then 'active'
             when 'certificate_received' then 'active'
             when 'other_gain' then 'active'
             when 'baptized_member_enrolled' then 'baptized'
             when 'affiliate_received' then 'affiliate'
             when 'other_participant_enrolled' then 'other_participant'
             else null end`,
    ),
    // drizzle/0061 section 5 (S2): a void, and only a void, cites its target.
    check(
      "roll_actions_void_shape",
      sql`(kind = 'void') = (voids_action_id is not null)`,
    ),
    // drizzle/0061 section 5 (S2).
    check(
      "roll_actions_approval_status_allowed",
      sql`approval_status in ('pending', 'approved', 'denied')`,
    ),
    // drizzle/0061 section 5 (S3): one live (pending or approved) void per
    // action; a denied void does not block a later one.
    uniqueIndex("roll_actions_one_live_void_idx")
      .on(t.voidsActionId)
      .where(sql`kind = 'void' and approval_status <> 'denied'`),

    // NOT EXPRESSIBLE HERE (SQL-only, drizzle/0061):
    //   * section 6, policy roll_actions_insert_pending_only: RESTRICTIVE,
    //     FOR INSERT, TO presby_app, WITH CHECK (approval_status = 'pending').
    //     presby_app can insert only pending rows; an approved-at-insert row
    //     comes only from the definer functions below or the owner (R5).
    //   * section 7, presby_record_participant_action() and
    //     presby_void_participant_action(): SECURITY DEFINER, org from
    //     presby_current_org(), the only tenant path to an on-record
    //     (approved-at-insert) participant enrolment, removal or void
    //     (DECISION-198). Called only from src/lib/roll.ts.
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
