import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  boolean,
  check,
  date,
  text,
  uuid,
  uniqueIndex,
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
    // The pre-provisioning status column (F35). Its conceptual successor is
    // `lifecycleStatus` below, but it is NOT dropped: five shipped
    // SECURITY DEFINER functions gate an anonymous public read on
    // `o.status = 'active'` (drizzle/0020, 0021, 0024, 0041, 0042), and
    // Postgres records no column dependency inside a function body — the
    // DROP would succeed and every public site would fail at request time.
    // See drizzle/0043's header; the removal is its own scoped change.
    status: text("status").notNull().default("active"),
    // D10. A CACHE of the most recent `organization_lifecycle_events` row,
    // maintained by `presby_apply_lifecycle_event()`. It cannot answer a
    // historical question — the events table is the record. Values:
    // active | merged | divided | dismissed | dissolved.
    lifecycleStatus: text("lifecycle_status").notNull().default("active"),
    lifecycleAsOf: date("lifecycle_as_of"),
    // TEST FIXTURES ONLY. `presby_guard_organizations_delete()` permits a
    // DELETE only while this is non-null and in the future, so a stale
    // marker never grants permanent deletability. Deliberately NOT folded
    // into `platformStatus`: that column answers D9's tenant-participation
    // question, and mixing a test-lifecycle concern into it would change the
    // meaning of every `platform_status` query in `presby_user_organizations()`
    // and the org chooser.
    deletableUntil: timestamp("deletable_until", { withTimezone: true }),
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
  // `pcusaPin` moved to `organizationIdentifiers` (kind = 'pcusa_pin') in
  // drizzle/0043 — D24. It could not stay here: this table IS tenant-
  // isolated, so the presbytery running an import could not read a
  // congregation's own OGA church PIN, the identifier a cross-council
  // importer needs most.
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
 * External identifiers for an organization — OGA church PIN, psvonline
 * congregation id, church360, legacy import keys (D24, drizzle/0043).
 *
 * `kind = 'legacy_import'` IS NOT `organizationNameHistory.nameType =
 * 'legacy_import_name'` (D14, drizzle/0053, forty lines below). This column
 * maps an external IDENTIFIER — psvonline's internal congregation id, say.
 * That one records a dirty NAME STRING seen in a source document, kept only
 * so an importer has somewhere to put a matching string without implying it
 * was ever official. The names are confusingly similar and the mechanisms are
 * unrelated; do not "helpfully" merge them (Phase 1 Gap 5 of
 * `docs/work-log/2026-09-26-name-history-import-staging.md`).
 *
 * Deliberately NOT tenant-isolated, and that is the whole reason it exists:
 * `pcusaPin` used to live on `organizationSettings`, which carries the
 * standard tenant policy, so a presbytery running an import could not read a
 * member congregation's own PIN. This table is identity data about a public
 * org-tree entry — the same visibility class as `organizations` itself
 * (docs/schema-design.md sec 17).
 *
 * `organizationId` is a PLAIN FK and is NOT a tenant scope: it is the "which
 * organization" column, the structural exception `congregationOversight.
 * aboutOrgId` already takes. There is no tenant column here to compose a
 * composite key against (F2).
 *
 * The unique index is PARTIAL — only VERIFIED identifiers are globally
 * unique. An unverified import candidate may legitimately collide with a
 * verified row; that collision is what the resolution step exists to settle.
 *
 * THE WRITE-AUTHORITY MODEL IS NOT EXPRESSIBLE HERE and lives in
 * `drizzle/0043` (F47/DECISION-140). Stated so a reader does not mistake the
 * absence of RLS for the absence of any rule:
 *
 *   - `presby_app` holds `SELECT` ONLY. The first build granted it full DML
 *     with no RLS, which let any tenant connection rewrite or erase ANOTHER
 *     organization's identifier — including flipping `isVerified`, the column
 *     the partial index above makes globally significant.
 *   - `presby_set_organization_identifier()` (SECURITY DEFINER) is the sole
 *     tenant-side writer, in this pipeline's confused-deputy shape: no
 *     acting-council parameter, the actor is `presby_current_org()`, and
 *     standing is either "the actor IS the subject" or
 *     `presby_org_affiliated(subject, actor, today)` — the onboarding case
 *     where a council records a member congregation's OGA PIN. It upserts on
 *     `(organizationId, kind, valueNormalized)` and is the only path through
 *     which `isVerified` may be set. Rejections raise ONE literal per table
 *     (DECISION-139) via `presby_deny_identifier_change()`.
 *   - `organization_identifiers_guard` (BEFORE INSERT OR UPDATE OR DELETE)
 *     refuses all three unless the transaction-local GUC
 *     `presby.identifier_trigger_active` is set, which only that function and
 *     `presby_guard_organizations_delete()` (pre-authorizing the
 *     fixture-teardown cascade) ever do. The revoke alone does not close
 *     this: `PLATFORM_DATABASE_URL` connects as `neondb_owner`, which owns
 *     the table and holds every privilege by ownership (F44).
 *   - INSERT JOINED THAT LIST 2026-09-24 (F58/DECISION-141), reversing the
 *     residual this comment previously recorded ("INSERT is deliberately left
 *     ungated beyond the grant"). Creation of an identifier claim is as much
 *     an authorized act as changing one, and the widening cost nothing: the
 *     sole sanctioned writer already armed the GUC at entry, before both its
 *     INSERT and its UPDATE branch. The partial unique index still refuses a
 *     COLLIDING verified insert; the two layers are independent.
 */
export const organizationIdentifiers = pgTable(
  "organization_identifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // pcusa_pin | psvonline_congregation_id | church360 | legacy_import
    kind: text("kind").notNull(),
    valueNormalized: text("value_normalized").notNull(),
    isVerified: boolean("is_verified").notNull().default(false),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("organization_identifiers_kind_value_verified_idx")
      .on(t.kind, t.valueNormalized)
      .where(sql`${t.isVerified}`),
    index("organization_identifiers_org_idx").on(t.organizationId),
  ],
);

/**
 * DATED, TYPED, CITY-QUALIFIED NAMES for an organization (D14/F37, increment
 * 7, `drizzle/0053_presby_name_history_import_staging.sql`). "A name AT A
 * PLACE is the matching unit" (F33): this is what lets a future import ask
 * "who was called this, where, in what year," and what lets a historical
 * report render a congregation under the name it actually held that year.
 *
 * Here beside `organizationIdentifiers` rather than in `lifecycle.ts`, on a
 * reason rather than by default (Phase 2 placement ruling): identifiers and
 * names are both ALTERNATE KEYS for the same body, both council-written, and
 * both exist for import matching. `lifecycle.ts` stays the home of the
 * three-axis EVENT tables. Co-location is also what keeps the
 * `legacy_import` / `legacy_import_name` cross-reference forty lines away
 * instead of in another file — see `organizationIdentifiers`' header.
 *
 * THE D26 ABOUT-ORG SHAPE: `organizationId` is the ACTING council and the
 * tenant scope; `subjectOrgId` is the body the name describes, a PLAIN FK by
 * `docs/schema-design.md` sec 17's structural exception (organization ids are
 * public). Unlike `organizationLifecycleEvents`, THE TWO MAY BE EQUAL and
 * there is deliberately no `not_self` CHECK: `organizationId =
 * subjectOrgId` is the canonical-self case (every backfilled row), `<>` is
 * the about-org case.
 *
 * ALMOST NONE OF THE ENFORCEMENT IS EXPRESSIBLE HERE. `drizzle/0053` is the
 * ground truth; stated so a reader does not mistake absence for permission:
 *
 *   - `FORCE ROW LEVEL SECURITY` + `tenant_isolation` on
 *     `presby_current_org()`. Without FORCE the owner bypasses every policy
 *     and RLS is silently inert (F1).
 *   - THE GRANT SHAPE IS HALF THE MODEL, and it is the opposite of the two
 *     staging tables in `./imports`: `presby_app` holds **SELECT only**.
 *     `organization_name_history_canonical_no_overlap` — a partial GiST
 *     EXCLUDE over `(subject_org_id, daterange(effective_from, effective_to,
 *     '[)')) where name_type = 'canonical'` — is keyed on the PUBLIC
 *     `subject_org_id`, and a unique/EXCLUDE constraint is enforced against
 *     ALL rows, not the RLS-visible subset (F40). So with ordinary tenant DML
 *     any presbytery could probe an insert naming any org id and learn from
 *     the constraint-violation error whether a council it cannot see has
 *     recorded a canonical name for that body in that window. Writes are
 *     therefore FUNCTION-MEDIATED (F103/DECISION-153). `presby_platform` is
 *     narrowed to `select, insert` — the 0044 narrowing.
 *   - Drizzle has no EXCLUDE builder, so the constraint above exists only in
 *     the migration. What it MEANS: a rename CLOSES the canonical row and
 *     OPENS a new one; the old name is never additionally duplicated as a
 *     `former_name`, so "what was this body called in 1987?" has exactly one
 *     answer. The other four types are assertions ABOUT the body and may
 *     overlap each other and the canonical succession freely.
 *   - `nameNormalized` / `cityNormalized` are GENERATED columns computed by
 *     `presby_normalize_org_match_text()`, the same expression
 *     `presby_match_organization()` applies to its inputs (F101). Never
 *     hand-set.
 *   - THE SOLE WRITER THIS INCREMENT IS THE MIGRATION'S OWN BACKFILL, which
 *     mints one open `canonical` row per organization with `authority =
 *     'backfill'`, `organizationId = subjectOrgId` and `city = null` (no
 *     address text-parsing: a wrongly parsed city is worse than a missing one
 *     when city is the disambiguator). `presby_record_org_name()` — SECURITY
 *     DEFINER, standing tested by affiliation-AS-OF and never by
 *     current-parent — is deferred to the lifecycle-UI pipeline alongside
 *     `presby_organize_congregation()`.
 */
export const organizationNameHistory = pgTable(
  "organization_name_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The ACTING council, and the tenant scope. MAY equal `subjectOrgId`. */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** The body the name describes. Plain FK, sec 17's structural exception. */
    subjectOrgId: uuid("subject_org_id")
      .notNull()
      .references(() => organizations.id),
    /**
     * canonical | former_name | historical_name | abbreviation |
     * legacy_import_name. See `NameType` below for what each one means.
     */
    nameType: text("name_type").notNull(),
    name: text("name").notNull(),
    /**
     * Null on every backfilled row, permanently and on purpose:
     * `organizationProfiles.address` is one free-text line with no structured
     * city, and city is exactly the disambiguator F33 relies on. There is
     * deliberately no "canonical requires city" CHECK.
     */
    city: text("city"),
    /** NOT a validated code set — historical and non-US forms exist. */
    state: text("state"),
    /** GENERATED. `presby_normalize_org_match_text(name)` — never hand-set. */
    nameNormalized: text("name_normalized").generatedAlwaysAs(
      sql`presby_normalize_org_match_text(name)`,
    ),
    /** GENERATED. `presby_normalize_org_match_text(city)` — never hand-set. */
    cityNormalized: text("city_normalized").generatedAlwaysAs(
      sql`presby_normalize_org_match_text(city)`,
    ),
    /** Null = unbounded below ("predates our records"), the F41 convention. */
    effectiveFrom: date("effective_from"),
    /** Null = still in force. */
    effectiveTo: date("effective_to"),
    /** recorded | backfill. A minute-less row can only ever be an inferred one. */
    authority: text("authority").notNull().default("recorded"),
    minuteReference: text("minute_reference"),
    notes: text("notes"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("organization_name_history_id_org_key").on(t.id, t.organizationId),
    index("organization_name_history_normalized_idx").on(
      t.nameNormalized,
      t.cityNormalized,
    ),
    index("organization_name_history_subject_type_idx").on(
      t.subjectOrgId,
      t.nameType,
      t.effectiveFrom,
    ),
    index("organization_name_history_org_idx").on(t.organizationId),
    check(
      "organization_name_history_name_type_allowed",
      sql`${t.nameType} in ('canonical','former_name','historical_name','abbreviation','legacy_import_name')`,
    ),
    check(
      "organization_name_history_authority_allowed",
      sql`${t.authority} in ('recorded','backfill')`,
    ),
    /**
     * A CLAIM OF OFFICIALITY requires a minute unless the row is honestly
     * marked as an inference. The three matching aids require nothing —
     * demanding a minute for them would either block the import this table
     * exists to enable, or produce invented minute strings. This is what
     * gives the type vocabulary teeth: if you cannot cite a minute, the type
     * you want is `historical_name` or `legacy_import_name`, not
     * `former_name`.
     */
    check(
      "organization_name_history_minute_shape",
      sql`${t.nameType} not in ('canonical','former_name')
          or ${t.authority} = 'backfill'
          or ${t.minuteReference} is not null`,
    ),
    /** The empty-range loophole (F49), closed the same way one table over. */
    check(
      "organization_name_history_range_order",
      sql`${t.effectiveTo} is null or ${t.effectiveFrom} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    check(
      "organization_name_history_name_shape",
      sql`char_length(btrim(${t.name})) between 1 and 255`,
    ),
    check(
      "organization_name_history_city_shape",
      sql`${t.city} is null or char_length(btrim(${t.city})) between 1 and 120`,
    ),
    check(
      "organization_name_history_state_shape",
      sql`${t.state} is null or char_length(btrim(${t.state})) <= 64`,
    ),
    // organization_name_history_canonical_no_overlap (the partial GiST
    // EXCLUDE) is in drizzle/0053 ONLY — Drizzle has no EXCLUDE builder. It
    // is the constraint that makes "the name in force in year Y" a
    // single-valued question, and the one that puts this whole table under
    // the function-mediation rule (F40/F103). See this table's header.
  ],
);

/**
 * The five `name_type` values, as a TypeScript union, and what each one
 * CLAIMS — the vocabulary is load-bearing, not decorative:
 *
 *   `canonical`          the name officially borne, for this interval.
 *                        Exactly one per instant, by EXCLUDE.
 *   `former_name`        asserted to have been official, but the canonical
 *                        interval cannot be reconstructed.
 *   `historical_name`    known by; never official.
 *   `abbreviation`       a short form.
 *   `legacy_import_name` a dirty matching string from a source document,
 *                        CARRYING NO CLAIM that it was ever used.
 */
export type NameType =
  | "canonical"
  | "former_name"
  | "historical_name"
  | "abbreviation"
  | "legacy_import_name";

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
 *
 * `lightOnly` (drizzle/0023_presby_brand_light_only.sql,
 * docs/work-log/2026-08-24-light-only-brand.md): opts this org's brand out
 * of dark mode entirely. See the column's own comment below.
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
  // Per-Organization Light-Only Brand Mode
  // (docs/work-log/2026-08-24-light-only-brand.md). When true, this org's
  // public site and member portal never render the dark theme, regardless
  // of visitor system preference — a deliberate, narrow exception to
  // DECISION-050 ("the brand style element always emits both ramps"): both
  // ramps still get generated/stored, this only stops `.dark` from ever
  // being SELECTED for the org's pages. Enforced in
  // src/components/brand/brand-tokens.tsx (out of scope for this file) by
  // widening its existing `:root:root.dark` emission block to also
  // re-declare the platform-fixed tokens at their light values. Default
  // false, so every existing brand keeps today's behavior.
  lightOnly: boolean("light_only").notNull().default(false),
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
