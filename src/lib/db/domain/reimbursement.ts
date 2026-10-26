import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  boolean,
  integer,
  bigint,
  date,
  timestamp,
  index,
  unique,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { memberships } from "./people";
import { groups } from "./groups";
import { users } from "../schema";

/**
 * Reimbursements (Treasury Increment 1) - drizzle/0073_presby_reimbursements.sql.
 * docs/work-log/2026-10-25-treasury-inc1.md (Phase 3 Data Model and API
 * Contract Layer 1; DECISION-267..270; F299-F301). Permissions, template
 * bindings and the backfill are drizzle/0074 (data only).
 *
 * TYPES AND QUERIES ONLY - and in practice types only. presby_app holds NO
 * privilege on requests, attachments, payments or events, and SELECT only on
 * the two configuration tables (0073 section 2, ~line 400). Every read and
 * write goes through a presby_reimbursement_* SECURITY DEFINER function
 * (0073 sections 7-8), called only from src/lib/reimbursement/ (T2). A
 * Drizzle query against these tables on the tenant connection fails with
 * "permission denied"; that is the design, not a missing grant.
 *
 * What the table builder cannot express, stated so a reader does not mistake
 * absence for permission (0073 is the ground truth):
 *
 *   - ENABLE + FORCE ROW LEVEL SECURITY and tenant_isolation on all six
 *     tables (section 2; F1). No DELETE grant for anyone.
 *   - Triggers (section 4), firing on every connection including the owner
 *     path (F44):
 *       *_delete_guard (all six) - delete refused unless the organization is
 *         already gone (the teardown cascade);
 *       reimbursement_requests_insert_guard - born draft, revision 1, no
 *         submission/approval/waiver (origin = 'import' excepted, R13);
 *       reimbursement_requests_update_guard - THE transition table, the
 *         freeze rules, the revision counter, the approver separation of
 *         duties, paid only with a live payment, the approval/waiver clearing;
 *       reimbursement_attachments_write_guard - insert/detach only while
 *         draft or returned, at most 5 live, bumps the request revision;
 *       reimbursement_payments_write_guard - insert-only; payment needs an
 *         approved request, a receipt or waiver, a payer who is not the
 *         approver; self_paid is DERIVED here; reversal offsets one payment;
 *       reimbursement_events_write_guard - insert-only;
 *       *_config_guard - configuration rows born live, ended once;
 *       DEFERRED constraint triggers: paid iff a live payment
 *         (*_status_payment_consistent); every status change has a
 *         same-transaction event (*_insert_has_event, *_status_has_event_upd).
 *   - F301 guards on administrative_commissions, org_delegations and
 *     app_role_permissions (section 5).
 *   - The receipt FK into blob_assets (blob_key, organization_id,
 *     asset_audience) -> (id, organization_id, audience) is Batch 1b: it
 *     needs drizzle/0072's blob_assets.audience column (F289). The
 *     asset_audience column and its `= 'private'` CHECK are here already.
 *   - CHECK constraints are mirrored by NAME (reimbursement.schema.test.ts
 *     pins every name 0073 creates); their SQL is a faithful copy, and 0073
 *     wins if they ever disagree.
 *
 * Dates read through the Neon driver must be cast in SQL (`expense_date::text`)
 * - check:sql-date.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** 0073 section 1a. Groups a request may be charged to (R9). Ended, never deleted. */
export const reimbursementChargeableGroups = pgTable(
  "reimbursement_chargeable_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").notNull(),
    createdByUser: uuid("created_by_user")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedByUser: uuid("ended_by_user").references(() => users.id),
  },
  (t) => [
    unique("reimbursement_chargeable_groups_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.groupId, t.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
      name: "reimbursement_chargeable_groups_group_fk",
    }),
    check(
      "reimbursement_chargeable_groups_end_shape",
      sql`(${t.endedAt} is null) = (${t.endedByUser} is null)`,
    ),
    uniqueIndex("reimbursement_chargeable_groups_one_active_idx")
      .on(t.organizationId, t.groupId)
      .where(sql`${t.endedAt} is null`),
  ],
);

/** 0073 section 1b. One category list per organization (P3-4). Retired, never deleted. */
export const reimbursementCategories = pgTable(
  "reimbursement_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByUser: uuid("created_by_user")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedByUser: uuid("ended_by_user").references(() => users.id),
  },
  (t) => [
    unique("reimbursement_categories_id_org_key").on(t.id, t.organizationId),
    check(
      "reimbursement_categories_name_shape",
      sql`char_length(${t.name}) between 1 and 60 and ${t.name} = btrim(${t.name})`,
    ),
    check("reimbursement_categories_end_shape", sql`(${t.endedAt} is null) = (${t.endedByUser} is null)`),
    uniqueIndex("reimbursement_categories_active_name_idx")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.endedAt} is null`),
  ],
);

/**
 * 0073 section 1c. A reimbursement or vendor-payment request. Integer cents
 * (P3-10). The state machine is the update trigger (see the file header).
 */
export const reimbursementRequests = pgTable(
  "reimbursement_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    origin: text("origin").notNull().default("app"),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("draft"),
    clientKey: text("client_key"),
    createdByUser: uuid("created_by_user").references(() => users.id),
    createdByPersonId: uuid("created_by_person_id"),
    groupId: uuid("group_id").notNull(),
    categoryId: uuid("category_id"),
    beneficiaryPersonId: uuid("beneficiary_person_id"),
    vendorName: text("vendor_name"),
    amountCents: integer("amount_cents"),
    currency: text("currency").notNull().default("usd"),
    expenseDate: date("expense_date"),
    purpose: text("purpose"),
    preApprovedByName: text("pre_approved_by_name"),
    noReceiptClaimed: boolean("no_receipt_claimed").notNull().default(false),
    revision: integer("revision").notNull().default(1),
    firstSubmittedAt: timestamp("first_submitted_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByUser: uuid("approved_by_user").references(() => users.id),
    approvedByPersonId: uuid("approved_by_person_id"),
    approvalPath: text("approval_path"),
    approvedRevision: integer("approved_revision"),
    receiptWaivedAt: timestamp("receipt_waived_at", { withTimezone: true }),
    receiptWaivedByUser: uuid("receipt_waived_by_user").references(() => users.id),
    receiptWaivedByPersonId: uuid("receipt_waived_by_person_id"),
    receiptWaiverNote: text("receipt_waiver_note"),
    createdAt: createdAt(),
    // Set by reimbursement_requests_insert_guard / _update_guard, not by callers.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("reimbursement_requests_id_org_key").on(t.id, t.organizationId),
    unique("reimbursement_requests_client_key_key").on(t.organizationId, t.createdByUser, t.clientKey),
    foreignKey({
      columns: [t.groupId, t.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
      name: "reimbursement_requests_group_fk",
    }),
    foreignKey({
      columns: [t.categoryId, t.organizationId],
      foreignColumns: [reimbursementCategories.id, reimbursementCategories.organizationId],
      name: "reimbursement_requests_category_fk",
    }),
    foreignKey({
      columns: [t.createdByPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "reimbursement_requests_creator_fk",
    }),
    foreignKey({
      columns: [t.beneficiaryPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "reimbursement_requests_beneficiary_fk",
    }),
    foreignKey({
      columns: [t.approvedByPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "reimbursement_requests_approver_fk",
    }),
    foreignKey({
      columns: [t.receiptWaivedByPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "reimbursement_requests_waiver_person_fk",
    }),
    check("reimbursement_requests_origin_allowed", sql`${t.origin} in ('app', 'import')`),
    check("reimbursement_requests_kind_allowed", sql`${t.kind} in ('reimburse', 'vendor')`),
    check(
      "reimbursement_requests_status_allowed",
      sql`${t.status} in ('draft', 'submitted', 'returned', 'not_approved', 'approved', 'paid', 'withdrawn', 'voided')`,
    ),
    check(
      "reimbursement_requests_client_key_shape",
      sql`(${t.clientKey} is null or ${t.clientKey} ~ '^[A-Za-z0-9_-]{8,64}$') and (${t.origin} = 'import' or ${t.clientKey} is not null)`,
    ),
    check(
      "reimbursement_requests_creator_shape",
      sql`${t.origin} = 'import' or (${t.createdByUser} is not null and ${t.createdByPersonId} is not null)`,
    ),
    check(
      "reimbursement_requests_kind_shape",
      sql`(${t.kind} = 'reimburse' and ${t.beneficiaryPersonId} is not null and ${t.vendorName} is null) or (${t.kind} = 'vendor' and ${t.beneficiaryPersonId} is null and (${t.vendorName} is not null or ${t.status} in ('draft', 'withdrawn')))`,
    ),
    check(
      "reimbursement_requests_complete_shape",
      sql`${t.status} in ('draft', 'withdrawn') or (${t.amountCents} is not null and ${t.expenseDate} is not null and ${t.purpose} is not null)`,
    ),
    check(
      "reimbursement_requests_amount_range",
      sql`${t.amountCents} is null or ${t.amountCents} between 1 and 10000000`,
    ),
    check("reimbursement_requests_currency_usd", sql`${t.currency} = 'usd'`),
    check(
      "reimbursement_requests_expense_date_floor",
      sql`${t.expenseDate} is null or ${t.expenseDate} >= date '2000-01-01'`,
    ),
    check(
      "reimbursement_requests_text_bounds",
      sql`(${t.vendorName} is null or char_length(${t.vendorName}) between 1 and 120) and (${t.purpose} is null or char_length(${t.purpose}) between 1 and 500) and (${t.preApprovedByName} is null or char_length(${t.preApprovedByName}) between 1 and 80) and (${t.receiptWaiverNote} is null or char_length(${t.receiptWaiverNote}) between 1 and 300)`,
    ),
    check(
      "reimbursement_requests_revision_positive",
      sql`${t.revision} >= 1 and (${t.approvedRevision} is null or ${t.approvedRevision} >= 1)`,
    ),
    check(
      "reimbursement_requests_submission_shape",
      sql`(${t.firstSubmittedAt} is null) = (${t.submittedAt} is null) and (${t.status} <> 'draft' or ${t.firstSubmittedAt} is null) and (${t.origin} = 'import' or ${t.status} in ('draft', 'withdrawn') or ${t.firstSubmittedAt} is not null)`,
    ),
    check(
      "reimbursement_requests_approval_shape",
      sql`((${t.approvedAt} is null and ${t.approvedByUser} is null and ${t.approvedByPersonId} is null and ${t.approvalPath} is null and ${t.approvedRevision} is null) or (${t.approvedAt} is not null and ${t.approvedRevision} is not null and (${t.origin} = 'import' or (${t.approvedByUser} is not null and ${t.approvedByPersonId} is not null and ${t.approvalPath} is not null)))) and (${t.approvalPath} is null or ${t.approvalPath} in ('seat', 'override')) and ((${t.approvedAt} is not null) = (${t.status} in ('approved', 'paid')))`,
    ),
    check(
      "reimbursement_requests_waiver_shape",
      sql`((${t.receiptWaivedAt} is null and ${t.receiptWaivedByUser} is null and ${t.receiptWaivedByPersonId} is null and ${t.receiptWaiverNote} is null) or (${t.receiptWaivedAt} is not null and (${t.origin} = 'import' or (${t.receiptWaivedByUser} is not null and ${t.receiptWaivedByPersonId} is not null)))) and (${t.receiptWaivedAt} is null or ${t.status} in ('submitted', 'approved', 'paid'))`,
    ),
    index("reimbursement_requests_approved_idx")
      .on(t.organizationId, t.status, t.approvedAt)
      .where(sql`${t.status} = 'approved'`),
    index("reimbursement_requests_status_idx").on(t.organizationId, t.status, t.submittedAt),
    index("reimbursement_requests_creator_idx").on(t.organizationId, t.createdByUser, t.createdAt.desc()),
    index("reimbursement_requests_beneficiary_idx")
      .on(t.organizationId, t.beneficiaryPersonId)
      .where(sql`${t.beneficiaryPersonId} is not null`),
    index("reimbursement_requests_group_idx").on(t.organizationId, t.groupId, t.status),
  ],
);

/**
 * 0073 section 1d. A receipt. blob_key names a PRIVATE blob; asset_audience is
 * the constant 'private' the Batch 1b composite FK carries into blob_assets
 * (DECISION-270/277). content_sha256 is the hash of the bytes AS RECEIVED.
 */
export const reimbursementAttachments = pgTable(
  "reimbursement_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    blobKey: uuid("blob_key").notNull(),
    assetAudience: text("asset_audience").notNull().default("private"),
    contentSha256: text("content_sha256").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    displayName: text("display_name").notNull(),
    createdByUser: uuid("created_by_user")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    detachedAt: timestamp("detached_at", { withTimezone: true }),
    detachedByUser: uuid("detached_by_user").references(() => users.id),
  },
  (t) => [
    unique("reimbursement_attachments_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.requestId, t.organizationId],
      foreignColumns: [reimbursementRequests.id, reimbursementRequests.organizationId],
      name: "reimbursement_attachments_request_fk",
    }),
    // TODO(Batch 1b, F289): foreignKey reimbursement_attachments_blob_fk
    // (blobKey, organizationId, assetAudience) -> blob_assets (id,
    // organization_id, audience), once assets.ts carries `audience`.
    check("reimbursement_attachments_asset_audience_private", sql`${t.assetAudience} = 'private'`),
    check("reimbursement_attachments_sha_shape", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "reimbursement_attachments_content_type_allowed",
      sql`${t.contentType} in ('image/jpeg', 'application/pdf')`,
    ),
    check("reimbursement_attachments_byte_size_range", sql`${t.byteSize} between 1 and 4000000`),
    check(
      "reimbursement_attachments_display_name_shape",
      sql`char_length(${t.displayName}) between 1 and 80 and ${t.displayName} = btrim(${t.displayName}) and ${t.displayName} !~ '[/\\\\[:cntrl:]]'`,
    ),
    check(
      "reimbursement_attachments_detach_shape",
      sql`(${t.detachedAt} is null) = (${t.detachedByUser} is null)`,
    ),
    uniqueIndex("reimbursement_attachments_live_sha_idx")
      .on(t.requestId, t.contentSha256)
      .where(sql`${t.detachedAt} is null`),
    index("reimbursement_attachments_org_sha_idx")
      .on(t.organizationId, t.contentSha256)
      .where(sql`${t.detachedAt} is null`),
    index("reimbursement_attachments_request_idx").on(t.requestId).where(sql`${t.detachedAt} is null`),
  ],
);

/** 0073 section 1e. Insert-only payments and reversals (one reversal per payment; R8). */
export const reimbursementPayments = pgTable(
  "reimbursement_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    kind: text("kind").notNull(),
    method: text("method"),
    reference: text("reference"),
    paidOn: date("paid_on"),
    amountCents: integer("amount_cents").notNull(),
    paidByUser: uuid("paid_by_user").references(() => users.id),
    paidByPersonId: uuid("paid_by_person_id"),
    // Derived by reimbursement_payments_write_guard; never supplied by a caller.
    selfPaid: boolean("self_paid").notNull().default(false),
    note: text("note"),
    offsetsPaymentId: uuid("offsets_payment_id"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("reimbursement_payments_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.requestId, t.organizationId],
      foreignColumns: [reimbursementRequests.id, reimbursementRequests.organizationId],
      name: "reimbursement_payments_request_fk",
    }),
    foreignKey({
      columns: [t.paidByPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "reimbursement_payments_payer_fk",
    }),
    foreignKey({
      columns: [t.offsetsPaymentId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
      name: "reimbursement_payments_offsets_fk",
    }),
    check("reimbursement_payments_kind_allowed", sql`${t.kind} in ('payment', 'reversal')`),
    check(
      "reimbursement_payments_method_allowed",
      sql`${t.method} is null or ${t.method} in ('check', 'ach', 'cash', 'other')`,
    ),
    check(
      "reimbursement_payments_shape",
      sql`(${t.kind} = 'payment' and ${t.method} is not null and ${t.paidOn} is not null and ${t.offsetsPaymentId} is null and ${t.reason} is null) or (${t.kind} = 'reversal' and ${t.offsetsPaymentId} is not null and ${t.reason} is not null and ${t.method} is null and ${t.reference} is null and ${t.paidOn} is null)`,
    ),
    check(
      "reimbursement_payments_check_reference",
      sql`${t.method} is distinct from 'check' or ${t.reference} is not null`,
    ),
    check("reimbursement_payments_amount_positive", sql`${t.amountCents} > 0`),
    check("reimbursement_payments_paid_on_floor", sql`${t.paidOn} is null or ${t.paidOn} >= date '2000-01-01'`),
    check(
      "reimbursement_payments_text_bounds",
      sql`(${t.reference} is null or char_length(${t.reference}) between 1 and 40) and (${t.note} is null or char_length(${t.note}) between 1 and 300) and (${t.reason} is null or char_length(${t.reason}) between 1 and 300)`,
    ),
    check(
      "reimbursement_payments_payer_shape",
      sql`(${t.paidByUser} is null) = (${t.paidByPersonId} is null)`,
    ),
    uniqueIndex("reimbursement_payments_one_reversal_idx")
      .on(t.offsetsPaymentId)
      .where(sql`${t.kind} = 'reversal'`),
    index("reimbursement_payments_request_idx").on(t.organizationId, t.requestId),
  ],
);

/** 0073 section 1f. Insert-only request history. */
export const reimbursementEvents = pgTable(
  "reimbursement_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    kind: text("kind").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorPersonId: uuid("actor_person_id"),
    note: text("note"),
    requestRevision: integer("request_revision").notNull(),
    paymentId: uuid("payment_id"),
    createdAt: createdAt(),
    // Write order within one transaction (0073 D9): created_at is now().
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  },
  (t) => [
    unique("reimbursement_events_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.requestId, t.organizationId],
      foreignColumns: [reimbursementRequests.id, reimbursementRequests.organizationId],
      name: "reimbursement_events_request_fk",
    }),
    foreignKey({
      columns: [t.actorPersonId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "reimbursement_events_actor_fk",
    }),
    foreignKey({
      columns: [t.paymentId, t.organizationId],
      foreignColumns: [reimbursementPayments.id, reimbursementPayments.organizationId],
      name: "reimbursement_events_payment_fk",
    }),
    check(
      "reimbursement_events_kind_allowed",
      sql`${t.kind} in ('created', 'submitted', 'resubmitted', 'approved', 'override_approved', 'returned', 'not_approved', 'withdrawn', 'voided', 'receipt_waived', 'payment_recorded', 'payment_reversed', 'note', 'imported')`,
    ),
    check(
      "reimbursement_events_status_allowed",
      sql`(${t.fromStatus} is null or ${t.fromStatus} in ('draft', 'submitted', 'returned', 'not_approved', 'approved', 'paid', 'withdrawn', 'voided')) and ${t.toStatus} in ('draft', 'submitted', 'returned', 'not_approved', 'approved', 'paid', 'withdrawn', 'voided')`,
    ),
    check(
      "reimbursement_events_actor_shape",
      sql`${t.kind} = 'imported' or (${t.actorUserId} is not null and ${t.actorPersonId} is not null)`,
    ),
    check(
      "reimbursement_events_note_bounds",
      sql`${t.note} is null or char_length(${t.note}) between 1 and 500`,
    ),
    check("reimbursement_events_revision_positive", sql`${t.requestRevision} >= 1`),
    index("reimbursement_events_request_seq_idx").on(t.requestId, t.createdAt, t.seq),
  ],
);
