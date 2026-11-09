import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  smallint,
  integer,
  date,
  time,
  timestamp,
  index,
  unique,
  uniqueIndex,
  check,
  foreignKey,
  primaryKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { memberships } from "./people";
import { groups } from "./groups";
import { events } from "./events";
import { users } from "../schema";

/**
 * Worship, Increment 1: teams, positions and the Sunday schedule
 * (docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "Data Model";
 * DECISION-317 to 327). Re-exported from ./index.ts at integration (Rule 16).
 *
 * This file is for TypeScript's benefit. The ground truth is
 * drizzle/0085_presby_worship.sql, and most of what makes these tables safe is
 * NOT expressible in the table builder:
 *
 *   - ENABLE + FORCE ROW LEVEL SECURITY and `tenant_isolation` on all nine
 *     (0085 section 8; F1).
 *   - Column-limited `presby_app` grants and NO DELETE anywhere (0085
 *     section 8). `presby_platform` holds nothing (Two Hierarchies). The
 *     grant lists are restated beside each table below. Trigger-owned and in
 *     no grant: `requestedAt`, `respondedAt`, `withdrawnAt`,
 *     `unansweredRemindedAt`, `remindedAt`, `updatedAt`, `createdAt`. Never
 *     `.set()` them, and never give `updatedAt` a Drizzle `$onUpdate` (it
 *     would put the column in the SET list and presby_app would be refused).
 *   - The guards (0085 section 7), all SECURITY INVOKER, all binding the
 *     OWNER connection too (F44: getPlatformDb() is neondb_owner):
 *       * `presby_worship_guard_immutable` on the eight tables other than
 *         assignments: only the listed columns change; `retiredAt` /
 *         `endedAt` are set once; `removedAt` is settable and clearable.
 *       * `worship_teams_guard_insert`: a managed `choir` or `team` group only.
 *       * `worship_positions_guard_insert`: the team is not retired.
 *       * `worship_service_teams_guard_insert` / `_guard_readd`: the team is
 *         not retired and the service is not cancelled (also when a removed
 *         team is re-added).
 *       * `worship_blockouts_guard_insert`: not ending before the org's
 *         today; at most 50 live per person (advisory lock).
 *       * `worship_assignments_guard_insert` / `_guard_update`: the state
 *         machine and the actor checks (section 7n, 7o; mirrored by
 *         src/lib/worship/states.ts). Refusals are `check_violation` (23514)
 *         with a `worship: ` message and the CONSTRAINT field set to one of
 *         WORSHIP_GUARD_CODES below; delete refusals are
 *         `insufficient_privilege` (42501). The actor check calls the
 *         permission resolver, which answers only for the CURRENT org
 *         (drizzle/0010): an owner-path writer (seed, e2e fixture) must set
 *         `app.current_org_id` in its transaction or it fails closed with
 *         42501 (0085 header, "OWNER-PATH CONTRACT").
 *       * `<table>_guard_delete` on all nine: only the fixture-teardown
 *         cascade gets through.
 *   - Functions (0085 section 7): `presby_worship_org_today` and
 *     `presby_worship_org_now` (the SERVICE day and clock: blockouts, events),
 *     `presby_worship_in_effect_day` (greatest(organization day, UTC day):
 *     every comparison against a `role_grants` or `group_memberships` date,
 *     F434, DECISION-328), `presby_worship_enabled` (the toggle in
 *     SQL), `presby_worship_leads_team` (the seat), `presby_worship_may_schedule`,
 *     `presby_worship_open_count`, and the owner-only
 *     `presby_worship_claim_reminders`.
 *   - Three partial unique indexes on lower(name) / live rows: declared
 *     below with the expression they index.
 *
 * Every FK between tenant tables is composite on organization_id (F2),
 * NO ACTION. Two are three-column (R5): an assignment's position must belong
 * to its team, and its team must be serving its service.
 */

export const WORSHIP_ASSIGNMENT_STATUSES = [
  "draft",
  "requested",
  "confirmed",
  "declined",
  "withdrawn",
] as const;
export type WorshipAssignmentStatus = (typeof WORSHIP_ASSIGNMENT_STATUSES)[number];

/** The closed reason list for a decline and for a blockout (R12, F425). */
export const WORSHIP_REASONS = ["away", "work", "family", "other"] as const;
export type WorshipReason = (typeof WORSHIP_REASONS)[number];

/** `link` is refused by the guard until Increment 1b. */
export const WORSHIP_RESPONSE_SOURCES = ["self", "on_behalf", "link"] as const;
export type WorshipResponseSource = (typeof WORSHIP_RESPONSE_SOURCES)[number];

export const WORSHIP_NOTICE_OUTCOMES = [
  "emailed",
  "guardian",
  "no_address",
  "do_not_contact",
] as const;
export type WorshipNoticeOutcome = (typeof WORSHIP_NOTICE_OUTCOMES)[number];

export const WORSHIP_WITHDRAWN_REASONS = ["removed", "service_cancelled"] as const;
export type WorshipWithdrawnReason = (typeof WORSHIP_WITHDRAWN_REASONS)[number];

/**
 * The CONSTRAINT field a worship guard sets on its `check_violation` (0085
 * section 7). The store maps these; `worship.db.test.ts` pins that every one
 * appears in the migration.
 */
export const WORSHIP_GUARD_CODES = [
  "worship_guard_immutable",
  "worship_guard_set_once",
  "worship_guard_terminal",
  "worship_guard_illegal_transition",
  "worship_guard_not_authorized",
  "worship_guard_guest_shape",
  "worship_guard_link_not_accepted",
  "worship_guard_service_cancelled",
  "worship_guard_service_started",
  "worship_guard_service_team_removed",
  "worship_guard_team_not_eligible",
  "worship_guard_team_retired",
  "worship_guard_position_retired",
  "worship_guard_not_on_roster",
  "worship_guard_blockout_past",
  "worship_guard_blockout_cap",
] as const;
export type WorshipGuardCode = (typeof WORSHIP_GUARD_CODES)[number];

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * A worship team: a 1:1 extension of a MANAGED choir or team group.
 * presby_app INSERT: groupId, organizationId, createdBy. UPDATE: retiredAt.
 */
export const worshipTeams = pgTable(
  "worship_teams",
  {
    groupId: uuid("group_id").primaryKey(),
    // Cascade reachable only through D10's guarded fixture teardown.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Set once (guard).
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    unique("worship_teams_group_org_key").on(t.groupId, t.organizationId),
    foreignKey({
      columns: [t.groupId, t.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
      name: "worship_teams_group_fk",
    }),
    index("worship_teams_org_live_ix")
      .on(t.organizationId)
      .where(sql`${t.retiredAt} is null`),
  ],
);

/**
 * A position on a team. presby_app INSERT: organizationId, groupId, name,
 * slots, sortOrder, createdBy. UPDATE: name, slots, sortOrder, retiredAt.
 */
export const worshipPositions = pgTable(
  "worship_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").notNull(),
    name: text("name").notNull(),
    slots: smallint("slots").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    // Set once (guard).
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("worship_positions_id_org_key").on(t.id, t.organizationId),
    // The three-column FK target (R5).
    unique("worship_positions_id_team_org_key").on(t.id, t.groupId, t.organizationId),
    foreignKey({
      columns: [t.groupId, t.organizationId],
      foreignColumns: [worshipTeams.groupId, worshipTeams.organizationId],
      name: "worship_positions_team_fk",
    }),
    check(
      "worship_positions_name_shape",
      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 60`,
    ),
    check("worship_positions_slots_range", sql`${t.slots} between 1 and 20`),
    uniqueIndex("worship_positions_live_name_idx")
      .on(t.organizationId, t.groupId, sql`lower(${t.name})`)
      .where(sql`${t.retiredAt} is null`),
    index("worship_positions_team_sort_ix").on(t.organizationId, t.groupId, t.sortOrder),
  ],
);

/**
 * Who can fill which position. presby_app INSERT: organizationId, groupId,
 * positionId, personId, createdBy. UPDATE: endedAt (set once).
 */
export const worshipPositionQualifications = pgTable(
  "worship_position_qualifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").notNull(),
    positionId: uuid("position_id").notNull(),
    personId: uuid("person_id").notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("worship_position_qualifications_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.positionId, t.groupId, t.organizationId],
      foreignColumns: [worshipPositions.id, worshipPositions.groupId, worshipPositions.organizationId],
      name: "worship_position_qualifications_position_fk",
    }),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "worship_position_qualifications_person_fk",
    }),
    uniqueIndex("worship_position_qualifications_live_idx")
      .on(t.positionId, t.personId)
      .where(sql`${t.endedAt} is null`),
    index("worship_position_qualifications_person_ix")
      .on(t.organizationId, t.personId)
      .where(sql`${t.endedAt} is null`),
  ],
);

/**
 * A kind of service (the recurring blueprint). presby_app INSERT:
 * organizationId, name, startTime, durationMinutes, location, createdBy.
 * UPDATE: name, startTime, durationMinutes, location, retiredAt.
 */
export const worshipServiceTypes = pgTable(
  "worship_service_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Wall clock, "HH:MM:SS".
    startTime: time("start_time").notNull(),
    durationMinutes: integer("duration_minutes"),
    location: text("location"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("worship_service_types_id_org_key").on(t.id, t.organizationId),
    check(
      "worship_service_types_name_shape",
      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 80`,
    ),
    check(
      "worship_service_types_duration_range",
      sql`${t.durationMinutes} is null or ${t.durationMinutes} between 15 and 480`,
    ),
    check(
      "worship_service_types_location_length",
      sql`${t.location} is null or char_length(${t.location}) <= 200`,
    ),
    uniqueIndex("worship_service_types_live_name_idx")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.retiredAt} is null`),
  ],
);

/**
 * The teams that usually serve a type. presby_app INSERT: organizationId,
 * serviceTypeId, groupId. UPDATE: removedAt (settable and clearable).
 */
export const worshipServiceTypeTeams = pgTable(
  "worship_service_type_teams",
  {
    serviceTypeId: uuid("service_type_id").notNull(),
    groupId: uuid("group_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "worship_service_type_teams_pkey", columns: [t.serviceTypeId, t.groupId] }),
    foreignKey({
      columns: [t.serviceTypeId, t.organizationId],
      foreignColumns: [worshipServiceTypes.id, worshipServiceTypes.organizationId],
      name: "worship_service_type_teams_type_fk",
    }),
    foreignKey({
      columns: [t.groupId, t.organizationId],
      foreignColumns: [worshipTeams.groupId, worshipTeams.organizationId],
      name: "worship_service_type_teams_team_fk",
    }),
  ],
);

/**
 * A worship service: a 1:1 extension of an events row (R2). presby_app
 * INSERT: eventId, organizationId, serviceTypeId, updatedBy. UPDATE:
 * updatedBy. `updatedAt` is trigger-owned. Residual S2 (`paper`): the
 * database does not stop this row being attached to an existing event;
 * src/lib/worship/store.ts is the sole inserter.
 */
export const worshipServices = pgTable(
  "worship_services",
  {
    eventId: uuid("event_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    serviceTypeId: uuid("service_type_id"),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // TRIGGER-OWNED. Deliberately no $onUpdate (see the header).
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("worship_services_event_org_key").on(t.eventId, t.organizationId),
    // NO ACTION, never cascade (R2; F253 narrowed for these rows).
    foreignKey({
      columns: [t.eventId, t.organizationId],
      foreignColumns: [events.id, events.organizationId],
      name: "worship_services_event_fk",
    }),
    foreignKey({
      columns: [t.serviceTypeId, t.organizationId],
      foreignColumns: [worshipServiceTypes.id, worshipServiceTypes.organizationId],
      name: "worship_services_type_fk",
    }),
  ],
);

/**
 * The teams serving one service. presby_app INSERT: organizationId, eventId,
 * groupId. UPDATE: removedAt (settable and clearable; clearing re-runs the
 * insert guard).
 */
export const worshipServiceTeams = pgTable(
  "worship_service_teams",
  {
    eventId: uuid("event_id").notNull(),
    groupId: uuid("group_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "worship_service_teams_pkey", columns: [t.eventId, t.groupId] }),
    // The three-column FK target (R5).
    unique("worship_service_teams_event_team_org_key").on(t.eventId, t.groupId, t.organizationId),
    foreignKey({
      columns: [t.eventId, t.organizationId],
      foreignColumns: [worshipServices.eventId, worshipServices.organizationId],
      name: "worship_service_teams_service_fk",
    }),
    foreignKey({
      columns: [t.groupId, t.organizationId],
      foreignColumns: [worshipTeams.groupId, worshipTeams.organizationId],
      name: "worship_service_teams_team_fk",
    }),
    index("worship_service_teams_team_ix").on(t.organizationId, t.groupId),
  ],
);

/**
 * A person (or a guest, by name only) in a position on a service. The state
 * machine and every actor check are in the trigger (0085 section 7n/7o).
 *
 * presby_app INSERT: organizationId, eventId, groupId, positionId, personId,
 * guestName, assignedByPersonId, status, respondedByPersonId, responseSource,
 * declineReason. UPDATE: status, sentByPersonId, noticeOutcome,
 * respondedByPersonId, responseSource, declineReason, withdrawnByPersonId,
 * withdrawnReason. Everything else is trigger-owned or immutable.
 */
export const worshipAssignments = pgTable(
  "worship_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    groupId: uuid("group_id").notNull(),
    positionId: uuid("position_id").notNull(),
    personId: uuid("person_id"),
    // Display only; no contact columns (Q11).
    guestName: text("guest_name"),
    status: text("status").$type<WorshipAssignmentStatus>().notNull().default("draft"),
    assignedByPersonId: uuid("assigned_by_person_id").notNull(),
    sentByPersonId: uuid("sent_by_person_id"),
    // TRIGGER-OWNED: stamped by draft -> requested.
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    noticeOutcome: text("notice_outcome").$type<WorshipNoticeOutcome>(),
    respondedByPersonId: uuid("responded_by_person_id"),
    responseSource: text("response_source").$type<WorshipResponseSource>(),
    // TRIGGER-OWNED: stamped by every answer.
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    declineReason: text("decline_reason").$type<WorshipReason>(),
    withdrawnByPersonId: uuid("withdrawn_by_person_id"),
    withdrawnReason: text("withdrawn_reason").$type<WorshipWithdrawnReason>(),
    // TRIGGER-OWNED: stamped by the move to withdrawn.
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    // Set once, by presby_worship_claim_reminders only (owner path).
    unansweredRemindedAt: timestamp("unanswered_reminded_at", { withTimezone: true }),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // TRIGGER-OWNED. Deliberately no $onUpdate (see the header).
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("worship_assignments_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.eventId, t.groupId, t.organizationId],
      foreignColumns: [
        worshipServiceTeams.eventId,
        worshipServiceTeams.groupId,
        worshipServiceTeams.organizationId,
      ],
      name: "worship_assignments_service_team_fk",
    }),
    foreignKey({
      columns: [t.positionId, t.groupId, t.organizationId],
      foreignColumns: [worshipPositions.id, worshipPositions.groupId, worshipPositions.organizationId],
      name: "worship_assignments_position_fk",
    }),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "worship_assignments_person_fk",
    }),
    foreignKey({
      columns: [t.assignedByPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "worship_assignments_assigned_by_fk",
    }),
    foreignKey({
      columns: [t.sentByPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "worship_assignments_sent_by_fk",
    }),
    foreignKey({
      columns: [t.respondedByPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "worship_assignments_responded_by_fk",
    }),
    foreignKey({
      columns: [t.withdrawnByPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "worship_assignments_withdrawn_by_fk",
    }),
    check("worship_assignments_one_assignee", sql`num_nonnulls(${t.personId}, ${t.guestName}) = 1`),
    check(
      "worship_assignments_guest_name_shape",
      sql`${t.guestName} is null
        or (${t.guestName} = btrim(${t.guestName})
            and char_length(${t.guestName}) between 1 and 80
            and ${t.guestName} !~ '[[:cntrl:]]')`,
    ),
    check(
      "worship_assignments_status_allowed",
      sql`${t.status} in (${sqlList(WORSHIP_ASSIGNMENT_STATUSES)})`,
    ),
    check(
      "worship_assignments_guest_status",
      sql`${t.guestName} is null or ${t.status} in ('confirmed', 'withdrawn')`,
    ),
    check(
      "worship_assignments_response_source_allowed",
      sql`${t.responseSource} is null or ${t.responseSource} in (${sqlList(WORSHIP_RESPONSE_SOURCES)})`,
    ),
    check(
      "worship_assignments_response_shape",
      sql`(${t.responseSource} is null) = (${t.respondedAt} is null)
        and (${t.respondedAt} is null) = (${t.respondedByPersonId} is null)`,
    ),
    check(
      "worship_assignments_decline_reason_allowed",
      sql`${t.declineReason} is null or ${t.declineReason} in (${sqlList(WORSHIP_REASONS)})`,
    ),
    check(
      "worship_assignments_decline_reason_shape",
      sql`${t.declineReason} is null or ${t.status} in ('declined', 'withdrawn')`,
    ),
    check(
      "worship_assignments_notice_outcome_allowed",
      sql`${t.noticeOutcome} is null or ${t.noticeOutcome} in (${sqlList(WORSHIP_NOTICE_OUTCOMES)})`,
    ),
    check(
      "worship_assignments_sent_shape",
      sql`(${t.sentByPersonId} is null) = (${t.requestedAt} is null)
        and (${t.requestedAt} is null) = (${t.noticeOutcome} is null)
        and (${t.status} <> 'requested' or ${t.requestedAt} is not null)`,
    ),
    check(
      "worship_assignments_withdrawn_reason_allowed",
      sql`${t.withdrawnReason} is null or ${t.withdrawnReason} in (${sqlList(WORSHIP_WITHDRAWN_REASONS)})`,
    ),
    check(
      "worship_assignments_withdrawn_shape",
      sql`(${t.status} = 'withdrawn') = (${t.withdrawnAt} is not null)
        and (${t.withdrawnAt} is null) = (${t.withdrawnReason} is null)`,
    ),
    check(
      "worship_assignments_withdrawn_actor_shape",
      sql`(${t.withdrawnByPersonId} is null and (${t.withdrawnReason} is null or ${t.withdrawnReason} = 'service_cancelled'))
        or (${t.withdrawnByPersonId} is not null and ${t.withdrawnReason} = 'removed')`,
    ),
    uniqueIndex("worship_assignments_live_person_idx")
      .on(t.eventId, t.positionId, t.personId)
      .where(sql`${t.personId} is not null and ${t.status} <> 'withdrawn'`),
    index("worship_assignments_person_ix")
      .on(t.organizationId, t.personId, t.eventId)
      .where(sql`${t.personId} is not null and ${t.status} <> 'withdrawn'`),
    index("worship_assignments_board_ix").on(t.organizationId, t.eventId, t.groupId),
    index("worship_assignments_open_ix")
      .on(t.organizationId, t.status)
      .where(sql`${t.status} in ('requested', 'confirmed') and ${t.personId} is not null`),
  ],
);

/**
 * A person's "dates I can't serve" at one organization. NO free-text column
 * (R12). presby_app INSERT: organizationId, personId, startsOn, endsOn,
 * reason. UPDATE: endedAt (set once).
 */
export const worshipBlockouts = pgTable(
  "worship_blockouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // YYYY-MM-DD, inclusive.
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    reason: text("reason").$type<WorshipReason>(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("worship_blockouts_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "worship_blockouts_person_fk",
    }),
    check("worship_blockouts_range_order", sql`${t.endsOn} >= ${t.startsOn}`),
    check("worship_blockouts_range_length", sql`${t.endsOn} - ${t.startsOn} <= 365`),
    check(
      "worship_blockouts_reason_allowed",
      sql`${t.reason} is null or ${t.reason} in (${sqlList(WORSHIP_REASONS)})`,
    ),
    index("worship_blockouts_person_ix")
      .on(t.organizationId, t.personId)
      .where(sql`${t.endedAt} is null`),
  ],
);
