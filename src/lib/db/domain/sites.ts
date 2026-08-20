import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * Public organization websites. See docs/work-log/2026-08-20-public-sites.md
 * Phase 3 "Data Model", DECISION-081/083/088/089.
 *
 * Two tables, deliberately asymmetric in who can touch them:
 *
 *   organization_sites      Per-org provisioning/status (DECISION-081),
 *                            shaped like `organization_brands` — degenerate
 *                            PK (organization_id itself), FORCE RLS, NO
 *                            public grant AND no `presby_app` table grant
 *                            either. Written only through `getPlatformDb()`
 *                            (admin provisioning, OIDC-verified ingest —
 *                            both "verified, no membership" callers). The
 *                            ONLY `presby_app` access is through the
 *                            `presby_published_site()` SECURITY DEFINER
 *                            function (drizzle/0020_presby_public_sites.sql),
 *                            which collapses every non-live reason into the
 *                            same zero-row result.
 *   site_contact_messages   Genuine composite-key tenant table (DECISION-083),
 *                            shaped like `congregation_feedback`/
 *                            `ticket_messages`. `presby_app` gets
 *                            select/insert/update — insert is the anonymous
 *                            ContactForm write (trusted-org-context, gated
 *                            on `organization_sites.status = 'live'`, never
 *                            `withOrgContext()`'s membership check, since the
 *                            writer has no membership); select/update back
 *                            the `/o/<slug>/tickets` review section
 *                            (DECISION-089 — `tickets.file`, no new tenant
 *                            permission, no platform-side triage surface).
 *
 * RLS policies, grants, `presby_published_site()`, and the `blob_assets`
 * `application/json` widening (DECISION-088) live in
 * drizzle/0020_presby_public_sites.sql, not here — this file is schema only
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
