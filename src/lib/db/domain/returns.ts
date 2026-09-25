import {
  pgTable,
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./org";

/**
 * The SASR ARTIFACT and the form generations that give its payload a schema
 * (D12/D25/F31). DDL, RLS, triggers and the seeded form versions live in
 * `drizzle/0046_presby_statistical_returns.sql`; design rationale in
 * `docs/schema-design-2.md` sec 5 and
 * `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`.
 *
 * This module REPLACES `reporting.ts`, which held only `sasrReports` and is
 * deleted with that table in `drizzle/0047` (Phase 2 Ruling 6 /
 * DECISION-137). `statisticsSubmissionGrants` (D16) belongs here too but
 * ships in increment 6, which is its own work-log and its own security pass
 * (Phase 2 Ruling 11) — do not add it ahead of that.
 *
 * MUCH OF THE REAL ENFORCEMENT IS NOT EXPRESSIBLE IN DRIZZLE and lives only
 * in `0046` — stated here so a reader does not mistake the absence for
 * permission:
 *
 *   - `presby_enforce_sasr_field_spec()`, a BEFORE INSERT trigger, is what
 *     makes `payload` a CLOSED allow-list rather than the custom-fields
 *     escape hatch D8 refuses: every key must be declared by the named form
 *     version, every value must match its declared JSON type, and every
 *     number must sit inside its declared bounds (min defaulting to 0, which
 *     is where "counts are non-negative" actually lives). Without that
 *     trigger, DECISION-118's allow-list property is lost.
 *   - `statistical_returns_guard` (BEFORE INSERT, `drizzle/0046` section 4b,
 *     F55/DECISION-141) refuses any INSERT unless the transaction-local GUC
 *     `presby.publication_write_active` is set. The revoked INSERT grant
 *     proves nothing on `getPlatformDb()` (F44) and the CHECK constraints
 *     prove a row's SHAPE, never its PROVENANCE — a raw owner INSERT
 *     satisfying `statistical_returns_provenance_shape` and the field spec is
 *     otherwise indistinguishable from `presby_publish_sasr_snapshot()`'s own
 *     write, i.e. a fabricated "the congregation attested and submitted this"
 *     artifact no session ever minuted. ONE GUC covers the whole
 *     return → publication → projection act, and covers `imported` too when
 *     D13's import function ships. Armed today by
 *     `presby_publish_sasr_snapshot()`, `drizzle/0047`'s backfill and
 *     `scripts/seed-dev.sql`; test fixtures arm it themselves
 *     (`publication.test.ts`'s `armPublicationWrite()`).
 *   - `statistical_returns_freeze` (BEFORE UPDATE OR DELETE) refuses both on
 *     EVERY connection. `presby_app` and `presby_platform` hold
 *     `select, insert` only, but a grant does not bind `neondb_owner` — the
 *     role `PLATFORM_DATABASE_URL` actually connects as — because `BYPASSRLS`
 *     exempts a role from RLS policies, never from triggers. Correct a return
 *     by filing another one; `publications.supersedes_id` chains them.
 *   - `statistical_returns_about_org` enforces, for `provenance = 'imported'`
 *     only, that the about-org was affiliated with the recording council at
 *     either endpoint of the report year (R3.14, the same year-endpoint
 *     semantics `drizzle/0045` settled). Submitted returns are covered by the
 *     `statistical_returns_submitted_is_self` CHECK instead.
 *   - `sasr_form_versions_no_overlap`, a GiST EXCLUDE over
 *     `int4range(effective_first_year, coalesce(effective_last_year, 9999))`.
 *     Drizzle has no EXCLUDE builder. Two generations claiming the same year
 *     would make "which spec validates this payload" ambiguous.
 *   - The recipient council reads this table ONLY through
 *     `presby_list_published_returns_to_me()` (`drizzle/0047`, SECURITY
 *     DEFINER). Under the tenant policy a submitted return is invisible to
 *     the presbytery, which is the point: the publication event grants the
 *     read, not the tenant policy.
 *
 * `organizationId` and `aboutOrgId` are PLAIN FKs to `organizations` and are
 * deliberately NOT composite tenant FKs (F2's structural exception,
 * `docs/schema-design.md` sec 17). Do not "fix" them.
 */

/**
 * The SASR form generations. Platform-wide reference data in the class of
 * `permissions` and `feature_flags`: no RLS, no `organizationId`, written
 * only by migration — a form revision is not any council's property.
 *
 * Only `'2024'` carries a complete `fieldSpec` today; `'1984'`, `'2014'` and
 * `'2022'` are seeded as placeholders with `{"fields": {}}`. An EMPTY spec
 * validates nothing and therefore accepts no payload key at all, which is
 * the correct fail-closed default for a generation whose per-tab column
 * order has not been mapped yet (F31/F32). Filling them in is owed to
 * increment 7's D13 import pipeline and is a data edit, not a schema change.
 */
export const sasrFormVersions = pgTable(
  "sasr_form_versions",
  {
    // Natural key — the row IS its name ('1984', '2014', '2022', '2024').
    key: text("key").primaryKey(),
    label: text("label").notNull(),
    effectiveFirstYear: integer("effective_first_year").notNull(),
    /** Null = still in effect. */
    effectiveLastYear: integer("effective_last_year"),
    /**
     * `{ "fields": { "<key>": { type, min, max, sasr_line, comparable_to } } }`.
     * `sasr_line`/`comparable_to` are the F34 cross-generation machinery and
     * are deliberately empty on every row today — the normalising view that
     * consumes them is not built, and a half-invented mapping would be worse
     * than an absent one.
     */
    fieldSpec: jsonb("field_spec").notNull(),
  },
  (t) => [
    check(
      "sasr_form_versions_year_order",
      sql`${t.effectiveLastYear} is null or ${t.effectiveLastYear} >= ${t.effectiveFirstYear}`,
    ),
    check(
      "sasr_form_versions_field_spec_shape",
      sql`jsonb_typeof(${t.fieldSpec} -> 'fields') = 'object'`,
    ),
    // sasr_form_versions_no_overlap (GiST EXCLUDE) is in 0046 only — Drizzle
    // cannot express it. See this module's header.
    //
    // NOR IS `sasr_form_versions_field_spec_freeze` (F53/DECISION-140), and
    // it is the reason `payload` can be trusted decades later: a SECURITY
    // DEFINER BEFORE UPDATE trigger refuses a `fieldSpec` change once ANY
    // tenant's `statistical_returns` row names the key. Preserving a 1987
    // payload forever while silently changing the definition through which
    // the system reads it is the same failure as editing the payload.
    // DEFINER is load-bearing: `statistical_returns` is FORCE RLS, so an
    // invoker-mode check would see zero referencing rows for a tenant other
    // than the caller's own and let the edit through (F26). Placeholder rows
    // stay editable until first use, and the migration's own
    // `on conflict … do update` still converges on re-apply because the
    // trigger's WHEN clause skips a byte-identical write.
  ],
);

/**
 * The as-reported SASR artifact (D25), IMMUTABLE and append-only.
 *
 * ONE table, two provenances — they differ only in who wrote the return and
 * who owns it:
 *
 *   `submitted` — owned by the CONGREGATION (`organizationId` =
 *     `aboutOrgId`, a CHECK). D11's reconciliation rule applies at write
 *     time, so `reconciled` is true.
 *   `imported`  — owned by the PRESBYTERY, about one of its congregations as
 *     of the report year. An imported 1987 row is a historical assertion: if
 *     it does not balance, that is a fact about 1987, not an error to
 *     correct, so `reconciled` is false.
 *
 * There is deliberately NO unique on `(aboutOrgId, reportYear)` (R3.8): a
 * corrected submission is a new row and `publications.supersedesId` says
 * which one is current, and a merge year can legitimately carry two rows
 * about the same congregation from two predecessors.
 */
export const statisticalReturns = pgTable(
  "statistical_returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The owner: the congregation for `submitted`, the presbytery for `imported`. */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * The congregation the return is ABOUT. Plain FK, and it may legitimately
     * reference a DISSOLVED organization — the concrete reason D10 exists.
     */
    aboutOrgId: uuid("about_org_id")
      .notNull()
      .references(() => organizations.id),
    reportYear: integer("report_year").notNull(),
    formVersionKey: text("form_version_key")
      .notNull()
      .references(() => sasrFormVersions.key),
    /** submitted | imported */
    provenance: text("provenance").notNull(),
    /** As-reported, in that generation's own field names. Gated by trigger. */
    payload: jsonb("payload").notNull(),
    /** WHICH RULE WAS APPLIED, not whether the arithmetic happens to balance. */
    reconciled: boolean("reconciled").notNull(),
    /**
     * A NAME and a ROLE, not a user id, deliberately: D16's grant path
     * (increment 6) produces a return with no account behind it at all, and a
     * nullable users FK would read as "we lost the id" rather than "there
     * never was one".
     */
    attestedByName: text("attested_by_name"),
    attestedRole: text("attested_role"),
    attestedAt: timestamp("attested_at", { withTimezone: true }),
    /** D13 import provenance. */
    sourceRef: text("source_ref"),
    /**
     * Plain uuid today; the FK to `import_rows(id)` is added in increment 7
     * when that table exists. A forward-reference FK is not expressible and a
     * placeholder table would be worse.
     */
    stagingRowId: uuid("staging_row_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("statistical_returns_id_org_key").on(t.id, t.organizationId),
    index("statistical_returns_org_about_year_idx").on(
      t.organizationId,
      t.aboutOrgId,
      t.reportYear,
    ),
    index("statistical_returns_about_year_idx").on(t.aboutOrgId, t.reportYear),
    check(
      "statistical_returns_provenance_allowed",
      sql`${t.provenance} in ('submitted','imported')`,
    ),
    check(
      "statistical_returns_report_year_range",
      sql`${t.reportYear} between 1900 and 2100`,
    ),
    /**
     * A submitted return is ABOUT its own congregation by definition (sec 5's
     * ownership rule). Without this, a congregation could submit — and then
     * publish — a return about a DIFFERENT congregation, the confused-deputy
     * shape `presby_publish_sasr_snapshot()` refuses one layer up. Imported
     * rows are the genuine cross-org case and go through the affiliation
     * trigger instead.
     */
    check(
      "statistical_returns_submitted_is_self",
      sql`${t.provenance} <> 'submitted' or ${t.aboutOrgId} = ${t.organizationId}`,
    ),
    /**
     * The two provenances were shapes in PROSE only (F50/DECISION-140):
     * `submitted` with `reconciled = false` and no attestation, and
     * `imported` with `reconciled = true`, were both legal rows, and nothing
     * but `presby_publish_sasr_snapshot()`'s own discipline kept a submitted
     * return attested.
     *
     * DEVIATION, same cause as `organizationAffiliations`' closed-shape
     * exclusion of `closedBy`: F50's literal predicate also requires
     * `attestedByName` and `attestedRole` to be non-null, but the only live
     * writer of a submitted row writes both as NULL on purpose — there is no
     * `app.current_user_id` GUC and accepting an attester name as a function
     * parameter would be the caller-supplied identity claim that function's
     * shape refuses (Ruling A4). The CHECK as literally worded would make
     * publishing impossible, so the two text columns are excluded and
     * `attestedAt` carries the attestation half. Tightening them is blocked
     * on the acting-user GUC.
     *
     * Lives in `drizzle/0047`, not `0046`: it is added after 0047's backfill,
     * which mints submitted rows out of pre-existing projections.
     */
    check(
      "statistical_returns_provenance_shape",
      sql`(${t.provenance} = 'submitted' and ${t.reconciled} and ${t.attestedAt} is not null)
          or (${t.provenance} = 'imported' and not ${t.reconciled})`,
    ),
  ],
);
