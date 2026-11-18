/**
 * D1: schema pin for drizzle/0089_presby_oversight_records.sql (DECISION-344,
 * 349; docs/work-log/2026-11-17-congregation-profile.md Phase 3 "Test plan").
 *
 * Two halves:
 *
 *   1. Pure (no database): every constraint and index name 0089 creates on an
 *      oversight table is declared on the matching Drizzle table in
 *      oversight.ts, and nothing else; the composite FKs have the right
 *      shape; the vocabularies in oversight.ts are the migration's CHECK
 *      lists. Names are READ FROM THE MIGRATION; the table list is literal
 *      (the worship.schema.test.ts precedent).
 *
 *   2. Postgres-backed (skipped without a database): the Drizzle columns and
 *      their nullability equal information_schema for all six tables, and the
 *      catalog's constraint and index names equal the Drizzle names. This is
 *      the check:schema-parity comparison for the six tables before
 *      ./oversight is re-exported from ./index.ts at integration (Rule 16);
 *      check:schema-parity takes over after that.
 *
 * Policies, grants, FORCE RLS and triggers are not expressible in the table
 * builder; scripts/oversight/test-rls-89.sql and oversight.db.test.ts prove
 * those.
 *
 * Run the DB half with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/oversight.schema.test.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { getTableName, sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
// Enter the domain cycle through the canonical entry point first (the reason
// giving.schema.test.ts gives); ./oversight is re-exported from ./index.ts
// only at integration (Rule 16).
import { permissions } from "../schema";
import * as oversight from "./oversight";

vi.mock("server-only", () => ({}));

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../drizzle/0089_presby_oversight_records.sql", import.meta.url)),
  "utf8",
);

/** Line comments removed, so a marker quoted in a comment can never satisfy an assertion. */
const SQL_NO_COMMENTS = MIGRATION.replace(/--[^\n]*/g, "");

const TABLES: PgTable[] = [
  oversight.oversightProfiles,
  oversight.oversightBuildings,
  oversight.oversightBuildingPhotos,
  oversight.oversightBuildingAppraisals,
  oversight.oversightInsuranceYears,
  oversight.oversightLoans,
];

/** The child FKs onto a building: three columns, so a child cannot name another congregation's building. */
const BUILDING_FKS = [
  "oversight_building_photos_building_fk",
  "oversight_building_appraisals_building_fk",
  "oversight_loans_building_fk",
];

/** DDL-only (oversight.ts does not import assets.ts, DECISION-058); allowlisted in check-schema-parity.ts. */
const DDL_ONLY = new Set(["oversight_building_photos_image_fk", "oversight_building_photos_thumb_fk"]);

function namesCreatedByMigration(): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, name: string) => {
    if (!table.startsWith("oversight_")) return;
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(name);
  };
  for (const m of SQL_NO_COMMENTS.matchAll(/alter table (\w+) add constraint (\w+)/g)) add(m[1]!, m[2]!);
  for (const m of SQL_NO_COMMENTS.matchAll(/create (?:unique )?index if not exists (\w+)\s+on (\w+)/g)) add(m[2]!, m[1]!);
  for (const m of SQL_NO_COMMENTS.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    for (const c of m[2]!.matchAll(/constraint (\w+)/g)) add(m[1]!, c[1]!);
  }
  return byTable;
}

function namesDeclaredByDrizzle(table: PgTable): Set<string> {
  const cfg = getTableConfig(table);
  return new Set<string>([
    ...cfg.checks.map((c) => c.name),
    ...cfg.indexes.map((i) => i.config.name).filter((n): n is string => Boolean(n)),
    ...cfg.uniqueConstraints.map((u) => u.getName()).filter((n): n is string => Boolean(n)),
    ...cfg.foreignKeys.map((fk) => fk.getName()),
    ...cfg.primaryKeys.map((pk) => pk.getName()),
  ]);
}

/** Drizzle auto-names single-column .references() FKs (organizations, users). */
const AUTO_FK = /_(organizations|users)_id_fk$/;

describe("drizzle/0089 constraint and index names are mirrored in oversight.ts", () => {
  const created = namesCreatedByMigration();

  it("the import entry point resolves (domain cycle order)", () => {
    expect(getTableName(permissions)).toBe("permissions");
  });

  it("0089 creates exactly the six tables the domain file declares", () => {
    expect([...created.keys()].sort()).toEqual(TABLES.map((t) => getTableName(t)).sort());
  });

  it("the parser is not vacuous: it finds the three building FKs, both blob FKs, the three-column key and every partial index", () => {
    const all = new Set([...created.values()].flatMap((s) => [...s]));
    for (const n of [
      ...BUILDING_FKS,
      ...DDL_ONLY,
      "oversight_buildings_id_org_about_key",
      "oversight_profiles_org_about_key",
      "oversight_buildings_live_name_idx",
      "oversight_buildings_one_primary_idx",
      "oversight_building_photos_live_image_idx",
      "oversight_building_photos_one_cover_idx",
      "oversight_building_photos_building_idx",
      "oversight_building_appraisals_live_year_idx",
      "oversight_insurance_years_live_year_idx",
      "oversight_loans_about_idx",
      "oversight_buildings_primary_not_retired",
    ]) {
      expect(all.has(n), n).toBe(true);
    }
  });

  it.each(TABLES.map((t) => [getTableName(t), t] as const))(
    "%s declares every name 0089 creates on it (bar the DDL-only blob FKs), and nothing it does not",
    (name, table) => {
      const declared = namesDeclaredByDrizzle(table);
      const expected = created.get(name) ?? new Set<string>();
      for (const n of expected) {
        if (DDL_ONLY.has(n)) continue;
        expect(declared.has(n), `${name} does not declare ${n}`).toBe(true);
      }
      for (const n of declared) {
        if (AUTO_FK.test(n)) continue;
        expect(expected.has(n), `${name} declares ${n}, which 0089 does not create`).toBe(true);
      }
    },
  );

  it("every table carries a unique key named after itself plus _id_org_key (F2: the composite FK target)", () => {
    for (const t of TABLES) {
      const names = getTableConfig(t).uniqueConstraints.map((u) => u.getName());
      expect(names, getTableName(t)).toContain(`${getTableName(t)}_id_org_key`);
    }
  });
});

describe("the shapes behind the names (F2, Gap 12, R5)", () => {
  it("the three building FKs are (building_id, organization_id, about_org_id) -> oversight_buildings (id, organization_id, about_org_id), NO ACTION", () => {
    const fks = TABLES.flatMap((t) => getTableConfig(t).foreignKeys).filter((fk) => BUILDING_FKS.includes(fk.getName()));
    expect(fks.map((fk) => fk.getName()).sort()).toEqual([...BUILDING_FKS].sort());
    for (const fk of fks) {
      const ref = fk.reference();
      expect(ref.columns.map((c) => c.name), fk.getName()).toEqual(["building_id", "organization_id", "about_org_id"]);
      expect(getTableName(ref.foreignTable)).toBe("oversight_buildings");
      expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id", "organization_id", "about_org_id"]);
      expect(fk.onDelete ?? "no action", fk.getName()).toBe("no action");
    }
  });

  it("the only single-column FKs go to organizations (organization_id cascade, about_org_id NO ACTION) and users (actors, NO ACTION)", () => {
    for (const t of TABLES) {
      const single = getTableConfig(t).foreignKeys.filter((fk) => !BUILDING_FKS.includes(fk.getName()));
      for (const fk of single) {
        const ref = fk.reference();
        const target = getTableName(ref.foreignTable);
        const col = ref.columns[0]!.name;
        expect(ref.columns, `${getTableName(t)}.${fk.getName()}`).toHaveLength(1);
        expect(["organizations", "users"]).toContain(target);
        if (col === "organization_id") expect(fk.onDelete).toBe("cascade");
        else expect(fk.onDelete ?? "no action", `${getTableName(t)}.${col}`).toBe("no action");
      }
      const toOrgs = single.filter((fk) => getTableName(fk.reference().foreignTable) === "organizations");
      expect(toOrgs.map((fk) => fk.reference().columns[0]!.name).sort(), getTableName(t)).toEqual([
        "about_org_id",
        "organization_id",
      ]);
    }
  });

  it("the vocabularies in oversight.ts are the migration's CHECK lists", () => {
    const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    const flat = SQL_NO_COMMENTS.replace(/\s+/g, " ");
    expect(flat).toContain(`building_type in (${list(oversight.OVERSIGHT_BUILDING_TYPES)})`);
    for (const c of ["roof", "plumbing", "hvac", "boiler"]) {
      expect(flat).toContain(`${c}_condition in (${list(oversight.OVERSIGHT_CONDITIONS)})`);
    }
    expect(flat).toContain(`retired_reason in (${list(oversight.OVERSIGHT_RETIRE_REASONS)})`);
    expect(flat).toContain(`kind in (${list(oversight.OVERSIGHT_LOAN_KINDS)})`);
    expect(flat).toContain(`status in (${list(oversight.OVERSIGHT_LOAN_STATUSES)})`);
    expect(flat.match(new RegExp(`provenance in \\(${list(oversight.OVERSIGHT_PROVENANCES)}\\)`, "g"))).toHaveLength(5);
  });

  it("every money CHECK uses OVERSIGHT_MONEY_MAX_CENTS", () => {
    const maxes = [...SQL_NO_COMMENTS.matchAll(/_cents between 0 and (\d+)/g)].map((m) => Number(m[1]));
    expect(maxes).toHaveLength(4);
    for (const m of maxes) expect(m).toBe(oversight.OVERSIGHT_MONEY_MAX_CENTS);
  });

  it("OVERSIGHT_GUARD_CODES equal the CONSTRAINT names the guards raise", () => {
    const raised = new Set([...SQL_NO_COMMENTS.matchAll(/constraint = '(oversight_guard_\w+)'/g)].map((m) => m[1]!));
    expect([...raised].sort()).toEqual(Object.values(oversight.OVERSIGHT_GUARD_CODES).sort());
  });

  it("the two DDL-only blob FKs are allowlisted, by exact signature, in scripts/check-schema-parity.ts", () => {
    const parity = readFileSync(
      fileURLToPath(new URL("../../../../scripts/check-schema-parity.ts", import.meta.url)),
      "utf8",
    );
    for (const sig of [
      "(asset_audience,image_asset_key,organization_id) -> blob_assets(audience,id,organization_id)",
      "(asset_audience,organization_id,thumb_asset_key) -> blob_assets(audience,organization_id,id)",
    ]) {
      const at = parity.indexOf(`fk: "${sig}"`, parity.indexOf('table: "oversight_building_photos"'));
      expect(at, sig).toBeGreaterThan(-1);
    }
  });

  it("no column carries a Drizzle $onUpdate (it would put a trigger-owned or store-owned column in every SET list)", () => {
    for (const t of TABLES) {
      for (const c of getTableConfig(t).columns) {
        expect((c as unknown as { onUpdateFn?: unknown }).onUpdateFn, `${getTableName(t)}.${c.name}`).toBeUndefined();
      }
    }
  });

  it("the removal pair is on every table but profiles; row_version on exactly the four editable tables (T5)", () => {
    const cols = (t: PgTable) => getTableConfig(t).columns.map((c) => c.name);
    for (const t of TABLES) {
      const has = cols(t).includes("removed_at") && cols(t).includes("removed_by");
      expect(has, getTableName(t)).toBe(getTableName(t) !== "oversight_profiles");
    }
    expect(TABLES.filter((t) => cols(t).includes("row_version")).map((t) => getTableName(t)).sort()).toEqual([
      "oversight_buildings",
      "oversight_insurance_years",
      "oversight_loans",
      "oversight_profiles",
    ]);
  });
});

describe("the migration text", () => {
  it("every CHECK is drop-then-add, so an in-place correction changes it", () => {
    const adds = [...SQL_NO_COMMENTS.matchAll(/alter table (\w+) add constraint (\w+)\s+check/g)];
    expect(adds.length).toBeGreaterThan(40);
    for (const m of adds) {
      const drop = SQL_NO_COMMENTS.indexOf(`alter table ${m[1]} drop constraint if exists ${m[2]};`);
      expect(drop, m[2]).toBeGreaterThan(-1);
      expect(drop, m[2]).toBeLessThan(m.index!);
    }
  });

  it("the founding bundle keeps the live base and worship arms verbatim and adds the finance key after manage, presbytery only", () => {
    const start = SQL_NO_COMMENTS.indexOf("create or replace function presby_founding_administrator_permission_keys(");
    const body = SQL_NO_COMMENTS.slice(start, SQL_NO_COMMENTS.indexOf("$function$;", start));
    expect(body).toContain(
      "array['people.manage', 'roles.manage', 'role_grants.manage', 'groups.manage',\n" +
        "               'officers.manage', 'org_features.manage', 'tickets.file', 'staff.manage',\n" +
        "               'domains.manage', 'careers.manage', 'careers.applicants']::text[]",
    );
    expect(body).toMatch(
      /when p_org_type in \('congregation', 'new_worshiping_community'\)\s+then array\['worship\.manage', 'worship\.plan', 'worship\.schedule'\]::text\[\]/,
    );
    expect(body).toMatch(
      /when p_org_type = 'presbytery'\s+then array\['congregation_oversight\.manage', 'congregation_oversight\.finance'\]::text\[\]/,
    );
    expect(body.match(/congregation_oversight\.finance/g)).toHaveLength(1);
  });

  it("no DELETE is granted and nothing is granted to presby_platform", () => {
    const grants = [...SQL_NO_COMMENTS.matchAll(/^\s*grant\b[^;]*;/gim)].map((m) => m[0]);
    expect(grants.length).toBeGreaterThanOrEqual(7);
    for (const g of grants) {
      expect(g, g).not.toMatch(/\bdelete\b|\btruncate\b|\ball\b/i);
      expect(g, g).not.toMatch(/presby_platform/i);
    }
  });
});

const hasDb = Boolean(process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("oversight.ts against the live catalog (information_schema; Postgres-backed)", () => {
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));

  it.each(TABLES.map((t) => [getTableName(t), t] as const))(
    "%s: columns and nullability equal information_schema, both directions",
    async (name, table) => {
      const { getPlatformDb } = await import("@/lib/db");
      const rows = rowsOf(
        await getPlatformDb().execute(sql`
          select column_name, is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = ${name} order by column_name`),
      );
      const live = Object.fromEntries(rows.map((r) => [String(r.column_name), r.is_nullable === "NO"]));
      const drizzle = Object.fromEntries(getTableConfig(table).columns.map((c) => [c.name, c.notNull]));
      expect(Object.keys(live).length, `${name} exists in the catalog`).toBeGreaterThan(0);
      expect(drizzle).toEqual(live);
    },
  );

  it.each(TABLES.map((t) => [getTableName(t), t] as const))(
    "%s: the catalog's constraint and index names equal oversight.ts's (bar Drizzle's auto-named single FKs and the DDL-only blob FKs)",
    async (name, table) => {
      const { getPlatformDb } = await import("@/lib/db");
      const rows = rowsOf(
        await getPlatformDb().execute(sql`
          select conname as n from pg_constraint where conrelid = ${name}::regclass
            and contype <> 'n' -- Postgres 18 catalogs NOT NULL as a constraint; nullability is the test above
            and conname not like '%\_fkey' and conname not like '%\_pkey'
          union
          select indexname from pg_indexes where tablename = ${name}
            and indexname not like '%\_pkey'
            and indexname not in (select conname from pg_constraint where conrelid = ${name}::regclass)`),
      );
      const live = new Set(rows.map((r) => String(r.n)));
      const declared = new Set([...namesDeclaredByDrizzle(table)].filter((n) => !AUTO_FK.test(n)));
      for (const n of DDL_ONLY) live.delete(n);
      expect([...declared].sort()).toEqual([...live].sort());
    },
  );
});
