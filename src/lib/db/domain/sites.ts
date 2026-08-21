import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  time,
  smallint,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * Public organization websites. See docs/work-log/2026-08-20-public-sites.md
 * Phase 3 "Data Model", DECISION-081/083/088/089, and
 * docs/work-log/2026-08-21-public-site-org-profile.md Phase 3 "Data Model",
 * DECISION-090/091/092.
 *
 * Four tables, deliberately asymmetric in who can touch them:
 *
 *   organization_sites          Per-org provisioning/status (DECISION-081),
 *                                shaped like `organization_brands` —
 *                                degenerate PK (organization_id itself),
 *                                FORCE RLS, NO public grant AND no
 *                                `presby_app` table grant either. Written
 *                                only through `getPlatformDb()` (admin
 *                                provisioning, OIDC-verified ingest — both
 *                                "verified, no membership" callers). The
 *                                ONLY `presby_app` access is through the
 *                                `presby_published_site()` SECURITY DEFINER
 *                                function
 *                                (drizzle/0020_presby_public_sites.sql,
 *                                widened by
 *                                drizzle/0021_presby_site_profile.sql),
 *                                which collapses every non-live reason into
 *                                the same zero-row result.
 *   site_contact_messages       Genuine composite-key tenant table
 *                                (DECISION-083), shaped like
 *                                `congregation_feedback`/`ticket_messages`.
 *                                `presby_app` gets select/insert/update —
 *                                insert is the anonymous ContactForm write
 *                                (trusted-org-context, gated on
 *                                `organization_sites.status = 'live'`,
 *                                never `withOrgContext()`'s membership
 *                                check, since the writer has no
 *                                membership); select/update back the
 *                                `/o/<slug>/tickets` review section
 *                                (DECISION-089 — `tickets.file`, no new
 *                                tenant permission, no platform-side triage
 *                                surface).
 *   organization_profiles       Public-site profile data — address, phone,
 *                                five fixed social-link columns
 *                                (DECISION-090). Shaped like
 *                                `organization_brands`, NOT
 *                                `organization_sites`: degenerate PK
 *                                (organization_id itself), FORCE RLS, and a
 *                                full standard `presby_app` grant declared
 *                                now, forward-looking — the tenant-editor
 *                                follow-up is deferred but real (tracked in
 *                                docs/TODO.md), the same already-scoped
 *                                shape that earned `organization_brands`
 *                                its own forward-looking grant.
 *   organization_service_times  Structured, publish-facing regular service
 *                                times AND office hours, distinguished by a
 *                                `kind` column (DECISION-091) — a genuine
 *                                child table, not a JSONB array, so
 *                                day_of_week/start_time/end_time carry real
 *                                CHECK constraints. Composite tenant key
 *                                kept for consistency (Composite Tenant
 *                                Keys convention) even with no current
 *                                composite-FK consumer, matching
 *                                `site_contact_messages`' own precedent.
 *
 * RLS policies, grants, `presby_published_site()`, and the `blob_assets`
 * `application/json` widening (DECISION-088) live in
 * drizzle/0020_presby_public_sites.sql and
 * drizzle/0021_presby_site_profile.sql, not here — this file is schema only
 * (DECISION-061's convention: db/domain/*.ts holds pgTable definitions;
 * query/business logic lives one level up in src/lib/sites.ts).
 */

// ---------------------------------------------------------------------------
// organization_sites
// ---------------------------------------------------------------------------

export const organizationSites = pgTable(
  "organization_sites",
  {
    // Degenerate PK — one row per org, matching organization_brands. Stated
    // explicitly per the architect's own instruction on organization_brands
    // ("or the next reviewer 'fixes' it") — this is deliberate, not an
    // oversight.
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // "org/site-<slug>" — matched exactly against the GitHub Actions OIDC
    // token's `repository` claim by resolveOrganizationByRepo().
    repo: text("repo").notNull().unique(),
    // 'provisioning' | 'live' | 'suspended'.
    status: text("status").notNull().default("provisioning"),
    lastIngestedCommitSha: text("last_ingested_commit_sha"),
    lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
    // Composite-FK-by-convention -> blob_assets(id, organization_id) — NOT
    // expressible as a Drizzle foreignKey() here: doing so would require
    // this file to import assets.ts AND assets.ts to import this file's
    // organizationSites export back, the same circular-module-dependency
    // problem assets.ts's own comment documents for organization_brands.
    // Enforced in the migration only.
    contentBundleKey: uuid("content_bundle_key"),
    // NULLABLE, unlike organization_brands.updatedBy: machine ingest writes
    // (recordSiteIngest) have no users.id to attribute — NULL there, set on
    // admin-initiated provision/status-change writes.
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "organization_sites_status_allowed",
      sql`${t.status} in ('provisioning','live','suspended')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// site_contact_messages
// ---------------------------------------------------------------------------

export const siteContactMessages = pgTable(
  "site_contact_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // visitor-supplied
    email: text("email").notNull(), // visitor-supplied, for a role-holder to reply out-of-band
    body: text("body").notNull(),
    // 'new' | 'read'.
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite-tenant-key convention (docs/schema-design.md sec 3), kept
    // for consistency even though nothing composite-FKs into this table
    // today — organization_brand_history's own precedent ("kept for
    // consistency even though nothing composite-FKs into this table today")
    // is the exact shape to follow.
    unique("site_contact_messages_id_org_key").on(t.id, t.organizationId),
    // The tenant review queue (listSiteContactMessages).
    index("site_contact_messages_org_status_created_idx").on(
      t.organizationId,
      t.status,
      t.createdAt,
    ),
    check(
      "site_contact_messages_status_allowed",
      sql`${t.status} in ('new','read')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// organization_profiles (DECISION-090)
// ---------------------------------------------------------------------------

export const organizationProfiles = pgTable("organization_profiles", {
  // Degenerate PK — one row per org, matching organization_brands.
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Single free-text line (Phase 1 Q4) — URL-encoded into a maps deep link
  // by the reading component; no structured/geocoded shape.
  address: text("address"),
  // Free text — no format CHECK (international formats vary; app-level
  // max-length only, per site_contact_messages.body's own precedent).
  phone: text("phone"),
  // Five fixed nullable columns (Phase 1 Q3 / D8) — no open key-value
  // social-links store.
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  xTwitterUrl: text("x_twitter_url"),
  youtubeUrl: text("youtube_url"),
  otherUrl: text("other_url"),
  // Always human-attributed — no machine writer exists for this table
  // (unlike organizationSites.updatedBy, nullable for ingest).
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => users.id),
  // No createdAt column — matches organization_brands' own precedent
  // exactly (first updatedAt IS the creation event). No history table
  // (resolved Q6).
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// organization_service_times (DECISION-091)
// ---------------------------------------------------------------------------

export const organizationServiceTimes = pgTable(
  "organization_service_times",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // 'service' | 'office_hours' — one child table for both, per the
    // user's own resolution of the architect's open question (Phase 2).
    kind: text("kind").notNull(),
    // 0=Sunday..6=Saturday, matching JS Date.getDay() — stated here so
    // presby-site-kit never has to guess the convention.
    dayOfWeek: smallint("day_of_week").notNull(),
    // No time zone — a congregation's own wall-clock time, not a UTC
    // instant; there is no date component, so no DST math applies.
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    // Nullable — e.g. "Traditional", "Contemporary (Spanish)", "Front
    // office". App-level max length only.
    label: text("label"),
    // Per-row attribution — cheap to keep even under whole-list replace
    // (DECISION-092), and answers "who set the 10:15 service" without a
    // join to organizationProfiles, which may never have been touched if
    // only service times were ever edited.
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    // Composite-tenant-key convention (docs/schema-design.md sec 3), kept
    // for consistency even though nothing composite-FKs into this table
    // today — site_contact_messages' own precedent is the exact shape to
    // follow.
    unique("organization_service_times_id_org_key").on(
      t.id,
      t.organizationId,
    ),
    // Backs both the admin list read (listOrganizationServiceTimes) and
    // the jsonb_agg subquery's ORDER BY inside presby_published_site().
    index("organization_service_times_org_kind_idx").on(
      t.organizationId,
      t.kind,
      t.dayOfWeek,
      t.startTime,
    ),
    check(
      "organization_service_times_kind_allowed",
      sql`${t.kind} in ('service','office_hours')`,
    ),
    check(
      "organization_service_times_day_of_week_bounds",
      sql`${t.dayOfWeek} between 0 and 6`,
    ),
    // Per-row ordering only — cross-row overlap is deliberately NOT
    // validated (Phase 3 Edge Cases: a congregation may legitimately run
    // two simultaneous services). No overnight/cross-midnight rows in v1
    // — `time` has no date component, so this also rejects a service
    // spanning midnight; an admin works around it with two rows.
    check(
      "organization_service_times_end_after_start",
      sql`${t.endTime} > ${t.startTime}`,
    ),
  ],
);
