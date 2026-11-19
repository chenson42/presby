import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  date,
  timestamp,
  check,
  unique,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { groups } from "./groups";
import { memberships } from "./people";
import { users } from "../schema";

/**
 * Presbytery committees and administrative commission records
 * (docs/work-log/2026-11-19-presbytery-committees.md, Phase 2 R2/R3 and
 * Phase 3 "Data Model"; DECISION-353, 355, 357, 358). DDL is hand-written in
 * drizzle/0090_presby_committees.sql; this file is for TypeScript's benefit
 * and the migration is the ground truth.
 *
 * Every row is THE PRESBYTERY'S OWN RECORD (`organizationId` is the
 * presbytery). The key (`groups.manage`, tier 1) is checked in TypeScript
 * inside each reader's and writer's own `withOrgContext()` transaction; RLS
 * is tenancy only.
 *
 *   - committeeDetails: 1:1 with a managed `committee` group at a
 *     presbytery, carrying its label (`kind`; null or no row = "Not yet
 *     labelled") and its one-way dissolved state. Not columns on `groups`
 *     (DECISION-353).
 *   - commissionRecords / commissionRecordMembers: the presbytery's record of
 *     an administrative commission and who serves on it. NOT A GRANT: there
 *     is no role_id, no group_id and no public_listed column on either table
 *     (0090 section 7 asserts it; committees.schema.test.ts pins this mirror
 *     the same way), so nothing can grant through a commission record and
 *     nothing can list its members publicly (DECISION-355). Written from
 *     Increment 2.
 *
 * Writer: src/lib/committees/store.ts. Readers: src/lib/committees/reads.ts.
 * Seats themselves stay in group_memberships, written only through
 * src/lib/groups.ts (DECISION-352).
 *
 * What the table builder below cannot express, and where it is enforced:
 *   - FORCE ROW LEVEL SECURITY and the organization-only tenant_isolation
 *     policy on all three (0090 section 4): the congregation a commission
 *     record is about reads zero rows;
 *   - the grant shape: presby_app SELECT, INSERT and a column-limited UPDATE,
 *     NO DELETE (all deletes are soft); presby_platform nothing (section 4);
 *   - committee_details attaches only to a managed `committee` group of a
 *     presbytery in its own organization, its identity columns never move, a
 *     non-owner insert starts undissolved, and a dissolved row never changes
 *     again, on EVERY connection including the owner (F44):
 *     `committee_details_guard` -> presby_committee_details_guard() (0090
 *     section 2);
 *   - a commission record's removal is one-way, its end trio never changes
 *     or clears once set, a non-owner insert starts open and unremoved, and
 *     the identity columns are immutable: `commission_records_guard_write`
 *     and `commission_record_members_guard_write` ->
 *     presby_commission_guard_write() (0090 section 3b);
 *   - no new member of a removed record (every connection) or of an ended
 *     record (off the owner path), serialized with a concurrent end or
 *     removal by FOR SHARE: `commission_record_members_live_guard` ->
 *     presby_commission_live_guard() (0090 section 3c);
 *   - about_org_id, when set, must be affiliated with the presbytery on the
 *     day it is written: `commission_records_about_org` ->
 *     presby_check_about_org_affiliated('about_org_id', '') under
 *     WHEN (new.about_org_id is not null) (0090 section 3a; 0045);
 *   - the public committee roster's predicates (presby_public_committee_roster,
 *     0090 section 5) read committee_details.dissolved_on.
 *
 * No column carries a Drizzle `$onUpdate`: `updated_at`/`row_version` are
 * written explicitly by the store, and `created_at` on a tenant insert is
 * stamped by the guards.
 */

/** committee_details_kind_check; null is "Not yet labelled". */
export const COMMITTEE_DETAIL_KINDS = ["required", "standing", "ad_hoc"] as const;
export type CommitteeDetailKind = (typeof COMMITTEE_DETAIL_KINDS)[number];

/**
 * commission_record_members_role_check: the six committee titles, no
 * `leader` (T6). src/lib/group-roles.ts's COMMITTEE_ROLES must equal this
 * set (pinned by test against the migration text).
 */
export const COMMISSION_MEMBER_ROLES = [
  "chair",
  "vice_chair",
  "clerk",
  "secretary",
  "ex_officio",
  "member",
] as const;
export type CommissionMemberRole = (typeof COMMISSION_MEMBER_ROLES)[number];

/** The length limits the 0090 CHECKs enforce (characters). */
export const COMMISSION_LIMITS = {
  titleMax: 200,
  chargeMax: 500,
  minuteMax: 200,
  dateFloor: "1900-01-01",
} as const;

/**
 * The CONSTRAINT name each guard refusal carries (SQLSTATE 23514,
 * check_violation), so a caller can map a refusal without reading message
 * text. drizzle/0090 sections 2 and 3.
 */
export const COMMITTEES_GUARD_CODES = {
  detailsTarget: "committee_details_target",
  detailsInsertDissolved: "committee_details_insert_dissolved",
  detailsImmutable: "committee_details_immutable",
  detailsDissolvedFinal: "committee_details_dissolved_final",
  commissionInsertClosed: "commission_guard_insert_closed",
  commissionRemovalFinal: "commission_removal_final",
  commissionEndedFinal: "commission_ended_final",
  commissionImmutable: "commission_guard_immutable",
  commissionRecordClosed: "commission_record_closed",
} as const;

/** committee_details: one per committee group at a presbytery (DECISION-353). */
export const committeeDetails = pgTable(
  "committee_details",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").notNull(),
    kind: text("kind").$type<CommitteeDetailKind>(),
    // Half-open: the first day the committee no longer exists (DECISION-357).
    dissolvedOn: date("dissolved_on"),
    dissolvedBy: uuid("dissolved_by").references(() => users.id),
    dissolvedAt: timestamp("dissolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    unique("committee_details_id_org_key").on(t.id, t.organizationId),
    unique("committee_details_group_key").on(t.groupId),
    foreignKey({
      columns: [t.groupId, t.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
      name: "committee_details_group_fk",
    }),
    check(
      "committee_details_kind_check",
      sql`${t.kind} is null or ${t.kind} in ('required', 'standing', 'ad_hoc')`,
    ),
    check(
      "committee_details_dissolved_floor",
      sql`${t.dissolvedOn} is null or ${t.dissolvedOn} >= date '1900-01-01'`,
    ),
    check(
      "committee_details_dissolved_trio",
      sql`(${t.dissolvedOn} is null) = (${t.dissolvedBy} is null) and (${t.dissolvedOn} is null) = (${t.dissolvedAt} is null)`,
    ),
    index("committee_details_org_idx").on(t.organizationId),
  ],
);

/** commission_records: the presbytery's record of an administrative commission (DECISION-355). */
export const commissionRecords = pgTable(
  "commission_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Optional member congregation; fenced by the 0045 trigger under WHEN not null.
    aboutOrgId: uuid("about_org_id").references(() => organizations.id),
    title: text("title").notNull(),
    // Tier 1 readable; never in audit metadata, CSV, logs, errors, the public site or /admin.
    charge: text("charge"),
    appointedOn: date("appointed_on").notNull(),
    minuteReference: text("minute_reference"),
    // Half-open: the first day the commission no longer serves.
    endedOn: date("ended_on"),
    endedMinuteReference: text("ended_minute_reference"),
    endedBy: uuid("ended_by").references(() => users.id),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    unique("commission_records_id_org_key").on(t.id, t.organizationId),
    check("commission_records_title_length", sql`char_length(btrim(${t.title})) between 1 and 200`),
    check("commission_records_charge_length", sql`${t.charge} is null or char_length(${t.charge}) <= 500`),
    check("commission_records_appointed_floor", sql`${t.appointedOn} >= date '1900-01-01'`),
    check(
      "commission_records_minute_length",
      sql`${t.minuteReference} is null or char_length(${t.minuteReference}) <= 200`,
    ),
    check(
      "commission_records_ended_after_appointed",
      sql`${t.endedOn} is null or ${t.endedOn} >= ${t.appointedOn}`,
    ),
    check(
      "commission_records_ended_minute_length",
      sql`${t.endedMinuteReference} is null or char_length(${t.endedMinuteReference}) <= 200`,
    ),
    check(
      "commission_records_ended_minute_needs_end",
      sql`${t.endedMinuteReference} is null or ${t.endedOn} is not null`,
    ),
    check(
      "commission_records_ended_trio",
      sql`(${t.endedOn} is null) = (${t.endedBy} is null) and (${t.endedOn} is null) = (${t.endedAt} is null)`,
    ),
    check("commission_records_removed_pair", sql`(${t.removedAt} is null) = (${t.removedBy} is null)`),
    index("commission_records_org_idx")
      .on(t.organizationId, t.appointedOn.desc())
      .where(sql`${t.removedAt} is null`),
    index("commission_records_about_idx")
      .on(t.organizationId, t.aboutOrgId)
      .where(sql`${t.aboutOrgId} is not null`),
  ],
);

/** commission_record_members: who serves on a commission record. Not group rows (DECISION-355). */
export const commissionRecordMembers = pgTable(
  "commission_record_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    commissionRecordId: uuid("commission_record_id").notNull(),
    personId: uuid("person_id").notNull(),
    role: text("role").$type<CommissionMemberRole>().notNull().default("member"),
    startsOn: date("starts_on").notNull(),
    // Half-open: the first day the person no longer serves.
    endsOn: date("ends_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    unique("commission_record_members_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.commissionRecordId, t.organizationId],
      foreignColumns: [commissionRecords.id, commissionRecords.organizationId],
      name: "commission_record_members_record_fk",
    }),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "commission_record_members_person_fk",
    }),
    check(
      "commission_record_members_role_check",
      sql`${t.role} in ('chair', 'vice_chair', 'clerk', 'secretary', 'ex_officio', 'member')`,
    ),
    check("commission_record_members_starts_floor", sql`${t.startsOn} >= date '1900-01-01'`),
    check(
      "commission_record_members_end_after_start",
      sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`,
    ),
    index("commission_record_members_record_idx").on(t.organizationId, t.commissionRecordId, t.startsOn),
    uniqueIndex("commission_record_members_one_open_idx")
      .on(t.commissionRecordId, t.personId)
      .where(sql`${t.endsOn} is null`),
    index("commission_record_members_person_idx").on(t.personId, t.organizationId),
  ],
);
