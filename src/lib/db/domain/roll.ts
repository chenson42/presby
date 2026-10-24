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

    // Approval (D3). pending | approved | denied | withdrawn (drizzle/0062).
    // A trigger freezes approved rows (Invariant 4) and, since drizzle/0062
    // (R8), denied and withdrawn rows too. Pending rows are mutable only on
    // the owner connection: presby_app holds no UPDATE or DELETE after
    // drizzle/0063, and every decision goes through a definer.
    approvalStatus: text("approval_status").notNull().default("pending"),
    // Free text until the meetings module lands, then an FK to docket_items.
    minuteReference: text("minute_reference"),
    approvedOn: date("approved_on"),
    approvedBy: uuid("approved_by").references(() => users.id),
    denialReason: text("denial_reason"),
    // drizzle/0062 section 2 (R5): one generic actor pair for every terminal
    // transition (approved, denied, withdrawn), set by
    // presby_decide_roll_action / presby_withdraw_roll_action. Null on rows
    // decided before 0062 (approved rows are frozen, so never backfilled);
    // readers use coalesce(decided_by, approved_by) and
    // coalesce(decided_at, approved_on::timestamptz).
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // drizzle/0062: required (1-500 characters) when the proposer withdraws.
    // Free text about a person; returned only to roll.propose / roll.approve
    // holders (DECISION-204).
    withdrawalReason: text("withdrawal_reason"),

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
    // drizzle/0061 section 5 (S2), widened by drizzle/0062 section 3.
    check(
      "roll_actions_approval_status_allowed",
      sql`approval_status in ('pending', 'approved', 'denied', 'withdrawn')`,
    ),
    // drizzle/0062 section 3 (R5): each reason exists only in its own state.
    check(
      "roll_actions_denial_reason_only_when_denied",
      sql`denial_reason is null or approval_status = 'denied'`,
    ),
    check(
      "roll_actions_withdrawal_reason_only_when_withdrawn",
      sql`withdrawal_reason is null or approval_status = 'withdrawn'`,
    ),
    // drizzle/0063 section 2 (R5): denied and withdrawn rows carry both
    // stamps. Lands in 0063, after the code deploy, because the
    // pre-Increment-2 deny UPDATE sets neither (Phase 3 refinement 2).
    check(
      "roll_actions_terminal_decision_stamps",
      sql`approval_status not in ('denied', 'withdrawn')
        or (decided_by is not null and decided_at is not null)`,
    ),
    // drizzle/0061 section 5 (S3), re-predicated by drizzle/0062 section 3:
    // one live (pending or approved) void per action; a denied or withdrawn
    // void does not block a later one.
    uniqueIndex("roll_actions_one_live_void_idx")
      .on(t.voidsActionId)
      .where(sql`kind = 'void' and approval_status in ('pending', 'approved')`),
    // drizzle/0062 section 4 (R7): one pending proposal per person per
    // organization.
    uniqueIndex("roll_actions_one_pending_per_person_idx")
      .on(t.organizationId, t.personId)
      .where(sql`approval_status = 'pending'`),

    // NOT EXPRESSIBLE HERE (SQL-only):
    //   * policy roll_actions_insert_pending_only (drizzle/0061 section 6,
    //     narrowed by drizzle/0063 section 4): RESTRICTIVE, FOR INSERT, TO
    //     presby_app, WITH CHECK (approval_status = 'pending' AND kind is
    //     one of the seven approvable gain kinds). An approved-at-insert row
    //     comes only from the participant definers or the owner (R5, F191).
    //   * drizzle/0063 section 3: presby_app (and presby_platform) hold no
    //     UPDATE or DELETE on this table; SELECT and INSERT only.
    //   * trigger roll_actions_freeze, presby_freeze_approved_roll_action()
    //     (drizzle/0062 section 5): approved, denied and withdrawn rows are
    //     immutable, on the owner path too.
    //   * drizzle/0061 section 7, presby_record_participant_action() and
    //     presby_void_participant_action(): SECURITY DEFINER, org from
    //     presby_current_org(), the only tenant path to an on-record
    //     (approved-at-insert) participant enrolment, removal or void
    //     (DECISION-198). Called only from src/lib/roll.ts.
    //   * drizzle/0062 section 9, presby_decide_roll_action() and
    //     presby_withdraw_roll_action(): SECURITY DEFINER, org from
    //     presby_current_org(), the only tenant path out of pending
    //     (approve, deny, withdraw; DECISION-203). Called only from
    //     src/lib/roll.ts.
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
