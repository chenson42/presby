import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  bigint,
  boolean,
  date,
  timestamp,
  check,
  unique,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * Congregation records, Increment 1 (docs/work-log/2026-11-17-congregation-
 * profile.md, Phase 2 R1/R5 and Phase 3 "Data Model"; DECISION-344, 345,
 * 349). DDL is hand-written in drizzle/0089_presby_oversight_records.sql; this
 * file is for TypeScript's benefit and the migration is the ground truth.
 *
 * Every row is THE PRESBYTERY'S OWN RECORD about a member congregation:
 * `organizationId` is the presbytery, `aboutOrgId` the congregation, and the
 * congregation sees none of it (DECISION-119/120). Tiered by table, never by
 * column (R1):
 *   - tier 1, `congregation_oversight.manage`: profiles, buildings, photos;
 *   - tier 2, `congregation_oversight.finance`: appraisals, insurance years,
 *     loans.
 * The key is checked in TypeScript inside each reader's and writer's own
 * `withOrgContext()` transaction; RLS is tenancy only.
 *
 * Writers: src/lib/oversight/store.ts (five tables) and, from Increment 2,
 * src/lib/oversight/photo-store.ts (photos). Readers: reads.ts, photo-reads.ts,
 * report-rows.ts. boundaries.test.ts pins the list (R4).
 *
 * What the table builder below cannot express, and where it is enforced:
 *   - FORCE ROW LEVEL SECURITY and the tenant_isolation policy on all six
 *     (0089 section 7);
 *   - the grant shape: presby_app SELECT, INSERT and a column-limited UPDATE,
 *     NO DELETE (all deletes are soft); presby_platform nothing (0089 section 7);
 *   - removal is one-way and the identity columns (and provenance) are
 *     immutable on EVERY connection including the owner (F44): the BEFORE
 *     INSERT OR UPDATE trigger `<table>_guard_write` ->
 *     presby_oversight_guard_write() on the five tables with a removal pair
 *     (0089 section 6b). Profiles have no removal and no guard;
 *   - no new photo, appraisal or loan link on a REMOVED building, serialized
 *     with a concurrent removal by FOR SHARE: `<table>_building_live` ->
 *     presby_oversight_building_live_guard() (0089 section 6c);
 *   - the about-org must be affiliated with the presbytery TODAY on insert
 *     (and on an update that moves about_org_id): `<table>_about_org` ->
 *     presby_check_about_org_affiliated('about_org_id', '') on profiles,
 *     buildings, insurance years and loans (0089 section 6a; 0045);
 *   - the two photo blob FKs oversight_building_photos_image_fk / _thumb_fk:
 *     (image_asset_key | thumb_asset_key, organization_id, asset_audience)
 *     -> blob_assets (id, organization_id, audience), NO ACTION, pinned to
 *     'private' by oversight_building_photos_audience_private - DDL-ONLY
 *     (0089 section 4c). assets.ts is imported by the storage adapter alone
 *     (DECISION-058), so this file does not import it;
 *     scripts/check-schema-parity.ts allowlists both FKs;
 *   - the partial unique indexes' expression `lower(name)` (declared below
 *     with sql``, matching 0089 section 5).
 *
 * No column carries a Drizzle `$onUpdate`: `updated_at`/`row_version` are
 * written explicitly by the store, and `created_at` on a tenant insert is
 * stamped by the guard.
 */

/** oversight_*_provenance. Immutable after insert. */
export const OVERSIGHT_PROVENANCES = ["presbytery_entered", "imported"] as const;
export type OversightProvenance = (typeof OVERSIGHT_PROVENANCES)[number];

/** oversight_buildings_building_type. */
export const OVERSIGHT_BUILDING_TYPES = [
  "sanctuary",
  "education_building",
  "fellowship_hall",
  "manse",
  "parsonage",
  "office",
  "vacant_land",
  "annex",
  "gymnasium",
  "other",
] as const;
export type OversightBuildingType = (typeof OVERSIGHT_BUILDING_TYPES)[number];

/** oversight_buildings_{roof,plumbing,hvac,boiler}_condition; null is "not recorded" (T2). */
export const OVERSIGHT_CONDITIONS = ["good", "fair", "poor"] as const;
export type OversightCondition = (typeof OVERSIGHT_CONDITIONS)[number];

/** oversight_buildings_retired_reason. */
export const OVERSIGHT_RETIRE_REASONS = ["sold", "demolished", "closed", "other"] as const;
export type OversightRetireReason = (typeof OVERSIGHT_RETIRE_REASONS)[number];

/** oversight_loans_kind. */
export const OVERSIGHT_LOAN_KINDS = ["presbytery_program", "guaranteed_outside", "other"] as const;
export type OversightLoanKind = (typeof OVERSIGHT_LOAN_KINDS)[number];

/** oversight_loans_status. */
export const OVERSIGHT_LOAN_STATUSES = ["open", "paid_off"] as const;
export type OversightLoanStatus = (typeof OVERSIGHT_LOAN_STATUSES)[number];

/** The money ceiling every *_cents CHECK uses: $1,000,000,000 (DECISION-349). */
export const OVERSIGHT_MONEY_MAX_CENTS = 100_000_000_000;

/**
 * The CONSTRAINT name each guard refusal carries (SQLSTATE 23514,
 * check_violation), so a caller can map a refusal without reading message
 * text. drizzle/0089 section 6.
 */
export const OVERSIGHT_GUARD_CODES = {
  insertRemoved: "oversight_guard_insert_removed",
  removalFinal: "oversight_guard_removal_final",
  immutable: "oversight_guard_immutable",
  buildingRemoved: "oversight_guard_building_removed",
} as const;

// bigint cents as a JS number: the ceiling (1e11) is far inside 2^53.
const cents = (name: string) => bigint(name, { mode: "number" });

/** oversight_profiles (tier 1). One row per (presbytery, congregation); no removal. */
export const oversightProfiles = pgTable(
  "oversight_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aboutOrgId: uuid("about_org_id")
      .notNull()
      .references(() => organizations.id),
    // LF-separated lines as normalizeAddress writes them; never parsed.
    streetAddress: text("street_address"),
    city: text("city"),
    county: text("county"),
    yearOrganized: smallint("year_organized"),
    phone: text("phone"),
    provenance: text("provenance").$type<OversightProvenance>().notNull().default("presbytery_entered"),
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
    unique("oversight_profiles_id_org_key").on(t.id, t.organizationId),
    unique("oversight_profiles_org_about_key").on(t.organizationId, t.aboutOrgId),
    check("oversight_profiles_provenance", sql`${t.provenance} in ('presbytery_entered', 'imported')`),
    check(
      "oversight_profiles_street_address_length",
      sql`${t.streetAddress} is null or char_length(${t.streetAddress}) <= 500`,
    ),
    check("oversight_profiles_city_length", sql`${t.city} is null or char_length(${t.city}) <= 100`),
    check("oversight_profiles_county_length", sql`${t.county} is null or char_length(${t.county}) <= 100`),
    check("oversight_profiles_phone_length", sql`${t.phone} is null or char_length(${t.phone}) <= 40`),
    check(
      "oversight_profiles_year_organized_range",
      sql`${t.yearOrganized} is null or ${t.yearOrganized} between 1600 and 2100`,
    ),
    check("oversight_profiles_row_version_positive", sql`${t.rowVersion} >= 1`),
  ],
);

/** oversight_buildings (tier 1). Retire is reversible; removal is one-way. */
export const oversightBuildings = pgTable(
  "oversight_buildings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aboutOrgId: uuid("about_org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    buildingType: text("building_type").$type<OversightBuildingType>().notNull(),
    yearBuilt: smallint("year_built"),
    firstAdditionYear: smallint("first_addition_year"),
    secondAdditionYear: smallint("second_addition_year"),
    squareFeet: integer("square_feet"),
    roofCondition: text("roof_condition").$type<OversightCondition>(),
    plumbingCondition: text("plumbing_condition").$type<OversightCondition>(),
    hvacCondition: text("hvac_condition").$type<OversightCondition>(),
    boilerCondition: text("boiler_condition").$type<OversightCondition>(),
    // Tri-state: null is "not recorded" (T2).
    hasSprinklers: boolean("has_sprinklers"),
    hasFireAlarm: boolean("has_fire_alarm"),
    hasSecuritySystem: boolean("has_security_system"),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    retiredOn: date("retired_on"),
    retiredReason: text("retired_reason").$type<OversightRetireReason>(),
    provenance: text("provenance").$type<OversightProvenance>().notNull().default("presbytery_entered"),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (t) => [
    unique("oversight_buildings_id_org_key").on(t.id, t.organizationId),
    // The child FK target: a photo, appraisal or loan cannot name another
    // congregation's building (Gap 12).
    unique("oversight_buildings_id_org_about_key").on(t.id, t.organizationId, t.aboutOrgId),
    check("oversight_buildings_provenance", sql`${t.provenance} in ('presbytery_entered', 'imported')`),
    check("oversight_buildings_name_length", sql`char_length(${t.name}) between 1 and 120`),
    check(
      "oversight_buildings_building_type",
      sql`${t.buildingType} in ('sanctuary', 'education_building', 'fellowship_hall', 'manse', 'parsonage', 'office', 'vacant_land', 'annex', 'gymnasium', 'other')`,
    ),
    check(
      "oversight_buildings_year_built_range",
      sql`${t.yearBuilt} is null or ${t.yearBuilt} between 1600 and 2100`,
    ),
    check(
      "oversight_buildings_first_addition_year_range",
      sql`${t.firstAdditionYear} is null or ${t.firstAdditionYear} between 1600 and 2100`,
    ),
    check(
      "oversight_buildings_second_addition_year_range",
      sql`${t.secondAdditionYear} is null or ${t.secondAdditionYear} between 1600 and 2100`,
    ),
    check(
      "oversight_buildings_first_addition_order",
      sql`${t.firstAdditionYear} is null or ${t.yearBuilt} is null or ${t.firstAdditionYear} >= ${t.yearBuilt}`,
    ),
    check(
      "oversight_buildings_second_addition_order",
      sql`${t.secondAdditionYear} is null or ${t.firstAdditionYear} is null or ${t.secondAdditionYear} >= ${t.firstAdditionYear}`,
    ),
    check(
      "oversight_buildings_second_addition_after_built",
      sql`${t.secondAdditionYear} is null or ${t.yearBuilt} is null or ${t.secondAdditionYear} >= ${t.yearBuilt}`,
    ),
    check(
      "oversight_buildings_square_feet_range",
      sql`${t.squareFeet} is null or ${t.squareFeet} between 1 and 5000000`,
    ),
    check(
      "oversight_buildings_roof_condition",
      sql`${t.roofCondition} is null or ${t.roofCondition} in ('good', 'fair', 'poor')`,
    ),
    check(
      "oversight_buildings_plumbing_condition",
      sql`${t.plumbingCondition} is null or ${t.plumbingCondition} in ('good', 'fair', 'poor')`,
    ),
    check(
      "oversight_buildings_hvac_condition",
      sql`${t.hvacCondition} is null or ${t.hvacCondition} in ('good', 'fair', 'poor')`,
    ),
    check(
      "oversight_buildings_boiler_condition",
      sql`${t.boilerCondition} is null or ${t.boilerCondition} in ('good', 'fair', 'poor')`,
    ),
    check("oversight_buildings_notes_length", sql`${t.notes} is null or char_length(${t.notes}) <= 4000`),
    check(
      "oversight_buildings_retired_reason",
      sql`${t.retiredReason} is null or ${t.retiredReason} in ('sold', 'demolished', 'closed', 'other')`,
    ),
    check("oversight_buildings_retired_pair", sql`(${t.retiredOn} is null) = (${t.retiredReason} is null)`),
    check("oversight_buildings_primary_not_retired", sql`not (${t.isPrimary} and ${t.retiredOn} is not null)`),
    check("oversight_buildings_removal_pair", sql`(${t.removedAt} is null) = (${t.removedBy} is null)`),
    check("oversight_buildings_row_version_positive", sql`${t.rowVersion} >= 1`),
    uniqueIndex("oversight_buildings_live_name_idx")
      .on(t.organizationId, t.aboutOrgId, sql`lower(${t.name})`)
      .where(sql`${t.removedAt} is null`),
    uniqueIndex("oversight_buildings_one_primary_idx")
      .on(t.organizationId, t.aboutOrgId)
      .where(sql`${t.isPrimary} and ${t.removedAt} is null`),
  ],
);

/**
 * oversight_building_photos (tier 1). Written from Increment 2 by
 * photo-store.ts only; the table ships now. Only caption, is_cover and the
 * removal pair ever change.
 */
export const oversightBuildingPhotos = pgTable(
  "oversight_building_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aboutOrgId: uuid("about_org_id")
      .notNull()
      .references(() => organizations.id),
    buildingId: uuid("building_id").notNull(),
    imageAssetKey: uuid("image_asset_key").notNull(),
    thumbAssetKey: uuid("thumb_asset_key").notNull(),
    // Constant 'private': the third column of both DDL-only blob FKs.
    assetAudience: text("asset_audience").notNull().default("private"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    caption: text("caption"),
    isCover: boolean("is_cover").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (t) => [
    unique("oversight_building_photos_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.buildingId, t.organizationId, t.aboutOrgId],
      foreignColumns: [oversightBuildings.id, oversightBuildings.organizationId, oversightBuildings.aboutOrgId],
      name: "oversight_building_photos_building_fk",
    }),
    check("oversight_building_photos_audience_private", sql`${t.assetAudience} = 'private'`),
    check("oversight_building_photos_distinct_assets", sql`${t.imageAssetKey} <> ${t.thumbAssetKey}`),
    check(
      "oversight_building_photos_dimensions",
      sql`${t.width} between 1 and 2000 and ${t.height} between 1 and 2000`,
    ),
    check(
      "oversight_building_photos_caption_length",
      sql`${t.caption} is null or char_length(${t.caption}) <= 200`,
    ),
    check("oversight_building_photos_removal_pair", sql`(${t.removedAt} is null) = (${t.removedBy} is null)`),
    uniqueIndex("oversight_building_photos_live_image_idx")
      .on(t.organizationId, t.buildingId, t.imageAssetKey)
      .where(sql`${t.removedAt} is null`),
    uniqueIndex("oversight_building_photos_one_cover_idx")
      .on(t.organizationId, t.buildingId)
      .where(sql`${t.isCover} and ${t.removedAt} is null`),
    index("oversight_building_photos_building_idx")
      .on(t.organizationId, t.buildingId)
      .where(sql`${t.removedAt} is null`),
  ],
);

/** oversight_building_appraisals (tier 2). Recorded and removed, never edited (T4). */
export const oversightBuildingAppraisals = pgTable(
  "oversight_building_appraisals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aboutOrgId: uuid("about_org_id")
      .notNull()
      .references(() => organizations.id),
    buildingId: uuid("building_id").notNull(),
    assessedYear: smallint("assessed_year").notNull(),
    amountCents: cents("amount_cents").notNull(),
    notes: text("notes"),
    provenance: text("provenance").$type<OversightProvenance>().notNull().default("presbytery_entered"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (t) => [
    unique("oversight_building_appraisals_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.buildingId, t.organizationId, t.aboutOrgId],
      foreignColumns: [oversightBuildings.id, oversightBuildings.organizationId, oversightBuildings.aboutOrgId],
      name: "oversight_building_appraisals_building_fk",
    }),
    check(
      "oversight_building_appraisals_provenance",
      sql`${t.provenance} in ('presbytery_entered', 'imported')`,
    ),
    check(
      "oversight_building_appraisals_assessed_year_range",
      sql`${t.assessedYear} between 1600 and 2100`,
    ),
    check(
      "oversight_building_appraisals_amount_range",
      sql`${t.amountCents} between 0 and 100000000000`,
    ),
    check(
      "oversight_building_appraisals_notes_length",
      sql`${t.notes} is null or char_length(${t.notes}) <= 1000`,
    ),
    check(
      "oversight_building_appraisals_removal_pair",
      sql`(${t.removedAt} is null) = (${t.removedBy} is null)`,
    ),
    uniqueIndex("oversight_building_appraisals_live_year_idx")
      .on(t.organizationId, t.buildingId, t.assessedYear)
      .where(sql`${t.removedAt} is null`),
  ],
);

/** oversight_insurance_years (tier 2). One live record per congregation per policy year. */
export const oversightInsuranceYears = pgTable(
  "oversight_insurance_years",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aboutOrgId: uuid("about_org_id")
      .notNull()
      .references(() => organizations.id),
    // Not editable: remove and re-record (the guard pins it on every connection).
    policyYear: smallint("policy_year").notNull(),
    carrier: text("carrier"),
    policyNumber: text("policy_number"),
    policyExpiresOn: date("policy_expires_on"),
    recentClaims: boolean("recent_claims"),
    poolInterest: boolean("pool_interest"),
    notes: text("notes"),
    provenance: text("provenance").$type<OversightProvenance>().notNull().default("presbytery_entered"),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (t) => [
    unique("oversight_insurance_years_id_org_key").on(t.id, t.organizationId),
    check(
      "oversight_insurance_years_provenance",
      sql`${t.provenance} in ('presbytery_entered', 'imported')`,
    ),
    check("oversight_insurance_years_policy_year_range", sql`${t.policyYear} between 1900 and 2100`),
    check(
      "oversight_insurance_years_carrier_length",
      sql`${t.carrier} is null or char_length(${t.carrier}) <= 200`,
    ),
    check(
      "oversight_insurance_years_policy_number_length",
      sql`${t.policyNumber} is null or char_length(${t.policyNumber}) <= 100`,
    ),
    check(
      "oversight_insurance_years_notes_length",
      sql`${t.notes} is null or char_length(${t.notes}) <= 2000`,
    ),
    check(
      "oversight_insurance_years_removal_pair",
      sql`(${t.removedAt} is null) = (${t.removedBy} is null)`,
    ),
    check("oversight_insurance_years_row_version_positive", sql`${t.rowVersion} >= 1`),
    uniqueIndex("oversight_insurance_years_live_year_idx")
      .on(t.organizationId, t.aboutOrgId, t.policyYear)
      .where(sql`${t.removedAt} is null`),
  ],
);

/** oversight_loans (tier 2). One balance plus its as-of date; the building link has no UI in v1 (T9). */
export const oversightLoans = pgTable(
  "oversight_loans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aboutOrgId: uuid("about_org_id")
      .notNull()
      .references(() => organizations.id),
    // Optional; the three-column FK is MATCH SIMPLE (not enforced while null).
    buildingId: uuid("building_id"),
    kind: text("kind").$type<OversightLoanKind>().notNull(),
    lender: text("lender"),
    originalAmountCents: cents("original_amount_cents"),
    currentBalanceCents: cents("current_balance_cents"),
    balanceAsOf: date("balance_as_of"),
    grantsAmountCents: cents("grants_amount_cents"),
    guaranteeNote: text("guarantee_note"),
    notes: text("notes"),
    status: text("status").$type<OversightLoanStatus>().notNull().default("open"),
    paidOffOn: date("paid_off_on"),
    provenance: text("provenance").$type<OversightProvenance>().notNull().default("presbytery_entered"),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (t) => [
    unique("oversight_loans_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.buildingId, t.organizationId, t.aboutOrgId],
      foreignColumns: [oversightBuildings.id, oversightBuildings.organizationId, oversightBuildings.aboutOrgId],
      name: "oversight_loans_building_fk",
    }),
    check("oversight_loans_provenance", sql`${t.provenance} in ('presbytery_entered', 'imported')`),
    check(
      "oversight_loans_kind",
      sql`${t.kind} in ('presbytery_program', 'guaranteed_outside', 'other')`,
    ),
    check("oversight_loans_lender_length", sql`${t.lender} is null or char_length(${t.lender}) <= 200`),
    check(
      "oversight_loans_original_amount_range",
      sql`${t.originalAmountCents} is null or ${t.originalAmountCents} between 0 and 100000000000`,
    ),
    check(
      "oversight_loans_current_balance_range",
      sql`${t.currentBalanceCents} is null or ${t.currentBalanceCents} between 0 and 100000000000`,
    ),
    check(
      "oversight_loans_grants_amount_range",
      sql`${t.grantsAmountCents} is null or ${t.grantsAmountCents} between 0 and 100000000000`,
    ),
    check(
      "oversight_loans_balance_pair",
      sql`(${t.currentBalanceCents} is null) = (${t.balanceAsOf} is null)`,
    ),
    check(
      "oversight_loans_guarantee_note_length",
      sql`${t.guaranteeNote} is null or char_length(${t.guaranteeNote}) <= 1000`,
    ),
    check("oversight_loans_notes_length", sql`${t.notes} is null or char_length(${t.notes}) <= 2000`),
    check("oversight_loans_status", sql`${t.status} in ('open', 'paid_off')`),
    check("oversight_loans_paid_off_pair", sql`(${t.status} = 'paid_off') = (${t.paidOffOn} is not null)`),
    check("oversight_loans_removal_pair", sql`(${t.removedAt} is null) = (${t.removedBy} is null)`),
    check("oversight_loans_row_version_positive", sql`${t.rowVersion} >= 1`),
    index("oversight_loans_about_idx")
      .on(t.organizationId, t.aboutOrgId)
      .where(sql`${t.removedAt} is null`),
  ],
);
