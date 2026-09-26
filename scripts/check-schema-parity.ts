/**
 * check:schema-parity — does the live catalog match the TypeScript domain
 * model?
 *
 * WHY THIS EXISTS. On 2026-08-17 four columns drifted between the committed
 * `drizzle/*.sql` files and the live database via an untracked `db:push` /
 * hand-run `ALTER TABLE`: `officer_terms.recorded_by` and
 * `roll_actions.proposed_by` stayed wrongly `NOT NULL` in the SQL, and
 * `administrative_commissions.group_id` / `org_delegations.group_id` existed
 * live and in TypeScript but in no migration at all. Nothing caught it for
 * six weeks, because `drizzle/0010`'s resolver references the two missing
 * columns inside a `language plpgsql` body — Postgres does not name-resolve
 * a plpgsql body at CREATE FUNCTION time, so every migration reported
 * success and `presby_effective_permissions()` raised on its FIRST CALL.
 * `drizzle/0050_presby_schema_parity.sql` closed the drift; this script is
 * what keeps it closed.
 *
 * WHERE IT RUNS. `.github/workflows/db.yml`, immediately after `db:migrate`
 * and before `db:seed`, against the freshly migrated ephemeral database
 * (DECISION-150). It is deliberately NOT part of `npm run check`: the five
 * tripwires there are pure static scans that run offline in a fresh clone
 * with no secrets, and a sixth that needs a database would force Neon
 * secrets onto the fork-safe `ci.yml`.
 *
 * WHY NOT drizzle-kit. `generate` diffs against `drizzle/meta/`, which holds
 * 13 snapshots against 51 journal entries (newest `0012_snapshot.json`) — it
 * would emit one migration containing everything hand-written since 0013.
 * `check` only validates journal/snapshot shape and never opens a database.
 * `push` does diff the TS model against a live database — and is literally
 * how this drift was introduced — but it APPLIES what it finds rather than
 * reporting it, has no dry-run, and in a non-TTY CI shell a difference is
 * likely to be silently applied and exit 0. A check that fixes what it
 * should report is the failure mode this script exists to prevent.
 *
 * SCOPE. The presby domain only (`src/lib/db/domain`), which is where the
 * drift occurred and where the DDL is hand-written. `src/lib/db/schema.ts`'s
 * platform-shell tables are Drizzle Kit's own territory and are excluded.
 * Compared, in this order: table presence, column presence (both
 * directions), column nullability, foreign-key shape (both directions).
 * Defaults, index parity, and check constraints are an explicit non-goal for
 * this version — columns/nullability/FK shape is the class of drift that has
 * actually occurred, twice.
 *
 * Tables present in the database but absent from the domain model are NOT
 * reported: every platform-shell table would be one.
 *
 * Exit 0 only when every non-allowlisted difference count is zero. Exit 1 on
 * any real difference AND on any connection or query error — a check that
 * cannot reach the database must fail loud, never default-succeed on a
 * swallowed exception.
 */
import { neon } from "@neondatabase/serverless";
import { is, getTableName } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as domain from "../src/lib/db/domain";

type DiffKind =
  | "missing_table"
  | "missing_column"
  | "extra_column"
  | "nullability"
  | "missing_fk"
  | "extra_fk";

/**
 * Explicitly-approved differences between the TS domain model and the live
 * catalog. Two categories, and they are NOT the same thing:
 *
 *   category "architectural" — the difference is permanent and correct. The
 *     constraint exists in the database and deliberately cannot be expressed
 *     in the Drizzle table builder without breaking something else. Every
 *     such entry must point at the in-code comment that already explains it
 *     AND at the migration line that enforces it. No docs/TODO.md line: there
 *     is nothing to close.
 *
 *   category "pending" — real, unclosed drift. EMPTY IS THE GOAL. Every such
 *     entry must also carry a docs/TODO.md line naming the pipeline that will
 *     close it. Adding one without a TODO line is not allowed, and a "pending"
 *     entry that outlives a release is a bug report, not a policy.
 *
 * In-file rather than a separate config, matching this repo's existing
 * convention (`check-brand-scope.mjs`'s literal EMITTERS array,
 * `check-secrets-pii.mjs`'s literal safe-domain list).
 *
 * An `extra_fk`/`missing_fk` entry MUST name the exact `fk` signature — see
 * the matcher below. A table-wide FK exemption would grow blind spots.
 *
 * Ships with five "architectural" rows and ZERO "pending" rows: drizzle/0050
 * closes every real difference the 2026-09-26 from-scratch rehearsal found.
 */
const ALLOWLIST: Array<{
  table: string;
  column?: string;
  kind: DiffKind;
  /** Exact fkSignature(); required for missing_fk / extra_fk. */
  fk?: string;
  category: "architectural" | "pending";
  reason: string;
  since: string; // YYYY-MM-DD
}> = [
  // --- The blob_assets composite FKs (3 rows) --------------------------------
  // src/lib/db/domain/assets.ts:63-78 states the reason in full: declaring
  // these on the referencing side would make org.ts / sites.ts / support.ts
  // import assets.ts, while assets.ts already imports `organizations` from
  // org.ts. That is the domain graph's first module cycle and it breaks at
  // module-load time. The composite FK is therefore enforced in the migration,
  // "where it has no import graph to honor." The constraint IS present and IS
  // composite — F2 is satisfied in the database, which is the axis that counts.
  {
    table: "organization_brands",
    kind: "extra_fk",
    fk: "(mark_asset_key,organization_id) -> blob_assets(id,organization_id)",
    category: "architectural",
    reason:
      "DDL-only composite FK (drizzle/0016_presby_brand_storage.sql); declaring it in org.ts would create an org.ts <-> assets.ts module cycle — see assets.ts:63-78.",
    since: "2026-09-26",
  },
  {
    table: "organization_brands",
    kind: "extra_fk",
    fk: "(organization_id,wordmark_asset_key) -> blob_assets(organization_id,id)",
    category: "architectural",
    reason:
      "Same cycle-avoidance as mark_asset_key above (drizzle/0016); assets.ts:63-78.",
    since: "2026-09-26",
  },
  {
    table: "organization_sites",
    kind: "extra_fk",
    fk: "(content_bundle_key,organization_id) -> blob_assets(id,organization_id)",
    category: "architectural",
    reason:
      "DDL-only composite FK into blob_assets; same cycle-avoidance as organization_brands — assets.ts:63-78.",
    since: "2026-09-26",
  },
  {
    table: "ticket_messages",
    kind: "extra_fk",
    fk: "(attachment_asset_key,organization_id) -> blob_assets(id,organization_id)",
    category: "architectural",
    reason:
      "DDL-only composite FK into blob_assets; same cycle-avoidance as organization_brands — assets.ts:63-78.",
    since: "2026-09-26",
  },
  // --- The submission-grant STAMP (1 row) ------------------------------------
  // src/lib/db/domain/returns.ts:364 says so in the column's own docstring:
  // "THE STAMP. Composite FK to `statistical_returns` is 0049-only."
  // Enforced at drizzle/0049_presby_submission_grants.sql:161-162.
  {
    table: "statistics_submission_grants",
    kind: "extra_fk",
    fk: "(about_org_id,return_id) -> statistical_returns(organization_id,id)",
    category: "architectural",
    reason:
      "DDL-only composite FK, declared 0049-only by design (returns.ts:364; drizzle/0049:161-162) — the grant is owned by the presbytery and the return by the congregation.",
    since: "2026-09-26",
  },
];

type Diff = {
  kind: DiffKind;
  table: string;
  column?: string;
  /** The exact fkSignature() for missing_fk / extra_fk. Undefined otherwise. */
  fk?: string;
  detail: string;
};

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    "[schema-parity] MIGRATE_DATABASE_URL (or DATABASE_URL) is not set. " +
      "This check reads the catalog as the owner on the direct endpoint.",
  );
  process.exit(1);
}

/** Order-insensitive signature for a foreign key. Constraint NAMES are
 *  deliberately excluded: a branch that received a column via `drizzle-kit
 *  push` names it `..._group_id_groups_id_fk` while a hand-written migration
 *  names it whatever the author chose, and both are the same constraint. */
function fkSignature(
  foreignTable: string,
  pairs: Array<[string, string]>,
): string {
  const sorted = [...pairs].sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
  );
  return `(${sorted.map((p) => p[0]).join(",")}) -> ${foreignTable}(${sorted
    .map((p) => p[1])
    .join(",")})`;
}

async function main() {
  const sql = neon(url!);

  // ---- the TypeScript side -------------------------------------------------
  const tsTables = new Map<
    string,
    {
      columns: Map<string, { notNull: boolean }>;
      fks: Set<string>;
    }
  >();

  for (const value of Object.values(domain)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    const columns = new Map<string, { notNull: boolean }>();
    for (const col of cfg.columns) {
      columns.set(col.name, { notNull: col.notNull });
    }
    const fks = new Set<string>();
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const pairs = ref.columns.map(
        (c, i) => [c.name, ref.foreignColumns[i]!.name] as [string, string],
      );
      fks.add(fkSignature(getTableName(ref.foreignTable), pairs));
    }
    tsTables.set(getTableName(value), { columns, fks });
  }

  // ---- the catalog side ----------------------------------------------------
  const columnRows = (await sql`
    select c.relname   as table_name,
           a.attname   as column_name,
           a.attnotnull as not_null
      from pg_attribute a
      join pg_class     c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attnum > 0
       and not a.attisdropped
  `) as Array<{ table_name: string; column_name: string; not_null: boolean }>;

  // unnest(conkey, confkey) WITH ORDINALITY pairs each local column with the
  // foreign column Postgres actually stored opposite it, rather than zipping
  // two independently-ordered arrays and hoping.
  const fkRows = (await sql`
    select con.conname  as constraint_name,
           lc.relname   as table_name,
           fc.relname   as foreign_table,
           la.attname   as column_name,
           fa.attname   as foreign_column,
           u.ord        as ord
      from pg_constraint con
      join pg_class     lc on lc.oid = con.conrelid
      join pg_class     fc on fc.oid = con.confrelid
      join pg_namespace n  on n.oid  = lc.relnamespace
      cross join lateral unnest(con.conkey, con.confkey)
             with ordinality as u(lattnum, fattnum, ord)
      join pg_attribute la on la.attrelid = con.conrelid and la.attnum = u.lattnum
      join pg_attribute fa on fa.attrelid = con.confrelid and fa.attnum = u.fattnum
     where con.contype = 'f'
       and n.nspname = 'public'
     order by con.conname, u.ord
  `) as Array<{
    constraint_name: string;
    table_name: string;
    foreign_table: string;
    column_name: string;
    foreign_column: string;
    ord: number;
  }>;

  const dbColumns = new Map<string, Map<string, { notNull: boolean }>>();
  for (const r of columnRows) {
    let t = dbColumns.get(r.table_name);
    if (!t) {
      t = new Map();
      dbColumns.set(r.table_name, t);
    }
    t.set(r.column_name, { notNull: r.not_null });
  }

  const byConstraint = new Map<
    string,
    { table: string; foreignTable: string; pairs: Array<[string, string]> }
  >();
  for (const r of fkRows) {
    const key = `${r.table_name}.${r.constraint_name}`;
    let c = byConstraint.get(key);
    if (!c) {
      c = { table: r.table_name, foreignTable: r.foreign_table, pairs: [] };
      byConstraint.set(key, c);
    }
    c.pairs.push([r.column_name, r.foreign_column]);
  }
  const dbFks = new Map<string, Set<string>>();
  for (const c of byConstraint.values()) {
    let set = dbFks.get(c.table);
    if (!set) {
      set = new Set();
      dbFks.set(c.table, set);
    }
    set.add(fkSignature(c.foreignTable, c.pairs));
  }

  // ---- diff ----------------------------------------------------------------
  const diffs: Diff[] = [];

  for (const [tableName, ts] of [...tsTables.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const dbCols = dbColumns.get(tableName);
    if (!dbCols) {
      diffs.push({
        kind: "missing_table",
        table: tableName,
        detail: "declared in src/lib/db/domain, absent from the database",
      });
      continue;
    }

    for (const [colName, tsCol] of ts.columns) {
      const dbCol = dbCols.get(colName);
      if (!dbCol) {
        diffs.push({
          kind: "missing_column",
          table: tableName,
          column: colName,
          detail: "declared in the TS model, absent from the database",
        });
        continue;
      }
      if (dbCol.notNull !== tsCol.notNull) {
        diffs.push({
          kind: "nullability",
          table: tableName,
          column: colName,
          detail: `TS=${tsCol.notNull ? "NOT NULL" : "nullable"} DB=${
            dbCol.notNull ? "NOT NULL" : "nullable"
          }`,
        });
      }
    }

    for (const colName of dbCols.keys()) {
      if (!ts.columns.has(colName)) {
        diffs.push({
          kind: "extra_column",
          table: tableName,
          column: colName,
          detail: "present in the database, absent from the TS model",
        });
      }
    }

    const dbSet = dbFks.get(tableName) ?? new Set<string>();
    for (const sig of ts.fks) {
      if (!dbSet.has(sig)) {
        diffs.push({
          kind: "missing_fk",
          table: tableName,
          fk: sig,
          detail: `${sig} — declared in the TS model, absent from the database`,
        });
      }
    }
    for (const sig of dbSet) {
      if (!ts.fks.has(sig)) {
        diffs.push({
          kind: "extra_fk",
          table: tableName,
          fk: sig,
          detail: `${sig} — present in the database, absent from the TS model`,
        });
      }
    }
  }

  // ---- report --------------------------------------------------------------
  const failing: Diff[] = [];
  const allowed: Diff[] = [];
  for (const d of diffs) {
    const hit = ALLOWLIST.find((a) => {
      if (a.table !== d.table || a.kind !== d.kind) return false;
      // An FK entry must name the exact signature. Without this a single
      // `{ table, kind: "extra_fk" }` row would silently mask every FK that
      // ever appears on that table afterwards — an allowlist that grows
      // blind spots is worse than no allowlist.
      if (d.kind === "missing_fk" || d.kind === "extra_fk") {
        return a.fk === d.fk;
      }
      return a.column === undefined || a.column === d.column;
    });
    (hit ? allowed : failing).push(d);
  }

  for (const d of allowed) {
    const entry = ALLOWLIST.find(
      (a) =>
        a.table === d.table &&
        a.kind === d.kind &&
        (d.kind === "missing_fk" || d.kind === "extra_fk"
          ? a.fk === d.fk
          : a.column === undefined || a.column === d.column),
    )!;
    console.log(
      `[schema-parity] ALLOWED(${entry.category})  ${d.kind.toUpperCase()}  ${d.table}${
        d.column ? `.${d.column}` : ""
      }: ${d.detail}`,
    );
  }
  const pending = ALLOWLIST.filter((a) => a.category === "pending").length;
  for (const d of failing) {
    console.error(
      `[schema-parity] ${d.kind.toUpperCase()}  ${d.table}${
        d.column ? `.${d.column}` : ""
      }: ${d.detail}`,
    );
  }

  const summary = `[schema-parity] ${tsTables.size} domain tables compared — ${diffs.length} differences, ${allowed.length} allowlisted (${pending} of them unclosed drift), ${failing.length} failing`;

  if (failing.length > 0) {
    console.error(summary);
    console.error(
      "[schema-parity] Close each difference with a fix-forward migration, or " +
        "add it to ALLOWLIST in scripts/check-schema-parity.ts WITH a docs/TODO.md line.",
    );
    process.exit(1);
  }
  console.log(summary);
}

main().catch((err) => {
  console.error("[schema-parity] failed to complete:", err);
  process.exit(1);
});
