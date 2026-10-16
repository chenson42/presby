import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  boolean,
  integer,
  bigint,
  numeric,
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
import { users } from "../schema";

/**
 * Online giving (Stripe) - drizzle/0055_presby_giving.sql.
 * docs/work-log/2026-10-15-online-giving.md (Phase 3 Data Model, P3-1..P3-18;
 * DECISION-168..175; F138-F141). Statements are drizzle/0056 (Batch 5).
 *
 * TYPES AND QUERIES ONLY. The migration is the ground truth, and most of what
 * makes these tables safe is NOT expressible in the table builder. Stated here
 * so a reader does not mistake absence for permission:
 *
 *   - ENABLE + FORCE ROW LEVEL SECURITY and the standard tenant_isolation
 *     policy on all twelve tables (0055 section 13, ~line 804; F1). The 2FA arm
 *     that reads permissions.requires_two_factor is section 18 (~line 2656).
 *   - Grants (0055 section 13, ~line 835): NO DELETE for anyone; presby_platform
 *     holds nothing; presby_app holds NO privilege at all on
 *     giving_provider_events, only SELECT on gifts, reversals, intents,
 *     identities, settlements and lines, and a COLUMN-level UPDATE on nine
 *     connection columns (~line 839). Gifts and reversals are written only by
 *     the presby_giving_* SECURITY DEFINER functions (section 17, ~line 1565).
 *   - Triggers (section 14, ~line 888), firing on every connection including
 *     the owner path (F44):
 *       giving_gifts_write_guard / giving_reversals_write_guard - any write
 *         needs the transaction-local marker presby.giving_write_active; a
 *         gift moves only pending -> succeeded|failed, fee/net set once;
 *         a reversal is immutable (P3-7);
 *       giving_reversals_bound - net reversed stays within 0..amount;
 *       giving_*_delete_guard - DELETE only within deletable_until or during
 *         an organization teardown cascade (P3-8);
 *       giving_donors_guard - kind immutable, merges flatten (depth <= 1);
 *       giving_connections_status_guard - disconnected is terminal;
 *       giving_connections_insert_guard - a connection is born onboarding.
 *     Plus three DECISION-175 triggers on administrative_commissions,
 *     org_delegations and app_role_permissions (section 15, ~line 1197).
 *   - Partial indexes are declared below with their `where`; the CHECK
 *     constraints are mirrored by NAME (giving.schema.test.ts pins every name
 *     0055 creates), their SQL is a faithful copy, and 0055 wins if they ever
 *     disagree.
 *
 * Dates read through the Neon driver must be cast in SQL (`occurred_on::text`)
 * - check:sql-date.
 */

/** 0055 section 1. One value; Vanco arrives as `alter type ... add value`. */
export const givingProvider = pgEnum("giving_provider", ["stripe"]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * The donee identity printed on statements (R5, DECISION-172). PK is
 * organization_id (like organization_settings); nothing references it -
 * statements snapshot it - so it carries no (id, organization_id) key.
 */
export const givingSettings = pgTable(
  "giving_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    doneeLegalName: text("donee_legal_name"),
    doneeAddressLine1: text("donee_address_line1"),
    doneeAddressLine2: text("donee_address_line2"),
    doneeCity: text("donee_city"),
    doneeRegion: text("donee_region"),
    doneePostalCode: text("donee_postal_code"),
    doneeEin: text("donee_ein"),
    signatoryName: text("signatory_name"),
    signatoryTitle: text("signatory_title"),
    greetingText: text("greeting_text"),
    closingText: text("closing_text"),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "giving_settings_legal_name_shape",
      sql`${t.doneeLegalName} is null or (${t.doneeLegalName} = btrim(${t.doneeLegalName}) and char_length(${t.doneeLegalName}) between 1 and 200)`,
    ),
    check(
      "giving_settings_address_bounds",
      sql`coalesce(char_length(${t.doneeAddressLine1}), 0) <= 120 and coalesce(char_length(${t.doneeAddressLine2}), 0) <= 120 and coalesce(char_length(${t.doneeCity}), 0) <= 120`,
    ),
    check("giving_settings_region_shape", sql`${t.doneeRegion} is null or ${t.doneeRegion} ~ '^[A-Z]{2}$'`),
    check(
      "giving_settings_postal_shape",
      sql`${t.doneePostalCode} is null or ${t.doneePostalCode} ~ '^[0-9]{5}(-[0-9]{4})?$'`,
    ),
    check("giving_settings_ein_shape", sql`${t.doneeEin} is null or ${t.doneeEin} ~ '^[0-9]{2}-[0-9]{7}$'`),
    check(
      "giving_settings_signatory_bounds",
      sql`coalesce(char_length(${t.signatoryName}), 0) <= 120 and coalesce(char_length(${t.signatoryTitle}), 0) <= 120`,
    ),
    check(
      "giving_settings_text_bounds",
      sql`coalesce(char_length(${t.greetingText}), 0) <= 500 and coalesce(char_length(${t.closingText}), 0) <= 500`,
    ),
  ],
);

/**
 * A congregation's provider account (Stripe Connect, direct charges,
 * congregation-owned). Only the acct_ id is stored. Status and capability
 * flags move only through DEFINER functions; presby_app may UPDATE only the
 * nine go-live / attestation / fee-rate columns (0055 ~line 819).
 */
export const givingProviderConnections = pgTable(
  "giving_provider_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: givingProvider("provider").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    livemode: boolean("livemode").notNull(),
    status: text("status").notNull().default("onboarding"),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    cardEnabled: boolean("card_enabled").notNull().default(false),
    achEnabled: boolean("ach_enabled").notNull().default(false),
    requirementsDue: boolean("requirements_due").notNull().default(false),
    disabledReason: text("disabled_reason"),
    cardFeeBps: integer("card_fee_bps").notNull().default(290),
    cardFeeFixedCents: integer("card_fee_fixed_cents").notNull().default(30),
    achFeeBps: integer("ach_fee_bps").notNull().default(80),
    achFeeCapCents: integer("ach_fee_cap_cents").notNull().default(500),
    payoutsAttestedAt: timestamp("payouts_attested_at", { withTimezone: true }),
    payoutsAttestedBy: uuid("payouts_attested_by").references(() => users.id),
    // presby's explicit go-live (P3-11), not Stripe livemode.
    publicEnabledAt: timestamp("public_enabled_at", { withTimezone: true }),
    publicEnabledBy: uuid("public_enabled_by").references(() => users.id),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    disconnectedReason: text("disconnected_reason"),
    lastStatusAt: timestamp("last_status_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("giving_connections_id_org_key").on(t.id, t.organizationId),
    unique("giving_connections_provider_account_key").on(t.provider, t.externalAccountId),
    // At most one non-disconnected connection per org (R10).
    uniqueIndex("giving_connections_one_open_idx")
      .on(t.organizationId)
      .where(sql`${t.status} <> 'disconnected'`),
    check("giving_connections_account_shape", sql`${t.externalAccountId} ~ '^acct_[A-Za-z0-9]{8,64}$'`),
    check(
      "giving_connections_status_allowed",
      sql`${t.status} in ('onboarding', 'active', 'restricted', 'disconnected')`,
    ),
    check(
      "giving_connections_fee_bounds",
      sql`${t.cardFeeBps} between 0 and 1000 and ${t.achFeeBps} between 0 and 500 and ${t.cardFeeFixedCents} between 0 and 100 and ${t.achFeeCapCents} between 0 and 2000`,
    ),
    check(
      "giving_connections_disabled_reason_bounds",
      sql`${t.disabledReason} is null or char_length(${t.disabledReason}) <= 120`,
    ),
    check(
      "giving_connections_disconnect_shape",
      sql`(${t.status} = 'disconnected') = (${t.disconnectedAt} is not null) and (${t.status} = 'disconnected') = (${t.disconnectedReason} is not null) and (${t.disconnectedReason} is null or ${t.disconnectedReason} in ('treasurer', 'deauthorized'))`,
    ),
    check(
      "giving_connections_public_needs_attestation",
      sql`${t.publicEnabledAt} is null or ${t.payoutsAttestedAt} is not null`,
    ),
  ],
);

/** Designations. Retired, never deleted; nothing is offered online by default (G23). */
export const givingFunds = pgTable(
  "giving_funds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    onlineDisplayName: text("online_display_name"),
    description: text("description"),
    restrictionClass: text("restriction_class").notNull().default("unrestricted"),
    offeredOnline: boolean("offered_online").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("giving_funds_id_org_key").on(t.id, t.organizationId),
    // Covers retired rows: a retired name stays reserved.
    uniqueIndex("giving_funds_org_lower_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    check("giving_funds_name_shape", sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 80`),
    check(
      "giving_funds_online_name_shape",
      sql`${t.onlineDisplayName} is null or (${t.onlineDisplayName} = btrim(${t.onlineDisplayName}) and char_length(${t.onlineDisplayName}) between 1 and 80)`,
    ),
    check(
      "giving_funds_description_bounds",
      sql`${t.description} is null or char_length(${t.description}) <= 500`,
    ),
    check(
      "giving_funds_restriction_allowed",
      sql`${t.restrictionClass} in ('unrestricted', 'temporarily_restricted', 'permanently_restricted')`,
    ),
    check(
      "giving_funds_online_shape",
      sql`not ${t.offeredOnline} or (${t.isActive} and ${t.onlineDisplayName} is not null)`,
    ),
    check("giving_funds_retired_shape", sql`${t.isActive} = (${t.retiredAt} is null)`),
  ],
);

/**
 * A giver as the books know them. Deliberately NO person_id (schema-design
 * section 7): the optional link is a composite reference to `memberships`.
 * Merges flatten (giving_donors_guard). `unidentified` = plate cash: one per
 * org, no contact, never a statement. DELETE guarded (P3-8).
 */
export const givingDonors = pgTable(
  "giving_donors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("identified"),
    displayName: text("display_name").notNull(),
    email: text("email"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("US"),
    linkedMembershipId: uuid("linked_membership_id"),
    linkSource: text("link_source"),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    linkedBy: uuid("linked_by").references(() => users.id),
    mergedIntoId: uuid("merged_into_id"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    mergedBy: uuid("merged_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
    deletableUntil: timestamp("deletable_until", { withTimezone: true }),
  },
  (t) => [
    unique("giving_donors_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.linkedMembershipId, t.organizationId],
      foreignColumns: [memberships.id, memberships.organizationId],
      name: "giving_donors_link_fk",
    }),
    foreignKey({
      columns: [t.mergedIntoId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
      name: "giving_donors_merge_fk",
    }),
    uniqueIndex("giving_donors_one_unidentified_idx")
      .on(t.organizationId)
      .where(sql`${t.kind} = 'unidentified'`),
    index("giving_donors_org_name_idx").on(t.organizationId, sql`lower(${t.displayName})`),
    index("giving_donors_org_email_idx").on(t.organizationId, t.email).where(sql`${t.email} is not null`),
    index("giving_donors_org_link_idx")
      .on(t.organizationId, t.linkedMembershipId)
      .where(sql`${t.linkedMembershipId} is not null`),
    index("giving_donors_org_merged_idx")
      .on(t.organizationId, t.mergedIntoId)
      .where(sql`${t.mergedIntoId} is not null`),
    check("giving_donors_kind_allowed", sql`${t.kind} in ('identified', 'unidentified')`),
    check(
      "giving_donors_display_name_shape",
      sql`${t.displayName} = btrim(${t.displayName}) and char_length(${t.displayName}) between 1 and 120`,
    ),
    check(
      "giving_donors_email_shape",
      sql`${t.email} is null or (${t.email} = lower(btrim(${t.email})) and char_length(${t.email}) <= 254 and ${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')`,
    ),
    check(
      "giving_donors_address_bounds",
      sql`coalesce(char_length(${t.addressLine1}), 0) <= 120 and coalesce(char_length(${t.addressLine2}), 0) <= 120 and coalesce(char_length(${t.city}), 0) <= 120 and coalesce(char_length(${t.region}), 0) <= 120 and coalesce(char_length(${t.postalCode}), 0) <= 120`,
    ),
    check("giving_donors_country_shape", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check(
      "giving_donors_link_shape",
      sql`(${t.linkSource} is null or ${t.linkSource} in ('self_online', 'recorder_confirmed')) and (${t.linkedMembershipId} is null) = (${t.linkSource} is null) and (${t.linkSource} is null) = (${t.linkedAt} is null)`,
    ),
    check(
      "giving_donors_merge_shape",
      sql`(${t.mergedIntoId} is null) = (${t.mergedAt} is null) and ${t.mergedIntoId} is distinct from ${t.id}`,
    ),
    check(
      "giving_donors_unidentified_shape",
      sql`${t.kind} = 'identified' or (${t.email} is null and ${t.addressLine1} is null and ${t.addressLine2} is null and ${t.city} is null and ${t.region} is null and ${t.postalCode} is null and ${t.linkedMembershipId} is null and ${t.mergedIntoId} is null)`,
    ),
  ],
);

/** A provider customer (cus_) attached to a donor. presby_app: SELECT only. */
export const givingDonorIdentities = pgTable(
  "giving_donor_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    donorId: uuid("donor_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    externalCustomerId: text("external_customer_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("giving_identities_id_org_key").on(t.id, t.organizationId),
    unique("giving_identities_customer_key").on(t.connectionId, t.externalCustomerId),
    foreignKey({
      columns: [t.donorId, t.organizationId],
      foreignColumns: [givingDonors.id, givingDonors.organizationId],
      name: "giving_identities_donor_fk",
    }),
    foreignKey({
      columns: [t.connectionId, t.organizationId],
      foreignColumns: [givingProviderConnections.id, givingProviderConnections.organizationId],
      name: "giving_identities_conn_fk",
    }),
    index("giving_identities_donor_idx").on(t.organizationId, t.donorId),
    check("giving_identities_customer_shape", sql`${t.externalCustomerId} ~ '^cus_[A-Za-z0-9]{8,64}$'`),
  ],
);

/** A dismissed donor-to-membership proposal. presby_app: SELECT, INSERT. */
export const givingDonorLinkDecisions = pgTable(
  "giving_donor_link_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    donorId: uuid("donor_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    decision: text("decision").notNull(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("giving_link_decisions_id_org_key").on(t.id, t.organizationId),
    unique("giving_link_decisions_once_key").on(t.donorId, t.membershipId),
    foreignKey({
      columns: [t.donorId, t.organizationId],
      foreignColumns: [givingDonors.id, givingDonors.organizationId],
      name: "giving_link_decisions_donor_fk",
    }),
    foreignKey({
      columns: [t.membershipId, t.organizationId],
      foreignColumns: [memberships.id, memberships.organizationId],
      name: "giving_link_decisions_member_fk",
    }),
    check("giving_link_decisions_decision_allowed", sql`${t.decision} = 'dismissed'`),
  ],
);

/**
 * Presby's own record of a give attempt, written before the redirect. The ONLY
 * path from a Stripe payment to a gift (R9): fund and membership come from
 * here, never from Stripe metadata. Written only by DEFINER functions;
 * presby_app: SELECT. `giftAmountCents` is the gift; `totalCents` (= gift +
 * covered fee) is what Stripe charges, computed in SQL.
 */
export const givingCheckoutIntents = pgTable(
  "giving_checkout_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    fundId: uuid("fund_id").notNull(),
    // null on the public page; set only by presby_giving_create_intent_member()
    membershipId: uuid("membership_id"),
    donorId: uuid("donor_id"),
    frequency: text("frequency").notNull(),
    methodChoice: text("method_choice").notNull(),
    coverFees: boolean("cover_fees").notNull().default(false),
    giftAmountCents: integer("gift_amount_cents").notNull(),
    donorCoveredFeeCents: integer("donor_covered_fee_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    livemode: boolean("livemode").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("created"),
    checkoutSessionId: text("checkout_session_id"),
    paymentIntentId: text("payment_intent_id"),
    subscriptionId: text("subscription_id"),
    customerId: text("customer_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    subscriptionEndedAt: timestamp("subscription_ended_at", { withTimezone: true }),
    lastPaymentFailedAt: timestamp("last_payment_failed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("giving_intents_id_org_key").on(t.id, t.organizationId),
    unique("giving_intents_idem_key").on(t.organizationId, t.idempotencyKey),
    foreignKey({
      columns: [t.connectionId, t.organizationId],
      foreignColumns: [givingProviderConnections.id, givingProviderConnections.organizationId],
      name: "giving_intents_conn_fk",
    }),
    foreignKey({
      columns: [t.fundId, t.organizationId],
      foreignColumns: [givingFunds.id, givingFunds.organizationId],
      name: "giving_intents_fund_fk",
    }),
    foreignKey({
      columns: [t.membershipId, t.organizationId],
      foreignColumns: [memberships.id, memberships.organizationId],
      name: "giving_intents_member_fk",
    }),
    foreignKey({
      columns: [t.donorId, t.organizationId],
      foreignColumns: [givingDonors.id, givingDonors.organizationId],
      name: "giving_intents_donor_fk",
    }),
    uniqueIndex("giving_intents_session_idx")
      .on(t.connectionId, t.checkoutSessionId)
      .where(sql`${t.checkoutSessionId} is not null`),
    uniqueIndex("giving_intents_subscription_idx")
      .on(t.connectionId, t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
    index("giving_intents_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    check("giving_intents_frequency_allowed", sql`${t.frequency} in ('once', 'monthly')`),
    check(
      "giving_intents_method_allowed",
      sql`${t.methodChoice} in ('card', 'bank', 'either') and (not ${t.coverFees} or ${t.methodChoice} <> 'either')`,
    ),
    check(
      "giving_intents_amount_shape",
      sql`${t.giftAmountCents} between 100 and 2500000 and ${t.donorCoveredFeeCents} >= 0 and ${t.totalCents} = ${t.giftAmountCents} + ${t.donorCoveredFeeCents}`,
    ),
    check("giving_intents_covered_shape", sql`${t.coverFees} or ${t.donorCoveredFeeCents} = 0`),
    check("giving_intents_currency_usd", sql`${t.currency} = 'usd'`),
    check(
      "giving_intents_idem_shape",
      sql`${t.idempotencyKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "giving_intents_status_allowed",
      sql`${t.status} in ('created', 'open', 'completed', 'expired', 'failed')`,
    ),
    check(
      "giving_intents_external_ids_shape",
      sql`(${t.checkoutSessionId} is null or ${t.checkoutSessionId} ~ '^cs_[A-Za-z0-9_]{8,255}$') and (${t.paymentIntentId} is null or ${t.paymentIntentId} ~ '^pi_[A-Za-z0-9_]{8,64}$') and (${t.subscriptionId} is null or ${t.subscriptionId} ~ '^sub_[A-Za-z0-9_]{8,64}$') and (${t.customerId} is null or ${t.customerId} ~ '^cus_[A-Za-z0-9]{8,64}$')`,
    ),
  ],
);

/**
 * The webhook inbox (R6). presby_app holds NO privilege on this table - every
 * read and write is a SECURITY DEFINER function. Declared here for types and
 * for the owner-only health reader; a tenant query against it is a
 * permission error by design. The functions that read it, and the columns
 * each returns, are 0055 section 17 (claim_event ~line 1661; ingest_health,
 * dead_letters and requeue_event ~line 2530, all three OWNER-ONLY,
 * corrections C1/C2 of 2026-10-16).
 */
export const givingProviderEvents = pgTable(
  "giving_provider_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    provider: givingProvider("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    livemode: boolean("livemode").notNull(),
    // exact signed bytes as text (never jsonb); nulled 90 days after a terminal status
    rawBody: text("raw_body"),
    bodyPurgedAt: timestamp("body_purged_at", { withTimezone: true }),
    status: text("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    unique("giving_events_id_org_key").on(t.id, t.organizationId),
    unique("giving_events_once_key").on(t.connectionId, t.externalEventId),
    foreignKey({
      columns: [t.connectionId, t.organizationId],
      foreignColumns: [givingProviderConnections.id, givingProviderConnections.organizationId],
      name: "giving_events_conn_fk",
    }),
    index("giving_events_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('received', 'parked', 'processing')`),
    index("giving_events_org_status_idx").on(t.organizationId, t.status),
    check(
      "giving_events_status_allowed",
      sql`${t.status} in ('received', 'processing', 'applied', 'ignored', 'parked', 'dead_letter')`,
    ),
    check("giving_events_attempts_nonneg", sql`${t.attempts} >= 0`),
    check("giving_events_external_id_shape", sql`${t.externalEventId} ~ '^evt_[A-Za-z0-9_]{8,64}$'`),
    check(
      "giving_events_type_shape",
      sql`char_length(${t.eventType}) between 1 and 100 and ${t.eventType} ~ '^[a-z0-9_.]+$'`,
    ),
    check(
      "giving_events_last_error_shape",
      sql`${t.lastError} is null or (char_length(${t.lastError}) <= 60 and ${t.lastError} ~ '^[a-z0-9_:]*$')`,
    ),
    check("giving_events_body_bounds", sql`${t.rawBody} is null or octet_length(${t.rawBody}) <= 1000000`),
    check("giving_events_purge_shape", sql`(${t.bodyPurgedAt} is null) = (${t.rawBody} is not null)`),
  ],
);

/**
 * One gift. NO INSERT/UPDATE grant for any role (P3-7): written only by the
 * presby_giving_* DEFINER functions under the presby.giving_write_active
 * marker. `amountCents` is the TOTAL charged (incl. `donorCoveredFeeCents`);
 * for stock it is the books value, never printed. `occurredOn` is the
 * org-local date and the only source of the statement year. Every total
 * filters `livemode = true` (P3-17). DELETE guarded (P3-8).
 */
export const givingGifts = pgTable(
  "giving_gifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    donorId: uuid("donor_id").notNull(),
    fundId: uuid("fund_id").notNull(),
    source: text("source").notNull(),
    provider: givingProvider("provider"),
    connectionId: uuid("connection_id"),
    intentId: uuid("intent_id"),
    externalTransactionId: text("external_transaction_id"),
    method: text("method"),
    checkNumber: text("check_number"),
    stockDescription: text("stock_description"),
    stockQuantity: numeric("stock_quantity", { precision: 18, scale: 6 }),
    memo: text("memo"),
    amountCents: integer("amount_cents").notNull(),
    donorCoveredFeeCents: integer("donor_covered_fee_cents").notNull().default(0),
    feeCents: integer("fee_cents"),
    netCents: integer("net_cents"),
    currency: text("currency").notNull().default("usd"),
    status: text("status").notNull(),
    failureCode: text("failure_code"),
    occurredOn: date("occurred_on").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    livemode: boolean("livemode").notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id),
    sourceEventId: uuid("source_event_id"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    deletableUntil: timestamp("deletable_until", { withTimezone: true }),
  },
  (t) => [
    unique("giving_gifts_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.donorId, t.organizationId],
      foreignColumns: [givingDonors.id, givingDonors.organizationId],
      name: "giving_gifts_donor_fk",
    }),
    foreignKey({
      columns: [t.fundId, t.organizationId],
      foreignColumns: [givingFunds.id, givingFunds.organizationId],
      name: "giving_gifts_fund_fk",
    }),
    foreignKey({
      columns: [t.connectionId, t.organizationId],
      foreignColumns: [givingProviderConnections.id, givingProviderConnections.organizationId],
      name: "giving_gifts_conn_fk",
    }),
    foreignKey({
      columns: [t.intentId, t.organizationId],
      foreignColumns: [givingCheckoutIntents.id, givingCheckoutIntents.organizationId],
      name: "giving_gifts_intent_fk",
    }),
    foreignKey({
      columns: [t.sourceEventId, t.organizationId],
      foreignColumns: [givingProviderEvents.id, givingProviderEvents.organizationId],
      name: "giving_gifts_event_fk",
    }),
    uniqueIndex("giving_gifts_txn_idx")
      .on(t.connectionId, t.externalTransactionId)
      .where(sql`${t.externalTransactionId} is not null`),
    index("giving_gifts_org_date_idx").on(t.organizationId, t.occurredOn.desc(), t.id.desc()),
    index("giving_gifts_org_donor_idx").on(t.organizationId, t.donorId, t.occurredOn),
    index("giving_gifts_org_fund_idx").on(t.organizationId, t.fundId),
    index("giving_gifts_org_status_idx")
      .on(t.organizationId, t.status, t.statusChangedAt)
      .where(sql`${t.status} <> 'succeeded'`),
    index("giving_gifts_org_rec_idx")
      .on(t.organizationId, t.recordedBy, t.createdAt)
      .where(sql`${t.recordedBy} is not null`),
    index("giving_gifts_org_intent_idx")
      .on(t.organizationId, t.intentId)
      .where(sql`${t.intentId} is not null`),
    check("giving_gifts_source_allowed", sql`${t.source} in ('online', 'offline')`),
    check("giving_gifts_status_allowed", sql`${t.status} in ('pending', 'succeeded', 'failed')`),
    check("giving_gifts_currency_usd", sql`${t.currency} = 'usd'`),
    check("giving_gifts_amount_range", sql`${t.amountCents} between 1 and 100000000`),
    check(
      "giving_gifts_covered_fee_range",
      sql`${t.donorCoveredFeeCents} >= 0 and ${t.donorCoveredFeeCents} < ${t.amountCents}`,
    ),
    check("giving_gifts_occurred_on_floor", sql`${t.occurredOn} >= date '2000-01-01'`),
    check(
      "giving_gifts_text_bounds",
      sql`coalesce(char_length(${t.checkNumber}), 0) <= 30 and coalesce(char_length(${t.stockDescription}), 0) <= 200 and coalesce(char_length(${t.memo}), 0) <= 500 and coalesce(char_length(${t.externalTransactionId}), 0) <= 255`,
    ),
    check(
      "giving_gifts_failure_code_shape",
      sql`${t.failureCode} is null or (${t.status} = 'failed' and char_length(${t.failureCode}) <= 60 and ${t.failureCode} ~ '^[a-z0-9_]+$')`,
    ),
    check(
      "giving_gifts_method_allowed",
      sql`${t.method} is null or ${t.method} in ('card', 'us_bank_account', 'wallet', 'cash', 'check', 'stock', 'other')`,
    ),
    check(
      "giving_gifts_online_shape",
      sql`${t.source} <> 'online' or (${t.provider} is not null and ${t.connectionId} is not null and ${t.intentId} is not null and ${t.externalTransactionId} is not null and ${t.occurredAt} is not null and ${t.recordedBy} is null and (${t.method} is null or ${t.method} in ('card', 'us_bank_account', 'wallet')))`,
    ),
    check(
      "giving_gifts_offline_shape",
      sql`${t.source} <> 'offline' or (${t.provider} is null and ${t.connectionId} is null and ${t.intentId} is null and ${t.externalTransactionId} is null and ${t.occurredAt} is null and ${t.feeCents} is null and ${t.recordedBy} is not null and ${t.livemode} and ${t.status} = 'succeeded' and ${t.method} in ('cash', 'check', 'stock', 'other') and ${t.donorCoveredFeeCents} = 0)`,
    ),
    check("giving_gifts_check_number_shape", sql`${t.checkNumber} is null or ${t.method} = 'check'`),
    check(
      "giving_gifts_stock_shape",
      sql`(${t.method} is not distinct from 'stock') = (${t.stockDescription} is not null) and (${t.stockQuantity} is null or (${t.method} = 'stock' and ${t.stockQuantity} > 0))`,
    ),
    check(
      "giving_gifts_fee_shape",
      sql`(${t.feeCents} is null) = (${t.netCents} is null) and (${t.feeCents} is null or (${t.feeCents} >= 0 and ${t.netCents} = ${t.amountCents} - ${t.feeCents}))`,
    ),
  ],
);

/**
 * Insert-only corrections (P3-12): refund, dispute, ach_return, void (offline,
 * with a reason), reinstatement (offsets an earlier reversal). UPDATE always
 * raises; giving_reversals_bound keeps the net reversed within 0..amount.
 */
export const givingGiftReversals = pgTable(
  "giving_gift_reversals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    giftId: uuid("gift_id").notNull(),
    connectionId: uuid("connection_id"),
    kind: text("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    externalReversalId: text("external_reversal_id"),
    offsetsReversalId: uuid("offsets_reversal_id"),
    reason: text("reason"),
    occurredOn: date("occurred_on").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    recordedBy: uuid("recorded_by").references(() => users.id),
    livemode: boolean("livemode").notNull(),
    sourceEventId: uuid("source_event_id"),
    createdAt: createdAt(),
    deletableUntil: timestamp("deletable_until", { withTimezone: true }),
  },
  (t) => [
    unique("giving_reversals_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.giftId, t.organizationId],
      foreignColumns: [givingGifts.id, givingGifts.organizationId],
      name: "giving_reversals_gift_fk",
    }),
    foreignKey({
      columns: [t.connectionId, t.organizationId],
      foreignColumns: [givingProviderConnections.id, givingProviderConnections.organizationId],
      name: "giving_reversals_conn_fk",
    }),
    foreignKey({
      columns: [t.offsetsReversalId, t.organizationId],
      foreignColumns: [t.id, t.organizationId],
      name: "giving_reversals_offsets_fk",
    }),
    foreignKey({
      columns: [t.sourceEventId, t.organizationId],
      foreignColumns: [givingProviderEvents.id, givingProviderEvents.organizationId],
      name: "giving_reversals_event_fk",
    }),
    uniqueIndex("giving_reversals_ext_idx")
      .on(t.connectionId, t.externalReversalId)
      .where(sql`${t.externalReversalId} is not null`),
    uniqueIndex("giving_reversals_void_idx").on(t.giftId).where(sql`${t.kind} = 'void'`),
    index("giving_reversals_gift_idx").on(t.organizationId, t.giftId),
    check(
      "giving_reversals_kind_allowed",
      sql`${t.kind} in ('refund', 'dispute', 'ach_return', 'void', 'reinstatement')`,
    ),
    check("giving_reversals_amount_positive", sql`${t.amountCents} > 0`),
    check(
      "giving_reversals_text_bounds",
      sql`coalesce(char_length(${t.reason}), 0) <= 200 and coalesce(char_length(${t.externalReversalId}), 0) <= 255`,
    ),
    check("giving_reversals_occurred_on_floor", sql`${t.occurredOn} >= date '2000-01-01'`),
    check(
      "giving_reversals_void_shape",
      sql`${t.kind} <> 'void' or (${t.reason} is not null and ${t.recordedBy} is not null and ${t.connectionId} is null and ${t.externalReversalId} is null and ${t.offsetsReversalId} is null)`,
    ),
    check(
      "giving_reversals_provider_shape",
      sql`${t.kind} not in ('refund', 'dispute', 'ach_return') or (${t.connectionId} is not null and ${t.externalReversalId} is not null and ${t.offsetsReversalId} is null and ${t.recordedBy} is null)`,
    ),
    check(
      "giving_reversals_reinstatement_shape",
      sql`${t.kind} <> 'reinstatement' or (${t.connectionId} is not null and ${t.externalReversalId} is not null and ${t.offsetsReversalId} is not null and ${t.recordedBy} is null)`,
    ),
  ],
);

/** Payouts (po_), read-only reconciliation (Batch 6, droppable). */
export const givingSettlements = pgTable(
  "giving_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    externalSettlementId: text("external_settlement_id").notNull(),
    arrivalDate: date("arrival_date"),
    status: text("status").notNull(),
    automatic: boolean("automatic").notNull().default(true),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull(),
    livemode: boolean("livemode").notNull(),
    linesLoadedAt: timestamp("lines_loaded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("giving_settlements_id_org_key").on(t.id, t.organizationId),
    unique("giving_settlements_ext_key").on(t.connectionId, t.externalSettlementId),
    foreignKey({
      columns: [t.connectionId, t.organizationId],
      foreignColumns: [givingProviderConnections.id, givingProviderConnections.organizationId],
      name: "giving_settlements_conn_fk",
    }),
    check("giving_settlements_status_allowed", sql`${t.status} in ('paid', 'failed')`),
    check("giving_settlements_gross_nonneg", sql`${t.grossCents} >= 0`),
    check(
      "giving_settlements_external_id_shape",
      sql`${t.externalSettlementId} ~ '^po_[A-Za-z0-9_]{8,64}$'`,
    ),
  ],
);

/** Balance-transaction lines of a payout. SIGNED bigint amounts (P3-13). */
export const givingSettlementLines = pgTable(
  "giving_settlement_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    settlementId: uuid("settlement_id").notNull(),
    giftId: uuid("gift_id"),
    externalBalanceTransactionId: text("external_balance_transaction_id").notNull(),
    paymentIntentId: text("payment_intent_id"),
    kind: text("kind").notNull(),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull(),
    feeCents: bigint("fee_cents", { mode: "number" }).notNull(),
    netCents: bigint("net_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    unique("giving_settlement_lines_id_org_key").on(t.id, t.organizationId),
    unique("giving_settlement_lines_txn_key").on(t.settlementId, t.externalBalanceTransactionId),
    foreignKey({
      columns: [t.settlementId, t.organizationId],
      foreignColumns: [givingSettlements.id, givingSettlements.organizationId],
      name: "giving_settlement_lines_settlement_fk",
    }),
    foreignKey({
      columns: [t.giftId, t.organizationId],
      foreignColumns: [givingGifts.id, givingGifts.organizationId],
      name: "giving_settlement_lines_gift_fk",
    }),
    index("giving_settlement_lines_gift_idx")
      .on(t.organizationId, t.giftId)
      .where(sql`${t.giftId} is not null`),
    check(
      "giving_settlement_lines_kind_allowed",
      sql`${t.kind} in ('charge', 'refund', 'dispute', 'fee', 'adjustment', 'other')`,
    ),
    check("giving_settlement_lines_net_shape", sql`${t.netCents} = ${t.grossCents} - ${t.feeCents}`),
    check(
      "giving_settlement_lines_ids_shape",
      sql`char_length(${t.externalBalanceTransactionId}) between 1 and 255 and (${t.paymentIntentId} is null or ${t.paymentIntentId} ~ '^pi_[A-Za-z0-9_]{8,64}$')`,
    ),
  ],
);
