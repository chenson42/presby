import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  index,
  unique,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { memberships } from "./people";
import { users } from "../schema";

/**
 * Account invitations, Increment 1 (docs/work-log/2026-10-21-invitations.md,
 * Phase 3 "Data Model"; DECISION-183/184/188; findings F153-F159).
 *
 * One row per invitation a platform operator sends to designate a founding
 * administrator or a first treasurer. The invitation is a DECISION-147
 * credential: the recipient holds 32 random bytes; this table holds only
 * their SHA-256 (`tokenHash`).
 *
 * This file is for TypeScript's benefit. The ground truth is
 * drizzle/0059_presby_account_invitations.sql, and most of what makes this
 * table safe is NOT expressible in the table builder:
 *
 *   - FORCE ROW LEVEL SECURITY + `tenant_isolation` (0059 section 4).
 *   - presby_app holds NO table privilege at all (0059 section 4). It reaches
 *     this table only through `presby_preview_invitation(text, uuid)` and
 *     `presby_accept_invitation(text, uuid, text, text, text)` (0059 section
 *     7), both SECURITY DEFINER, both taking the RAW token and hashing it in
 *     SQL (R5). presby_platform holds SELECT. No role holds DELETE.
 *   - `account_invitations_guard_insert` (0059 section 3a): rows are born
 *     OPEN (no terminal timestamp, no redaction); a founding-administrator
 *     row carries no person until acceptance; a resend's parent is in the
 *     same org, already superseded, same purpose/address/person, and
 *     `resendCount = parent + 1` (addendum D-1).
 *   - `account_invitations_guard_update` (0059 section 3b): identity columns
 *     are immutable; terminal states (accepted, revoked, superseded,
 *     blocked) are exclusive and one-way; the accepted and blocked
 *     transitions require the transaction-local marker
 *     `presby.invitation_accept_active`, armed only inside
 *     `presby_accept_invitation()`. Binds the owner connection too (F44).
 *     Do not `.update()` `acceptedAt`, `acceptedUserId`, `blockedAt`,
 *     `blockedReason` or `personId` anywhere in application code.
 *   - `account_invitations_guard_delete` (0059 section 3c): never deleted
 *     except by the fixture-teardown cascade from a `deletable_until`
 *     organization.
 *
 * WRITES: src/lib/onboarding/issue.ts (owner connection) inserts rows and
 * performs the revoke / supersede transitions (Batch 2b). Acceptance and
 * blocking happen only inside `presby_accept_invitation()`.
 *
 * RETENTION: nulling `emailNormalized` 90 days after an invitation ends is
 * POLICY, NOT YET ENFORCED (no sweep exists; S6). Do not claim it in
 * user-facing copy.
 */

export const ACCOUNT_INVITATION_PURPOSES = ["founding_administrator", "treasurer"] as const;
export type AccountInvitationPurpose = (typeof ACCOUNT_INVITATION_PURPOSES)[number];

/** Increment 2 adds `org`. */
export const ACCOUNT_INVITATION_ORIGINS = ["platform"] as const;
export type AccountInvitationOrigin = (typeof ACCOUNT_INVITATION_ORIGINS)[number];

/** The closed list a committed `blockedAt` carries (DECISION-188). */
export const ACCOUNT_INVITATION_BLOCKED_REASONS = [
  "has_holders",
  "person_elsewhere",
  "membership_ended",
  "person_merged",
  "person_linked_elsewhere",
  "ambiguous_person",
  "not_applicable",
  "provisioning_incomplete",
] as const;
export type AccountInvitationBlockedReason = (typeof ACCOUNT_INVITATION_BLOCKED_REASONS)[number];

/** Expiry cap (the CHECK). issue.ts's default is 7 days (Q3). */
export const ACCOUNT_INVITATION_MAX_EXPIRY_DAYS = 30;
/** `resendCount` CHECK upper bound: at most 5 resends per chain. */
export const ACCOUNT_INVITATION_MAX_RESENDS = 5;

/**
 * The transaction-local marker the update guard requires for the accepted and
 * blocked transitions. Armed ONLY by `presby_accept_invitation()`; exported so
 * tests can name it, never so application code can arm it.
 */
export const ACCOUNT_INVITATION_ACCEPT_MARKER = "presby.invitation_accept_active";

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

export const accountInvitations = pgTable(
  "account_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Cascade reachable only through D10's guarded fixture teardown.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // IMMUTABLE.
    purpose: text("purpose").$type<AccountInvitationPurpose>().notNull(),
    // IMMUTABLE.
    origin: text("origin").$type<AccountInvitationOrigin>().notNull().default("platform"),
    // Lowercased, trimmed, <= 320. Null iff redactedAt is set (terminal rows only).
    emailNormalized: text("email_normalized"),
    // IMMUTABLE. Required for founding_administrator, null for treasurer.
    inviteeFirstName: text("invitee_first_name"),
    inviteeLastName: text("invitee_last_name"),
    // treasurer: required at insert, immutable. founding_administrator: null
    // at insert, set once by the accept transition (trigger-guarded).
    // Composite FK (person_id, organization_id) -> memberships below.
    personId: uuid("person_id"),
    // IMMUTABLE. sha256 hex of the raw token; never rotated.
    tokenHash: text("token_hash").notNull(),
    // IMMUTABLE.
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // IMMUTABLE. CHECK: > createdAt and <= createdAt + 30 days.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // IMMUTABLE. Set at insert; plain uuid, no FK (0056 precedent).
    emailQueueId: uuid("email_queue_id"),
    // IMMUTABLE. The superseded row this resend replaces (D-1).
    resentFromId: uuid("resent_from_id"),
    // IMMUTABLE. 0..5; 0 iff resentFromId is null.
    resendCount: integer("resend_count").notNull().default(0),
    // TRIGGER-GUARDED (marker): set only inside presby_accept_invitation().
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id),
    // Owner-path transition (issue.ts).
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id),
    // Owner-path transition (issue.ts resend).
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    // TRIGGER-GUARDED (marker): set only inside presby_accept_invitation().
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedReason: text("blocked_reason").$type<AccountInvitationBlockedReason>(),
    // Owner-path transition on a terminal row (the future S6 sweep).
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite Tenant Keys (F2).
    unique("account_invitations_id_org_key").on(t.id, t.organizationId),
    unique("account_invitations_token_hash_key").on(t.tokenHash),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "account_invitations_person_membership_fk",
    }),
    foreignKey({
      columns: [t.resentFromId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
      name: "account_invitations_resent_from_fk",
    }),

    // Open-row partial uniques (R2, D-2). Expiry is outside the predicate.
    uniqueIndex("account_invitations_open_address_uq")
      .on(t.organizationId, t.purpose, t.emailNormalized)
      .where(
        sql`${t.acceptedAt} is null and ${t.revokedAt} is null and ${t.supersededAt} is null and ${t.blockedAt} is null`,
      ),
    uniqueIndex("account_invitations_open_designation_uq")
      .on(t.organizationId, t.purpose)
      .where(
        sql`${t.purpose} in (${sqlList(ACCOUNT_INVITATION_PURPOSES)}) and ${t.acceptedAt} is null and ${t.revokedAt} is null and ${t.supersededAt} is null and ${t.blockedAt} is null`,
      ),
    // D-1: at most one successor per superseded row.
    uniqueIndex("account_invitations_resent_from_uq")
      .on(t.resentFromId)
      .where(sql`${t.resentFromId} is not null`),
    // Durable limits (R8).
    index("account_invitations_email_created_ix").on(t.emailNormalized, t.createdAt),
    index("account_invitations_inviter_created_ix").on(t.createdByUserId, t.createdAt),
    index("account_invitations_org_created_ix").on(t.organizationId, t.createdAt),

    check(
      "account_invitations_purpose_allowed",
      sql`${t.purpose} in (${sqlList(ACCOUNT_INVITATION_PURPOSES)})`,
    ),
    check(
      "account_invitations_origin_allowed",
      sql`${t.origin} in (${sqlList(ACCOUNT_INVITATION_ORIGINS)})`,
    ),
    check(
      "account_invitations_email_shape",
      sql`${t.emailNormalized} is null or (${t.emailNormalized} = lower(btrim(${t.emailNormalized})) and char_length(${t.emailNormalized}) <= 320 and ${t.emailNormalized} ~ '^[^@[:space:]]+@[^@[:space:]]+$')`,
    ),
    check(
      "account_invitations_email_null_iff_redacted",
      sql`(${t.emailNormalized} is null) = (${t.redactedAt} is not null)`,
    ),
    check(
      "account_invitations_names_shape",
      sql`(${t.inviteeFirstName} is null or (${t.inviteeFirstName} = btrim(${t.inviteeFirstName}) and char_length(${t.inviteeFirstName}) between 1 and 100)) and (${t.inviteeLastName} is null or (${t.inviteeLastName} = btrim(${t.inviteeLastName}) and char_length(${t.inviteeLastName}) between 1 and 100))`,
    ),
    check(
      "account_invitations_names_by_purpose",
      sql`(${t.purpose} <> 'founding_administrator' or (${t.inviteeFirstName} is not null and ${t.inviteeLastName} is not null)) and (${t.purpose} <> 'treasurer' or (${t.inviteeFirstName} is null and ${t.inviteeLastName} is null))`,
    ),
    check(
      "account_invitations_treasurer_has_person",
      sql`${t.purpose} <> 'treasurer' or ${t.personId} is not null`,
    ),
    check("account_invitations_token_hash_shape", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "account_invitations_expiry_window",
      sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '30 days'`,
    ),
    check("account_invitations_resend_count_range", sql`${t.resendCount} between 0 and 5`),
    check(
      "account_invitations_resend_lineage",
      sql`(${t.resentFromId} is null) = (${t.resendCount} = 0)`,
    ),
    check(
      "account_invitations_one_terminal",
      sql`num_nonnulls(${t.acceptedAt}, ${t.revokedAt}, ${t.supersededAt}, ${t.blockedAt}) <= 1`,
    ),
    check(
      "account_invitations_accepted_shape",
      sql`(${t.acceptedAt} is null) = (${t.acceptedUserId} is null) and (${t.acceptedAt} is null or ${t.personId} is not null)`,
    ),
    check(
      "account_invitations_revoked_shape",
      sql`(${t.revokedAt} is null) = (${t.revokedByUserId} is null)`,
    ),
    check(
      "account_invitations_blocked_shape",
      sql`(${t.blockedAt} is null) = (${t.blockedReason} is null)`,
    ),
    check(
      "account_invitations_blocked_reason_allowed",
      sql`${t.blockedReason} in (${sqlList(ACCOUNT_INVITATION_BLOCKED_REASONS)})`,
    ),
    check(
      "account_invitations_redacted_terminal",
      sql`${t.redactedAt} is null or num_nonnulls(${t.acceptedAt}, ${t.revokedAt}, ${t.supersededAt}, ${t.blockedAt}) = 1`,
    ),
  ],
);

export type AccountInvitation = typeof accountInvitations.$inferSelect;
