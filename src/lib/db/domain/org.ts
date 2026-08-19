import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  boolean,
  check,
  text,
  uuid,
  timestamp,
  jsonb,
  integer,
  index,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "../schema";

/**
 * The ecclesiastical hierarchy. See docs/schema-design.md section A.
 *
 * `organizations` is deliberately NOT tenant-isolated: the org tree is public
 * information (PC(USA) publishes congregation and presbytery lists). Anything
 * sensitive lives in `organizationSettings`, which carries the standard policy.
 */
export const organizationType = pgEnum("organization_type", [
  "general_assembly",
  "synod",
  "presbytery",
  "congregation",
  "new_worshiping_community",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id").references((): AnyPgColumn => organizations.id),
    organizationType: organizationType("organization_type").notNull(),
    name: text("name").notNull(),
    // The URL segment in /o/<slug>, and (P5) the platform subdomain label
    // <slug>.presby.app. IMMUTABLE: renaming a congregation changes `name`,
    // never `slug` — the slug lives in bookmarks, in printed bulletin inserts,
    // and in a DNS record, so a slug that follows the name breaks all three at
    // once. A slug that genuinely must change (merger, schism, a typo at
    // onboarding) gets a future `organization_slug_aliases` table serving 301s,
    // not an UPDATE. Format is constrained below.
    slug: text("slug").notNull().unique(),
    // Materialized ancestry, trigger-maintained. Migrated to `ltree` in SQL so
    // "every congregation under this presbytery" is an index scan, not a
    // recursive CTE on every request.
    path: text("path").notNull(),
    status: text("status").notNull().default("active"),
    // D9. Most congregations in a presbytery will NOT be tenants, so the
    // presbytery's launch-day job is managing data about churches that are not
    // on the platform.
    //
    //   managed    a real tenant. Invariant 2 applies in full: the parent
    //              council gets nothing from inside except by publication,
    //              commission, or session-granted delegation.
    //   unmanaged  in the hierarchy but not a tenant. Records are STEWARDED by
    //              the parent council, because there is no session on the
    //              platform to grant anything.
    //   invited    onboarding; stewarded pending handover.
    //
    // Stewardship must LAPSE when an org becomes managed. A presbytery still
    // writing into a church's records after that church joins is precisely the
    // trust failure publish-upward exists to prevent.
    platformStatus: text("platform_status").notNull().default("unmanaged"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("organizations_parent_idx").on(t.parentId),
    index("organizations_type_idx").on(t.organizationType),
    // Target of every composite tenant foreign key. See schema-design F2.
    unique("organizations_id_key").on(t.id),
    // DNS-label shaped, ≤63 chars. Declared here as well as in
    // drizzle/0014_presby_org_router.sql because schema.ts is the source of
    // truth and a CHECK is expressible in Drizzle — the migration and this
    // table must not disagree about a constraint that gates a URL.
    check(
      "organizations_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`,
    ),
  ],
);

/**
 * Per-org sensitive configuration, split out of `organizations` so the org tree
 * can stay publicly readable. Resolved in review round 1.
 */
export const organizationSettings = pgTable("organization_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Office of the General Assembly church PIN, used for SASR submission.
  pcusaPin: text("pcusa_pin"),
  // Includes sessionServesAsTrustees, hasDeacons, trackDisabilityPerPerson.
  settings: jsonb("settings").notNull().default({}),
  // Per-congregation 2FA policy. NOT a feature flag: a flag is an environment
  // toggle, this is tenant state (DECISION-003). A typed column rather than a
  // key in `settings` above, because it is read on the sign-in path and a
  // boolean deciding whether 2FA is enforced belongs to the database, not to
  // whatever last wrote the blob.
  //
  // Resolved at sign-in by presby_two_factor_required() and projected into the
  // session — the Edge gate reads the claim and cannot reach the database.
  // Default false, so every existing congregation keeps today's behavior.
  requireTwoFactor: boolean("require_two_factor").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Optional subdivision inside a congregation. fpcw calls these parishes;
 * elsewhere they are deacon districts, care groups, or campuses (multi-site).
 *
 * NOTE (F15): the design had `shepherd_person_id` here, which created a
 * circular composite foreign key with `people.org_unit_id`. The shepherd is
 * derived from a group instead — it was already a group concept.
 */
export const orgUnits = pgTable(
  "org_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitType: text("unit_type").notNull(), // parish | campus | district
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("org_units_org_idx").on(t.organizationId, t.unitType),
    unique("org_units_id_org_key").on(t.id, t.organizationId),
  ],
);

/**
 * Per-org brand: colour seed, logo asset keys, type pairing.
 * DECISION-049 (docs/decisions.md), full rationale in
 * docs/work-log/2026-08-19-brand-foundation.md's Phase 3 (re-run) "Data
 * model" section.
 *
 * PK is `organization_id` ITSELF — a DEGENERATE composite key. One row per
 * org, no second key to compose, so there is nothing to `unique(id,
 * organization_id)` against. Stated explicitly per the architect's
 * instruction ("or the next reviewer 'fixes' it") — this is deliberate, not
 * an oversight.
 *
 * FORCE RLS, and there is NO PUBLIC GRANT ON THIS TABLE, EVER
 * (drizzle/0016_presby_brand_storage.sql). `organizations` carries a bare
 * grant because the org tree is public information; following that pattern
 * here would make every congregation's brand readable by any authenticated
 * caller with no org context — the enumeration oracle DECISION-049 rejects by
 * name. "Follow the organizations pattern" is the wrong instinct here and
 * looks right.
 *
 * Written today exclusively through `getPlatformDb()` by the platform
 * operator at `/admin/organizations` (slice c) — no tenant self-serve editor
 * exists yet (slice d, blocked on P1's tenant permission catalog). The
 * FORCE-RLS policy and the `presby_app` grant are declared now anyway so
 * slice d needs no migration of its own to start reading/writing through
 * `withOrgContext()`.
 *
 * `markAssetKey` / `wordmarkAssetKey` -> `blob_assets(id, organization_id)`:
 * the composite FK is enforced in the migration only. See `./assets.ts`'s
 * comment on `blobAssets` for why it is not expressible here (it would
 * require a circular module dependency between this file and assets.ts).
 */
export const organizationBrands = pgTable("organization_brands", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // A7's rule ("never echo the user's string") gets database-level teeth in
  // the migration: CHECK (~ '^#[0-9a-f]{6}$'). The generator parses this into
  // numbers; nothing ever re-emits it verbatim into CSS.
  seedHex: text("seed_hex").notNull(),
  // Curated set lands in slice e (contract.ts's TYPE_PAIRINGS). No CHECK
  // enum here yet — that catalog does not exist until e0, and hard-coding one
  // now would be scope this commit doesn't own.
  typePairing: text("type_pairing").notNull().default("classic"),
  markAssetKey: uuid("mark_asset_key"),
  wordmarkAssetKey: uuid("wordmark_asset_key"),
  // D8: pinned per org so a generator improvement never silently re-skins
  // every congregation on a Tuesday with no audit row (A13).
  brandTokenVersion: integer("brand_token_version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => users.id),
});

/**
 * "Restore previous brand" needs a swatch AND a date (Flow 2), and the audit
 * story ("who made our website purple") needs more than one `previous_*`
 * column can answer — that answers exactly one restore and then loses the
 * trail. DECISION-059: rows record only `'updated'` and `'neutralized'`,
 * never `'created'`. There is nothing to restore TO from a creation event;
 * the state before a first-ever brand is the platform default, which needs
 * no row.
 */
export const organizationBrandHistory = pgTable(
  "organization_brand_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // 'updated' | 'neutralized' — CHECKed in the migration, never 'created'.
    action: text("action").notNull(),
    // Snapshot of what is ABOUT TO BE superseded, i.e. this org's brand row
    // immediately before the change captured by this history row. All
    // nullable, unlike organization_brands' own columns: a 'neutralized' row
    // may have nothing to snapshot if the org never had a prior brand.
    seedHex: text("seed_hex"),
    typePairing: text("type_pairing"),
    markAssetKey: uuid("mark_asset_key"),
    wordmarkAssetKey: uuid("wordmark_asset_key"),
    brandTokenVersion: integer("brand_token_version"),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite-tenant-key convention (docs/schema-design.md sec 3), kept for
    // consistency even though nothing composite-FKs into this table today —
    // a future restore control (slice d) is a natural consumer.
    unique("organization_brand_history_id_org_key").on(
      t.id,
      t.organizationId,
    ),
    // The restore-previous read: "the last few changes to this org's brand."
    index("organization_brand_history_org_idx").on(
      t.organizationId,
      t.changedAt,
    ),
  ],
);
