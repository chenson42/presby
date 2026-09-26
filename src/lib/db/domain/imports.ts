import {
  pgTable,
  check,
  foreignKey,
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
import { sasrFormVersions, statisticalReturns } from "./returns";
import { users } from "../schema";

/**
 * THE IMPORT QUARANTINE (D13, R3.16, increment 7,
 * `drizzle/0053_presby_name_history_import_staging.sql`).
 *
 * D13's rule is that an unresolved row is a DURABLE RECORD, never an error
 * log: a spreadsheet row the matcher cannot place lands here with its raw
 * payload, the candidates that were considered, a resolution kind, a resolver
 * and a rationale — and it stays. Nothing here is droppable and nothing here
 * is rewritable.
 *
 * Design rationale in `docs/schema-design-2.md` D13 / R3.16 and
 * `docs/work-log/2026-09-26-name-history-import-staging.md`
 * (DECISION-153, F100-F104).
 *
 * MODULE-GRAPH DIRECTION IS ONE-WAY: `imports.ts` -> { `org.ts`,
 * `returns.ts`, `../schema` }, never the reverse (Phase 2). That is why
 * `statisticalReturns.stagingRowId`'s composite FK back into `importRows` is
 * declared in the MIGRATION only and carries an `architectural` row in
 * `scripts/check-schema-parity.ts` — declaring it in `returns.ts` would make
 * `returns.ts` import this file and cycle the graph, the same `blobAssets`
 * shape `assets.ts:63-78` already documents. The FK in the OTHER direction
 * (`resultingReturnId`, below) is declared here, normally, because this
 * direction is the permitted one.
 *
 * THESE TWO TABLES TAKE THE OPPOSITE DML TREATMENT FROM
 * `organizationNameHistory`, which shipped in the same migration, and the
 * difference follows from ONE TEST rather than from their subject matter
 * (F103): *a unique or EXCLUDE constraint on a FORCE-RLS table is an
 * enumeration oracle exactly when its key is learnable from public data.*
 * `organizationNameHistory`'s EXCLUDE keys on the public `subject_org_id`, so
 * its DML is function-mediated. `importRows` keys `unique (batch_id,
 * row_index)` on a random uuid a non-owner cannot guess, so it keeps ordinary
 * tenant DML. Neither ruling generalizes to "all new tenant tables."
 *
 * WHAT IS NOT EXPRESSIBLE IN DRIZZLE AND LIVES ONLY IN `drizzle/0053` —
 * stated here so a reader does not mistake the absence for permission:
 *
 *   - `FORCE ROW LEVEL SECURITY` + `tenant_isolation` on
 *     `presby_current_org()`, on both tables. Without FORCE the owner
 *     bypasses every policy and RLS is silently inert (F1).
 *   - THE GRANT SHAPE: `presby_app` holds `select, insert, update` and
 *     **no DELETE on either table**; `presby_platform` holds `select` only.
 *     D13's durable quarantine is a grant fact, not a convention.
 *   - `import_batches_freeze` and `import_rows_freeze`, both BEFORE UPDATE OR
 *     DELETE, both firing on EVERY connection. The revoke above binds
 *     `presby_app` and `presby_platform`; it does NOT bind `neondb_owner`,
 *     which owns these tables, holds every privilege by ownership, and is the
 *     role `PLATFORM_DATABASE_URL` actually connects as (F44). `BYPASSRLS`
 *     exempts a role from RLS policies, never from triggers, so the trigger
 *     is the only layer that says anything at all on the connection that
 *     matters. Every refusal raises ONE literal per table
 *     (`presby_deny_import_batch_change()` /
 *     `presby_deny_import_row_change()`), so no cause is distinguishable from
 *     another (DECISION-139).
 *   - `import_rows_freeze`'s TWO PERMITTED PATHS and nothing else:
 *       PATH A — THE RESOLVE. Only from `resolution_kind = 'unresolved'`; may
 *         set `resolution_kind`/`resolvedOrgId`/`resolvedBy`/`resolvedAt`/
 *         `rationale` together, and may NEVER touch `resultingReturnId` in
 *         the same step.
 *       PATH B — THE STAMP. On an already-resolved row, `resultingReturnId`
 *         may go from null to non-null, alone, exactly once.
 *     Path B is not fussiness: `resultingReturnId` and
 *     `statisticalReturns.stagingRowId` are an FK CYCLE, and the one legal
 *     write order inside a future writer's single transaction is insert
 *     `import_rows` (pointer null) -> insert `statistical_returns` -> update
 *     the pointer. A trigger that did not permit exactly that update would
 *     deadlock the executor pipeline's writer against its own guard on day
 *     one.
 *   - RESOLUTION IS SET-ONCE and there is no correction path. That is chosen,
 *     not overlooked — loosening later is cheap, tightening after the
 *     executor ships is not. The revision mechanism (an append-only
 *     `import_row_revisions` child, or a `presby_revise_import_row()` DEFINER
 *     function) is an open item owned by the EXECUTOR pipeline's Phase 1.
 *
 * WHAT THIS INCREMENT DELIBERATELY DOES NOT SHIP: the import UI, the
 * executor, `presby_organize_congregation()` (so `created_dissolved` is
 * nameable but unreachable), and `presby_import_return()` — the sibling
 * writer an imported return needs, because
 * `presby_write_return_publication_chain()` hard-codes `provenance =
 * 'submitted'` (`drizzle/0049:513`) and unconditionally writes a
 * `publications` row an import has no event for. Contracts for all of them
 * are in the work-log's Phase 3 "Deferred Writers".
 */

/**
 * One row per uploaded spreadsheet WORKSHEET, presbytery-owned.
 *
 * Scoped to a worksheet rather than to a file because F32 found that
 * positional column arrays only decode PER TAB — there is no single universal
 * column order across a 41-year archive — which is also why each batch
 * carries its own `columnMap`.
 *
 * NO CACHED COUNTS. `rowCount` is a fact about the source file and is
 * immutable; `resolved_count`/`unresolved_count` deliberately do not exist,
 * because they are derivable from `importRows` and would drift —
 * `memberships.currentRoll`'s F29 lesson arriving in a new table.
 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The presbytery running the import. Tenant scope. */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** Free text: where the rows came from ('legacy binder scan', ...). */
    source: text("source").notNull(),
    /** The worksheet/tab this batch decoded (F32). */
    worksheet: text("worksheet").notNull(),
    /**
     * REQUIRED, not nullable: `columnMap`'s TARGET keys are this generation's
     * `sasrFormVersions.fieldSpec`, so without a form version there is
     * nothing for the map to map INTO. A genuinely pre-1984 batch needs its
     * own seeded `sasr_form_versions` row, not a null here.
     */
    formVersionKey: text("form_version_key")
      .notNull()
      .references(() => sasrFormVersions.key),
    /** `{ "source column header": "target field key", ... }` */
    columnMap: jsonb("column_map").notNull(),
    /** A fact about the SOURCE FILE, immutable. Not a progress counter. */
    rowCount: integer("row_count").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("import_batches_id_org_key").on(t.id, t.organizationId),
    index("import_batches_org_idx").on(t.organizationId, t.createdAt),
    check(
      "import_batches_source_shape",
      sql`char_length(btrim(${t.source})) between 1 and 120`,
    ),
    check(
      "import_batches_worksheet_shape",
      sql`char_length(btrim(${t.worksheet})) between 1 and 120`,
    ),
    check(
      "import_batches_column_map_shape",
      sql`jsonb_typeof(${t.columnMap}) = 'object'`,
    ),
    check("import_batches_row_count_nonneg", sql`${t.rowCount} >= 0`),
    // import_batches_freeze (BEFORE UPDATE OR DELETE, every connection) is in
    // drizzle/0053 only. See this module's header.
  ],
);

/**
 * D13's quarantine proper: one row per source spreadsheet row.
 *
 * `rawPayload` is stored AS-IS with no shape validation beyond "it is a JSON
 * object" — that is the POINT of a quarantine. A malformed worksheet (wrong
 * tab, no header row, F32's embedded newlines in a money cell) gets a
 * human-readable failure in the executor pipeline's own ingest step, never a
 * dropped row here.
 *
 * `candidates` is frozen after insert on purpose: it is the snapshot of what
 * the clerk actually SAW when they chose, and a later, better matcher must
 * not retroactively improve the audit trail.
 */
export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id").notNull(),
    /** The presbytery running the import. Tenant scope. */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    rowIndex: integer("row_index").notNull(),
    /** As read from the source. No shape validation — that is the point. */
    rawPayload: jsonb("raw_payload").notNull(),
    originalName: text("original_name"),
    originalCity: text("original_city"),
    reportYear: integer("report_year").notNull(),
    /** What `presby_match_organization()` returned AT RESOLUTION TIME. Frozen. */
    candidates: jsonb("candidates").notNull().default([]),
    /** See `ResolutionKind`. `'unresolved'` is a NAMED state, never a null. */
    resolutionKind: text("resolution_kind").notNull().default("unresolved"),
    /**
     * Plain FK — `organizations` is public, sec 17's structural exception.
     * NO unique and NO exclusion constraint on this column, ever (Ruling 5a):
     * one here would manufacture the very enumeration oracle
     * `organizationNameHistory` refuses one table over.
     */
    resolvedOrgId: uuid("resolved_org_id").references(() => organizations.id),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    rationale: text("rationale"),
    /**
     * THE DISPOSITION POINTER: the return this row's resolution points at —
     * one it created, OR a pre-existing one it was found to DUPLICATE.
     *
     * Distinct from `statisticalReturns.stagingRowId`, which is the
     * ARTIFACT's provenance ("this return was created from that row"). They
     * coincide for `matched_*`/`created_dissolved` and DIVERGE on
     * `duplicate`, and they are deliberately NOT asserted to agree — a
     * reviewer who "simplifies" one away silently breaks dedup (F102).
     *
     * THE FK IS ON THE ABOUT-ORG AXIS (F104, as revised by the Phase 2
     * addendum; see the `foreignKey(...)` below). It is NOT a sec 17
     * structural exception — sec 17 covers plain references to the non-RLS
     * `organizations` table only.
     */
    resultingReturnId: uuid("resulting_return_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("import_rows_id_org_key").on(t.id, t.organizationId),
    /**
     * Keyed on a RANDOM UUID a non-owner cannot guess. This is exactly why
     * F40/F103 does not fire on this table and ordinary tenant DML is safe.
     */
    unique("import_rows_batch_row_key").on(t.batchId, t.rowIndex),
    foreignKey({
      name: "import_rows_batch_fk",
      columns: [t.batchId, t.organizationId],
      foreignColumns: [importBatches.id, importBatches.organizationId],
    }),
    /**
     * F104 — the about-org composite, and the reasoning matters because both
     * obvious candidates are WRONG, for OPPOSITE dispositions:
     *
     *   `(resultingReturnId, organizationId) -> (id, organizationId)` refuses
     *     `duplicate`, whose target is a congregation-owned `submitted`
     *     return (reachable, because `presby_list_published_returns_to_me()`
     *     hands the presbytery that return's id).
     *   `(resultingReturnId, resolvedOrgId) -> (id, organizationId)` refuses
     *     `matched_*`/`created_dissolved`, where the minted return is
     *     presbytery-owned.
     *
     * The referent's owning org VARIES BY DISPOSITION, so no pair involving
     * `organizationId` is true. The disposition-independent invariant is
     * `statisticalReturns.aboutOrgId = importRows.resolvedOrgId` — true by
     * construction for the minted-import cases, and true for the submitted
     * case by `statistical_returns_submitted_is_self`. Same idiom as
     * `statisticsSubmissionGrants` (`drizzle/0049:161-162`) and
     * `congregationStatistics -> publications`: *`about_org_id` is the column
     * that matches.* A composite FK that is semantically false is not a
     * security improvement but a correctness bug that silently refuses a
     * legal write.
     *
     * MATCH SIMPLE's null skip is closed by `import_rows_resolution_shape`
     * below: `reportYear` is always non-null, every branch permitting a
     * non-null pointer also requires `resolvedOrgId` non-null, and
     * `unresolved`/`rejected` force the pointer null — so the FK is enforced
     * EXACTLY when the pointer exists. Weakening either constraint re-opens
     * the other's hole.
     *
     * There is deliberately NO validating trigger: an invoker-rights read of
     * FORCE-RLS `statistical_returns` from `presby_freeze_import_row()` would
     * return zero rows for exactly the cross-tenant `duplicate` case (F26).
     */
    foreignKey({
      name: "import_rows_resulting_return_fk",
      columns: [t.resultingReturnId, t.resolvedOrgId, t.reportYear],
      foreignColumns: [
        statisticalReturns.id,
        statisticalReturns.aboutOrgId,
        statisticalReturns.reportYear,
      ],
    }),
    index("import_rows_batch_idx").on(t.batchId),
    index("import_rows_org_status_idx").on(t.organizationId, t.resolutionKind),
    check(
      "import_rows_resolution_kind_allowed",
      sql`${t.resolutionKind} in ('unresolved','matched_existing','matched_alias','created_dissolved','duplicate','rejected')`,
    ),
    check("import_rows_row_index_nonneg", sql`${t.rowIndex} >= 0`),
    check(
      "import_rows_report_year_range",
      sql`${t.reportYear} between 1900 and 2100`,
    ),
    check(
      "import_rows_raw_payload_shape",
      sql`jsonb_typeof(${t.rawPayload}) = 'object'`,
    ),
    check(
      "import_rows_candidates_shape",
      sql`jsonb_typeof(${t.candidates}) = 'array'`,
    ),
    /**
     * The shape CHECK, in `statistical_returns_provenance_shape`'s idiom, and
     * half of the MATCH SIMPLE argument above. Note what it does NOT do: it
     * never asserts that `resultingReturnId` agrees with
     * `statisticalReturns.stagingRowId` (F102).
     *
     * `duplicate` deliberately does not REQUIRE `resultingReturnId`: a
     * duplicate of a `submitted` return that was never published has an
     * unobtainable uuid, and `duplicate` + `rationale` + a permanently null
     * pointer is the legal, meaningful state for it ("known duplicate, target
     * not readable by us").
     */
    check(
      "import_rows_resolution_shape",
      sql`(${t.resolutionKind} = 'unresolved'
             and ${t.resolvedOrgId} is null and ${t.resolvedBy} is null
             and ${t.resolvedAt} is null and ${t.resultingReturnId} is null
             and ${t.rationale} is null)
          or (${t.resolutionKind} in ('matched_existing','matched_alias','created_dissolved')
             and ${t.resolvedOrgId} is not null and ${t.resolvedBy} is not null
             and ${t.resolvedAt} is not null)
          or (${t.resolutionKind} = 'duplicate'
             and ${t.resolvedOrgId} is not null and ${t.resolvedBy} is not null
             and ${t.resolvedAt} is not null and ${t.rationale} is not null)
          or (${t.resolutionKind} = 'rejected'
             and ${t.resolvedOrgId} is null and ${t.resolvedBy} is not null
             and ${t.resolvedAt} is not null and ${t.rationale} is not null
             and ${t.resultingReturnId} is null)`,
    ),
    // import_rows_freeze (BEFORE UPDATE OR DELETE, every connection, two
    // permitted paths) is in drizzle/0053 only. See this module's header.
  ],
);

/**
 * The six `resolution_kind` values. `text` + CHECK rather than a `pgEnum`:
 * every domain value added since `drizzle/0044` is text+CHECK, this list WILL
 * grow when `presby_organize_congregation()` lands, and a CHECK swap in a
 * migration beats `ALTER TYPE` ordering.
 *
 *   `unresolved`        the `not null default`, so quarantine is a NAMED
 *                       state and never a null.
 *   `matched_existing`  resolved to an organization by its current name.
 *   `matched_alias`     resolved via an `organizationNameHistory` alias.
 *   `created_dissolved` D13's third disposition. NAMEABLE BUT UNREACHABLE
 *                       until `presby_organize_congregation()` ships — do not
 *                       go hunting for its writer.
 *   `duplicate`         this source row restates a return that already
 *                       exists. Requires a `rationale`.
 *   `rejected`          not a congregation, a header row, a total line.
 *                       Requires a `rationale`.
 */
export type ResolutionKind =
  | "unresolved"
  | "matched_existing"
  | "matched_alias"
  | "created_dissolved"
  | "duplicate"
  | "rejected";
