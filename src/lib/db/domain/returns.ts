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
import { users } from "../schema";

/**
 * The SASR ARTIFACT and the form generations that give its payload a schema
 * (D12/D25/F31). DDL, RLS, triggers and the seeded form versions live in
 * `drizzle/0046_presby_statistical_returns.sql`; design rationale in
 * `docs/schema-design-2.md` sec 5 and
 * `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`.
 *
 * This module REPLACES `reporting.ts`, which held only `sasrReports` and is
 * deleted with that table in `drizzle/0047` (Phase 2 Ruling 6 /
 * DECISION-137).
 *
 * THREE EXPORTS, as this module's own earlier header promised: the form
 * generations, the artifact, and — since increment 6 (D16/DECISION-147,
 * `drizzle/0049_presby_submission_grants.sql`,
 * `docs/work-log/2026-09-25-submission-grants.md`) —
 * `statisticsSubmissionGrants`, the token-bearing CREDENTIAL a congregation
 * with no account files through. It lives here rather than in a `grants.ts`
 * of its own because the grant → return FK makes the two one unit.
 *
 * THE COMPOSITE FK ON THAT TABLE IS NOT THE NAIVE ONE, and the correction is
 * repeated here because `drizzle/0049` is the only place it is actually
 * enforced (see that table's own comment below):
 *
 *     foreign key (return_id, about_org_id)
 *       references statistical_returns (id, organization_id)
 *
 * The grant is owned by the PRESBYTERY (`organization_id`) and the submitted
 * return it claims is owned by the CONGREGATION, so `about_org_id` is the
 * column that equals `statistical_returns.organization_id` — the same
 * correction `drizzle/0047` already made for
 * `congregation_statistics.publication_id`. Written the naive way, the
 * constraint would reject every row it was meant to protect (F2).
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

/**
 * A token-bearing SUBMISSION GRANT — the third access mechanism alongside
 * permissions and flags (D16 / DECISION-147). One issuing presbytery, one
 * congregation, one report year, one write, expiring. It is never mapped into
 * `FEATURES.*`, a session claim, or the permission resolver: it names its own
 * subject, so the submission function derives BOTH organization ids from the
 * row and the application sets no org GUC on the anonymous path.
 *
 * `tokenHash` is the sha256 hex of a 32-byte CSPRNG token (the
 * `requestPasswordReset` precedent, never bcrypt — bcrypt is for low-entropy
 * secrets). The raw token never enters this database.
 *
 * ALMOST NONE OF THE ENFORCEMENT IS VISIBLE HERE. It lives in
 * `drizzle/0049_presby_submission_grants.sql`, which is the ground truth:
 *
 *   - `FORCE ROW LEVEL SECURITY` + the `tenant_isolation` policy scoped to
 *     `presby_current_org()` (section 1). Without FORCE the owner bypasses
 *     every policy and RLS is silently inert (F1).
 *   - THE GRANT SHAPE, which is half the security model: `presby_app` holds
 *     `select`, `insert` and a COLUMN-LEVEL `update (revoked_at)` and nothing
 *     else, so the tenant connection cannot reach `submittedAt` or `returnId`
 *     at all. `presby_platform` holds `select` only — a platform-shell
 *     connection reading across every tenant may never issue an authorization
 *     event. Neither holds `delete`.
 *   - `statistics_submission_grants_live_idx`, a PARTIAL unique on
 *     `(organization_id, about_org_id, report_year) where revoked_at is null
 *     and submitted_at is null` — one LIVE grant per congregation-year; a
 *     revoked or spent one does not block a re-issue. Drizzle has no
 *     partial-unique builder here.
 *   - `statistics_submission_grants_return_fk`, the composite FK described in
 *     this module's header — `(return_id, about_org_id)`, not
 *     `(return_id, organization_id)`. No cross-file composite-FK builder
 *     exists in Drizzle, so it is 0049-only.
 *   - TWO BEFORE INSERT triggers (section 2a/2b): the about-org relationship
 *     as of TODAY, through `drizzle/0045`'s shared checker, and
 *     `presby_check_grant_about_org_unmanaged()`, which refuses a grant about
 *     a `managed` congregation — that one has its own portal and self-files.
 *     Both are AUTHORITY; the issuance UI's dropdown filter is a convenience.
 *   - `presby_freeze_statistics_submission_grant()` (BEFORE UPDATE, section
 *     2c) permits exactly THREE transitions and rejects everything else on
 *     EVERY connection: the revocation, the CLAIM (`submittedAt` alone) and
 *     the STAMP (`returnId` alone, from an already-claimed row). The last two
 *     additionally require the transaction-local GUC
 *     `presby.grant_claim_active`, armed only inside
 *     `presby_submit_granted_return()`. A row is terminal once `revokedAt` or
 *     `returnId` is set. The trigger is the only thing guarding the owner
 *     path, where no grant binds (F44).
 *   - `presby_submit_granted_return(token_hash, payload, attested_by_name,
 *     attested_role)` (section 5) is the ONLY writer of `submittedAt` /
 *     `returnId`. It re-resolves the recipient from the affiliation history at
 *     claim time and uses `organizationId` only as a staleness check — a
 *     stored id is never authority (D19/F80).
 *
 * `organizationId` and `aboutOrgId` are PLAIN FKs to `organizations` by the
 * same section-17 structural exception the rest of this module records. Do not
 * "fix" them.
 */
export const statisticsSubmissionGrants = pgTable(
  "statistics_submission_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The ISSUING presbytery. Tenant scope, and provenance of issuance only. */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The congregation being asked to file. */
    aboutOrgId: uuid("about_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reportYear: integer("report_year").notNull(),
    /** sha256 hex. NEVER the token. */
    tokenHash: text("token_hash").notNull(),
    issuedToName: text("issued_to_name").notNull(),
    issuedToEmail: text("issued_to_email").notNull(),
    /** The issuing admin — a real session wrote this row, so there is no Ruling-A4 gap here. */
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** THE CLAIM. Written only by `presby_submit_granted_return()`. */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** THE STAMP. Composite FK to `statistical_returns` is 0049-only. */
    returnId: uuid("return_id"),
    /** The issuing presbytery's own revocation — the one tenant-writable column. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    unique("statistics_submission_grants_id_org_key").on(t.id, t.organizationId),
    unique("statistics_submission_grants_token_hash_key").on(t.tokenHash),
    index("statistics_submission_grants_about_org_year_idx").on(
      t.aboutOrgId,
      t.reportYear,
    ),
    index("statistics_submission_grants_org_idx").on(t.organizationId),
    check(
      "statistics_submission_grants_token_hash_shape",
      sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "statistics_submission_grants_report_year_range",
      sql`${t.reportYear} between 1900 and 2100`,
    ),
    check(
      "statistics_submission_grants_expiry_shape",
      sql`${t.expiresAt} > ${t.issuedAt}`,
    ),
    check(
      "statistics_submission_grants_name_shape",
      sql`char_length(btrim(${t.issuedToName})) between 1 and 255`,
    ),
    check(
      "statistics_submission_grants_email_shape",
      sql`char_length(${t.issuedToEmail}) between 3 and 320`,
    ),
    /**
     * ONE-DIRECTIONAL, not symmetric — F51's lesson applied from the start.
     * `returnId` implies `submittedAt`; `submittedAt` does NOT require
     * `returnId`, because the mid-claim state is legal, transient, and closed
     * by the same transaction that opened it.
     */
    check(
      "statistics_submission_grants_claim_shape",
      sql`${t.returnId} is null or ${t.submittedAt} is not null`,
    ),
  ],
);
