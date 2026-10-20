import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  jsonb,
  index,
  unique,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * Custom domains (Track F, Increment 1). See
 * docs/work-log/2026-10-19-custom-domains.md Phase 3 "Data Model" and
 * DECISION-176/178/180; findings F150, F152.
 *
 * `organization_domains` holds ONE ROW PER DNS HOST an organization has
 * claimed, with a `purpose` (`web` | `mail`). A TXT proof at
 * `_presby-challenge.<claim_name>` covers `claim_name` and `www.<claim_name>`;
 * the apex/www pair shares one `proof_token` and is grouped in the UI by
 * `claim_name`. No provider call precedes proof.
 *
 * This file is for TypeScript's benefit. The ground truth is
 * drizzle/0057_presby_org_domains.sql, and most of what makes this table safe
 * is NOT expressible in the table builder:
 *
 *   - FORCE ROW LEVEL SECURITY + `tenant_isolation` (0057 section 5).
 *   - Column-limited `presby_app` grants and NO DELETE (0057 section 5):
 *     SELECT all; INSERT only the tenant-intent columns; UPDATE only state
 *     and observation columns. `platformHold`, `holdReason`,
 *     `forceReleaseReason` are owner-only. `graceEndsAt`, `stateChangedAt`,
 *     `proofVerifiedAt`, `attachedAt`, `liveAt`, `releasedAt` are
 *     TRIGGER-OWNED: no grant names them, and the guard refuses any write to
 *     them on the owner connection too (A1). Do not `.set()` them anywhere.
 *   - `organization_domains_guard_update` (0057 section 4b): the 25 legal
 *     state edges, immutable identity/token/provenance columns, terminal
 *     freeze, the stamps, the 30-day grace, the `release_cause` evidence
 *     rules (A2) and the state-aware `next_check_at` cap. Binds BOTH
 *     connections (F44: getPlatformDb() is neondb_owner).
 *   - `organization_domains_guard_insert` (0057 section 4a): rows are created
 *     `pending` with no hold, and the race-safe cap (3 web / 1 mail
 *     non-terminal rows per org) under a per-org advisory lock.
 *   - `organization_domains_guard_delete` (0057 section 4c): never deleted
 *     except by the fixture-teardown cascade.
 *   - The serving predicate `presby_org_serving_canonical_host()` (owner
 *     only) and the anonymous reads `presby_published_site()` /
 *     `presby_published_site_by_host()` (0057 section 6).
 *
 * WRITES: only src/lib/domains/service.ts may `.insert()` or `.update()` this
 * table (A4); src/lib/domains/service-only-writes.test.ts enforces it.
 */

export const ORGANIZATION_DOMAIN_PURPOSES = ["web", "mail"] as const;
export type OrganizationDomainPurpose = (typeof ORGANIZATION_DOMAIN_PURPOSES)[number];

export const ORGANIZATION_DOMAIN_WEB_ROLES = ["canonical", "alias"] as const;
export type OrganizationDomainWebRole = (typeof ORGANIZATION_DOMAIN_WEB_ROLES)[number];

export const ORGANIZATION_DOMAIN_STATES = [
  "pending",
  "verified",
  "attach_pending",
  "attached",
  "live",
  "lapsed",
  "parked",
  "release_pending",
  "released",
  "expired",
] as const;
export type OrganizationDomainState = (typeof ORGANIZATION_DOMAIN_STATES)[number];

/** The states `organization_domains_hostname_holding_uq` covers: first to VERIFY wins, across orgs. */
export const ORGANIZATION_DOMAIN_HOLDING_STATES = [
  "verified",
  "attach_pending",
  "attached",
  "live",
  "lapsed",
  "parked",
  "release_pending",
] as const satisfies readonly OrganizationDomainState[];

/** Frozen by the update guard. Everything else is "non-terminal" (the cap, the per-org uniques). */
export const ORGANIZATION_DOMAIN_TERMINAL_STATES = [
  "released",
  "expired",
] as const satisfies readonly OrganizationDomainState[];

export const ORGANIZATION_DOMAIN_RELEASE_CAUSES = [
  "removed",
  "lapsed_grace",
  "force_released",
  "evicted",
  "org_closed",
] as const;
export type OrganizationDomainReleaseCause = (typeof ORGANIZATION_DOMAIN_RELEASE_CAUSES)[number];

export const ORGANIZATION_DOMAIN_PLATFORM_HOLDS = ["paused", "disputed"] as const;
export type OrganizationDomainPlatformHold = (typeof ORGANIZATION_DOMAIN_PLATFORM_HOLDS)[number];

export const ORGANIZATION_DOMAIN_CHECK_CLASSES = [
  "ok",
  "dns_unknown",
  "proof_absent",
  "routing_wrong",
  "held_elsewhere",
  "provider_unavailable",
  "provider_rejected",
  "rate_limited",
  "config_error",
] as const;
export type OrganizationDomainCheckClass = (typeof ORGANIZATION_DOMAIN_CHECK_CLASSES)[number];

export const ORGANIZATION_DOMAIN_CREATED_VIA = ["tenant", "platform"] as const;
export type OrganizationDomainCreatedVia = (typeof ORGANIZATION_DOMAIN_CREATED_VIA)[number];

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

// The host-shape regex, identical in 0057's two shape CHECKs.
const HOST_LABELS_RE =
  "^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$";

export const organizationDomains = pgTable(
  "organization_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Cascade reachable only through D10's guarded fixture teardown.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // IMMUTABLE (trigger). 'web' | 'mail' (T3).
    purpose: text("purpose").$type<OrganizationDomainPurpose>().notNull().default("web"),
    // IMMUTABLE. Lowercase punycode; a lookup key, never an identity.
    hostname: text("hostname").notNull(),
    // IMMUTABLE. What the admin typed; hostname = claimName or www.<claimName>.
    claimName: text("claim_name").notNull(),
    // Non-null iff purpose = 'web'. One canonical per org (partial unique).
    webRole: text("web_role").$type<OrganizationDomainWebRole>(),
    // Trigger-guarded: only the 25 legal edges (0057 section 4b).
    state: text("state").$type<OrganizationDomainState>().notNull().default("pending"),
    // TRIGGER-OWNED. Stamped on every state change.
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true }).notNull().defaultNow(),
    // IMMUTABLE. randomBytes(24).toString('base64url'); shared by a claim group.
    proofToken: text("proof_token").notNull(),
    // TRIGGER-OWNED. Stamped on every edge entering verified.
    proofVerifiedAt: timestamp("proof_verified_at", { withTimezone: true }),
    proofLastOkAt: timestamp("proof_last_ok_at", { withTimezone: true }),
    // Consecutive definitive-absent observations.
    proofMissCount: integer("proof_miss_count").notNull().default(0),
    // Consecutive definitive-negative HTTPS probes.
    probeMissCount: integer("probe_miss_count").notNull().default(0),
    // IMMUTABLE. Governs pending -> expired. Tests backdate it only through
    // e2e/support/domains-fixture.ts backdateDomainClock().
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`(now() + interval '7 days')`),
    // TRIGGER-OWNED (A1): now() + 30 days on entering lapsed/parked (lapsed ->
    // parked keeps it), null on entering verified.
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    // TRIGGER-OWNED. Stamped on attach_pending -> attached.
    attachedAt: timestamp("attached_at", { withTimezone: true }),
    // TRIGGER-OWNED. Stamped on every edge entering live.
    liveAt: timestamp("live_at", { withTimezone: true }),
    // OWNER-ONLY (T2). 'paused' | 'disputed'; serving requires null.
    platformHold: text("platform_hold").$type<OrganizationDomainPlatformHold>(),
    // OWNER-ONLY.
    holdReason: text("hold_reason"),
    // OWNER-ONLY. The evidence force_released / evicted key on (A2); written
    // only on the force-release edge itself.
    forceReleaseReason: text("force_release_reason"),
    // TRIGGER-OWNED. Stamped on entering released.
    releasedAt: timestamp("released_at", { withTimezone: true }),
    // Tenant-writable, but evidence-bound by the trigger (A2).
    releaseCause: text("release_cause").$type<OrganizationDomainReleaseCause>(),
    // Cron driver. Trigger-capped at now() + 6 h (24 h while parked).
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckClass: text("last_check_class").$type<OrganizationDomainCheckClass>(),
    // Last per-record statuses the checklist renders without re-querying DNS.
    observation: jsonb("observation").$type<Record<string, unknown>>().notNull().default({}),
    // Vercel's own verification[] TXT, when the domain is in another Vercel account.
    providerChallenge: jsonb("provider_challenge").$type<unknown>(),
    // Sorted NS set at first verification; a later mismatch only notifies.
    nsFingerprint: text("ns_fingerprint"),
    // Which warning emails were sent this episode.
    notifyState: jsonb("notify_state").$type<Record<string, unknown>>().notNull().default({}),
    // IMMUTABLE. 'tenant' | 'platform' (Q2 on-behalf web claims).
    createdVia: text("created_via").$type<OrganizationDomainCreatedVia>().notNull(),
    // IMMUTABLE.
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // The guard stamps it on every insert and update regardless.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Composite Tenant Keys (F2): the target of 0058's mail-domain FK.
    unique("organization_domains_id_org_key").on(t.id, t.organizationId),

    // The cross-org fact (DECISION-180, G3/A12): first to verify wins.
    uniqueIndex("organization_domains_hostname_holding_uq")
      .on(t.hostname, t.purpose)
      .where(sql`${t.state} in (${sqlList(ORGANIZATION_DOMAIN_HOLDING_STATES)})`),
    uniqueIndex("organization_domains_org_host_uq")
      .on(t.organizationId, t.hostname, t.purpose)
      .where(sql`${t.state} not in (${sqlList(ORGANIZATION_DOMAIN_TERMINAL_STATES)})`),
    uniqueIndex("organization_domains_one_canonical_uq")
      .on(t.organizationId)
      .where(
        sql`${t.webRole} = 'canonical' and ${t.state} not in (${sqlList(ORGANIZATION_DOMAIN_TERMINAL_STATES)})`,
      ),
    index("organization_domains_due_ix")
      .on(t.nextCheckAt)
      .where(sql`${t.state} not in (${sqlList(ORGANIZATION_DOMAIN_TERMINAL_STATES)})`),
    index("organization_domains_org_ix").on(t.organizationId, t.state),

    check("organization_domains_purpose_allowed", sql`${t.purpose} in (${sqlList(ORGANIZATION_DOMAIN_PURPOSES)})`),
    check(
      "organization_domains_hostname_shape",
      sql`${t.hostname} = lower(${t.hostname}) and char_length(${t.hostname}) <= 253 and ${t.hostname} ~ ${sql.raw(`'${HOST_LABELS_RE}'`)} and ${t.hostname} !~ '\\.[0-9]+$' and ${t.hostname} <> 'vercel.app' and ${t.hostname} not like '%.vercel.app' and ${t.hostname} not like '%.localhost'`,
    ),
    check(
      "organization_domains_claim_name_shape",
      sql`${t.claimName} = lower(${t.claimName}) and char_length(${t.claimName}) <= 253 and ${t.claimName} ~ ${sql.raw(`'${HOST_LABELS_RE}'`)} and ${t.claimName} !~ '\\.[0-9]+$' and ${t.claimName} <> 'vercel.app' and ${t.claimName} not like '%.vercel.app' and ${t.claimName} not like '%.localhost'`,
    ),
    check(
      "organization_domains_host_in_claim",
      sql`${t.hostname} = ${t.claimName} or ${t.hostname} = 'www.' || ${t.claimName}`,
    ),
    check("organization_domains_web_role_allowed", sql`${t.webRole} in (${sqlList(ORGANIZATION_DOMAIN_WEB_ROLES)})`),
    check("organization_domains_web_role_iff_web", sql`(${t.purpose} = 'web') = (${t.webRole} is not null)`),
    check("organization_domains_state_allowed", sql`${t.state} in (${sqlList(ORGANIZATION_DOMAIN_STATES)})`),
    check("organization_domains_proof_token_shape", sql`${t.proofToken} ~ '^[A-Za-z0-9_-]{32,128}$'`),
    check(
      "organization_domains_counts_nonnegative",
      sql`${t.proofMissCount} >= 0 and ${t.probeMissCount} >= 0`,
    ),
    check(
      "organization_domains_platform_hold_allowed",
      sql`${t.platformHold} in (${sqlList(ORGANIZATION_DOMAIN_PLATFORM_HOLDS)})`,
    ),
    check(
      "organization_domains_reasons_shape",
      sql`(${t.holdReason} is null or char_length(btrim(${t.holdReason})) between 1 and 500) and (${t.forceReleaseReason} is null or char_length(btrim(${t.forceReleaseReason})) between 1 and 500)`,
    ),
    check(
      "organization_domains_release_cause_allowed",
      sql`${t.releaseCause} in (${sqlList(ORGANIZATION_DOMAIN_RELEASE_CAUSES)})`,
    ),
    check(
      "organization_domains_last_check_class_allowed",
      sql`${t.lastCheckClass} in (${sqlList(ORGANIZATION_DOMAIN_CHECK_CLASSES)})`,
    ),
    check(
      "organization_domains_created_via_allowed",
      sql`${t.createdVia} in (${sqlList(ORGANIZATION_DOMAIN_CREATED_VIA)})`,
    ),
    check(
      "organization_domains_jsonb_shape",
      sql`jsonb_typeof(${t.observation}) = 'object' and jsonb_typeof(${t.notifyState}) = 'object' and (${t.providerChallenge} is null or jsonb_typeof(${t.providerChallenge}) in ('object', 'array'))`,
    ),
    check(
      "organization_domains_verified_stamped",
      sql`${t.state} not in ('verified', 'attach_pending', 'attached', 'live') or ${t.proofVerifiedAt} is not null`,
    ),
    check(
      "organization_domains_attached_stamped",
      sql`${t.state} not in ('attached', 'live') or ${t.attachedAt} is not null`,
    ),
    check("organization_domains_live_stamped", sql`${t.state} <> 'live' or ${t.liveAt} is not null`),
    check(
      "organization_domains_grace_stamped",
      sql`${t.state} not in ('lapsed', 'parked') or ${t.graceEndsAt} is not null`,
    ),
    check("organization_domains_released_stamped", sql`${t.state} <> 'released' or ${t.releasedAt} is not null`),
    check(
      "organization_domains_release_has_cause",
      sql`${t.state} not in ('release_pending', 'released') or ${t.releaseCause} is not null`,
    ),
  ],
);

export type OrganizationDomain = typeof organizationDomains.$inferSelect;
