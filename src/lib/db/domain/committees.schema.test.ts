/**
 * D1: schema pin for drizzle/0090_presby_committees.sql (DECISION-353, 354,
 * 355, 358; docs/work-log/2026-11-19-presbytery-committees.md Phase 3 "Test
 * plan" D1).
 *
 * Two halves:
 *
 *   1. Pure (no database): every constraint and index name 0090 creates on
 *      the three new tables is declared on the matching Drizzle table in
 *      committees.ts, and nothing else; the composite FKs have the right
 *      shape; the vocabularies in committees.ts and the group_role CHECK in
 *      groups.ts are the migration's CHECK lists; the commission tables carry
 *      no role_id, group_id or public_listed (DECISION-355). Names are READ
 *      FROM THE MIGRATION; the table list is literal (the oversight precedent).
 *
 *   2. Postgres-backed (skipped without a database): the Drizzle columns and
 *      their nullability equal information_schema for the three tables, and
 *      the catalog's constraint and index names equal the Drizzle names; the
 *      live group_role CHECK equals the mirrored one. This is the
 *      check:schema-parity comparison before ./committees is re-exported from
 *      ./index.ts at integration (Rule 16).
 *
 * Policies, grants, FORCE RLS and triggers are not expressible in the table
 * builder; scripts/committees/test-rls-90.sql and committees.db.test.ts prove
 * those.
 *
 * Run the DB half with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/committees.schema.test.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { getTableName, sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
// Enter the domain cycle through the canonical entry point first (the reason
// giving.schema.test.ts gives); ./committees is re-exported from ./index.ts
// only at integration (Rule 16).
import { permissions } from "../schema";
import * as committees from "./committees";
import { groupMemberships } from "./groups";

vi.mock("server-only", () => ({}));

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../drizzle/0090_presby_committees.sql", import.meta.url)),
  "utf8",
);

/** Line comments removed, so a marker quoted in a comment can never satisfy an assertion. */
const SQL_NO_COMMENTS = MIGRATION.replace(/--[^\n]*/g, "");
const FLAT = SQL_NO_COMMENTS.replace(/\s+/g, " ");

const TABLES: PgTable[] = [
  committees.committeeDetails,
  committees.commissionRecords,
  committees.commissionRecordMembers,
];
const NEW_TABLE_NAMES = new Set(TABLES.map((t) => getTableName(t)));

/** The composite FKs (F2): name -> [columns, target table, target columns]. */
const COMPOSITE_FKS: Record<string, [string[], string, string[]]> = {
  committee_details_group_fk: [["group_id", "organization_id"], "groups", ["id", "organization_id"]],
  commission_record_members_record_fk: [
    ["commission_record_id", "organization_id"],
    "commission_records",
    ["id", "organization_id"],
  ],
  commission_record_members_person_fk: [
    ["person_id", "organization_id"],
    "memberships",
    ["person_id", "organization_id"],
  ],
};

const SEVEN_ROLES = ["chair", "leader", "member", "vice_chair", "clerk", "secretary", "ex_officio"];

function namesCreatedByMigration(): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, name: string) => {
    if (!NEW_TABLE_NAMES.has(table)) return;
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

describe("drizzle/0090 constraint and index names are mirrored in committees.ts", () => {
  const created = namesCreatedByMigration();

  it("the import entry point resolves (domain cycle order)", () => {
    expect(getTableName(permissions)).toBe("permissions");
  });

  it("0090 creates exactly the three tables the domain file declares", () => {
    const createdTables = [...SQL_NO_COMMENTS.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]!);
    expect(createdTables.sort()).toEqual([...NEW_TABLE_NAMES].sort());
  });

  it("the parser is not vacuous: it finds the three composite FKs, the 1:1 key and every index", () => {
    const all = new Set([...created.values()].flatMap((s) => [...s]));
    for (const n of [
      ...Object.keys(COMPOSITE_FKS),
      "committee_details_group_key",
      "committee_details_org_idx",
      "commission_records_org_idx",
      "commission_records_about_idx",
      "commission_record_members_record_idx",
      "commission_record_members_one_open_idx",
      "commission_record_members_person_idx",
    ]) {
      expect(all.has(n), n).toBe(true);
    }
  });

  it.each(TABLES.map((t) => [getTableName(t), t] as const))(
    "%s declares exactly the names 0090 creates for it",
    (name, table) => {
      const expected = created.get(name) ?? new Set<string>();
      const declared = new Set([...namesDeclaredByDrizzle(table)].filter((n) => !AUTO_FK.test(n)));
      for (const n of expected) {
        expect(declared.has(n), `0090 creates ${n} on ${name}, which committees.ts does not declare`).toBe(true);
      }
      for (const n of declared) {
        expect(expected.has(n), `${name} declares ${n}, which 0090 does not create`).toBe(true);
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

describe("the shapes behind the names (F2, DECISION-353, 355)", () => {
  it("the three composite FKs name both columns on both sides, NO ACTION", () => {
    const fks = TABLES.flatMap((t) => getTableConfig(t).foreignKeys).filter((fk) => fk.getName() in COMPOSITE_FKS);
    expect(fks.map((fk) => fk.getName()).sort()).toEqual(Object.keys(COMPOSITE_FKS).sort());
    for (const fk of fks) {
      const [cols, target, targetCols] = COMPOSITE_FKS[fk.getName()]!;
      const ref = fk.reference();
      expect(ref.columns.map((c) => c.name), fk.getName()).toEqual(cols);
      expect(getTableName(ref.foreignTable), fk.getName()).toBe(target);
      expect(ref.foreignColumns.map((c) => c.name), fk.getName()).toEqual(targetCols);
      expect(fk.onDelete ?? "no action", fk.getName()).toBe("no action");
    }
  });

  it("the only single-column FKs go to organizations (organization_id cascade, about_org_id NO ACTION) and users (NO ACTION)", () => {
    for (const t of TABLES) {
      const single = getTableConfig(t).foreignKeys.filter((fk) => !(fk.getName() in COMPOSITE_FKS));
      for (const fk of single) {
        const ref = fk.reference();
        const col = ref.columns[0]!.name;
        expect(ref.columns, `${getTableName(t)}.${fk.getName()}`).toHaveLength(1);
        expect(["organizations", "users"]).toContain(getTableName(ref.foreignTable));
        if (col === "organization_id") expect(fk.onDelete).toBe("cascade");
        else expect(fk.onDelete ?? "no action", `${getTableName(t)}.${col}`).toBe("no action");
      }
    }
    const aboutFk = getTableConfig(committees.commissionRecords).foreignKeys.find(
      (fk) => fk.reference().columns[0]!.name === "about_org_id",
    );
    expect(aboutFk && getTableName(aboutFk.reference().foreignTable)).toBe("organizations");
  });

  it("NO GRANT BY CONSTRUCTION: neither commission table has a role_id, group_id or public_listed column (DECISION-355)", () => {
    for (const t of [committees.commissionRecords, committees.commissionRecordMembers]) {
      const cols = getTableConfig(t).columns.map((c) => c.name);
      for (const banned of ["role_id", "group_id", "public_listed"]) {
        expect(cols, `${getTableName(t)}.${banned}`).not.toContain(banned);
      }
    }
    // ...and the migration itself never declares one on them.
    for (const m of SQL_NO_COMMENTS.matchAll(/create table if not exists (commission_\w+) \(([\s\S]*?)\n\);/g)) {
      expect(m[2]!, m[1]!).not.toMatch(/\b(role_id|group_id|public_listed)\b/);
    }
  });

  it("the vocabularies in committees.ts are the migration's CHECK lists", () => {
    const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(FLAT).toContain(`kind is null or kind in (${list(committees.COMMITTEE_DETAIL_KINDS)})`);
    expect(FLAT).toContain(`check (role in (${list(committees.COMMISSION_MEMBER_ROLES)}))`);
    expect(committees.COMMISSION_MEMBER_ROLES).not.toContain("leader");
    expect(committees.COMMISSION_MEMBER_ROLES).toHaveLength(6);
  });

  it("the group_role CHECK is the seven values, in 0090 and in groups.ts's mirror (DECISION-354)", () => {
    const list = SEVEN_ROLES.map((v) => `'${v}'`).join(", ");
    expect(FLAT).toContain(
      `alter table group_memberships add constraint group_memberships_group_role_check check (group_role in (${list}))`,
    );
    const mirrored = getTableConfig(groupMemberships).checks.find((c) => c.name === "group_memberships_group_role_check");
    expect(mirrored, "groups.ts mirrors the CHECK").toBeDefined();
    // The six commission roles are the seven minus the legacy seat word.
    expect([...committees.COMMISSION_MEMBER_ROLES].sort()).toEqual(SEVEN_ROLES.filter((r) => r !== "leader").sort());
  });

  it("COMMISSION_LIMITS equal the CHECK bounds", () => {
    expect(FLAT).toContain(`char_length(btrim(title)) between 1 and ${committees.COMMISSION_LIMITS.titleMax}`);
    expect(FLAT).toContain(`char_length(charge) <= ${committees.COMMISSION_LIMITS.chargeMax}`);
    expect(FLAT).toContain(`char_length(minute_reference) <= ${committees.COMMISSION_LIMITS.minuteMax}`);
    expect(FLAT).toContain(`char_length(ended_minute_reference) <= ${committees.COMMISSION_LIMITS.minuteMax}`);
    expect(FLAT.match(new RegExp(`>= date '${committees.COMMISSION_LIMITS.dateFloor}'`, "g"))).toHaveLength(3);
  });

  it("COMMITTEES_GUARD_CODES equal the CONSTRAINT names the guards raise", () => {
    const raised = new Set([...SQL_NO_COMMENTS.matchAll(/constraint = '(\w+)'/g)].map((m) => m[1]!));
    expect([...raised].sort()).toEqual(Object.values(committees.COMMITTEES_GUARD_CODES).sort());
  });

  it("no column carries a Drizzle $onUpdate (it would put a trigger-owned or store-owned column in every SET list)", () => {
    for (const t of TABLES) {
      for (const c of getTableConfig(t).columns) {
        expect((c as unknown as { onUpdateFn?: unknown }).onUpdateFn, `${getTableName(t)}.${c.name}`).toBeUndefined();
      }
    }
  });
});

describe("the migration text", () => {
  it("every CHECK is drop-then-add, so an in-place correction changes it", () => {
    const adds = [...SQL_NO_COMMENTS.matchAll(/alter table (\w+) add constraint (\w+)\s+check/g)];
    expect(adds.length).toBeGreaterThanOrEqual(16);
    for (const m of adds) {
      const drop = SQL_NO_COMMENTS.indexOf(`alter table ${m[1]} drop constraint if exists ${m[2]};`);
      expect(drop, m[2]).toBeGreaterThan(-1);
      expect(drop, m[2]).toBeLessThan(m.index!);
    }
  });

  it("no DELETE is granted and nothing is granted to presby_platform", () => {
    const grants = [...SQL_NO_COMMENTS.matchAll(/^\s*grant\b[^;]*;/gim)].map((m) => m[0]);
    expect(grants.length).toBeGreaterThanOrEqual(5);
    for (const g of grants) {
      expect(g, g).not.toMatch(/\bdelete\b|\btruncate\b|\ball\b/i);
      expect(g, g).not.toMatch(/presby_platform/i);
    }
  });

  it("never names the founding-administrator bundle function, not even in a comment (F362 hazard)", () => {
    expect(MIGRATION).not.toMatch(/presby_founding_administrator_permission_keys/);
  });

  it("never writes the downward tables or a role (DECISION-355)", () => {
    expect(SQL_NO_COMMENTS).not.toMatch(
      /\b(insert into|update|delete from|alter table|truncate)\s+(administrative_commissions|org_delegations|role_grants)\b/i,
    );
  });
});

const hasDb = Boolean(process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("committees.ts against the live catalog (information_schema; Postgres-backed)", () => {
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
    "%s: the catalog's constraint and index names equal committees.ts's (bar Drizzle's auto-named single FKs)",
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
      expect([...declared].sort()).toEqual([...live].sort());
    },
  );

  it("the live group_role CHECK admits exactly the seven values", async () => {
    const { getPlatformDb } = await import("@/lib/db");
    const rows = rowsOf(
      await getPlatformDb().execute(sql`
        select pg_get_constraintdef(oid) as d from pg_constraint
         where conname = 'group_memberships_group_role_check' and conrelid = 'group_memberships'::regclass`),
    );
    expect(rows).toHaveLength(1);
    const values = [...String(rows[0]!.d).matchAll(/'(\w+)'::text/g)].map((m) => m[1]!);
    expect(values.sort()).toEqual([...SEVEN_ROLES].sort());
  });
});
