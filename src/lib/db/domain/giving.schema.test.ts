/**
 * Schema pin for drizzle/0055_presby_giving.sql (DECISION-172/175) and
 * drizzle/0056_presby_giving_statements.sql (DECISION-173, Batch 5a).
 *
 * `npm run check:schema-parity` compares columns, nullability and foreign keys
 * between the Drizzle domain model and the live catalog; it deliberately does
 * NOT compare CHECK constraints or indexes. This file is the complement for
 * the parts it skips: every constraint and index name 0055 creates on a giving
 * table must be declared on the matching Drizzle table, so a reader of
 * `src/lib/db/domain/giving.ts` sees the shape the database enforces.
 *
 * The expected names are READ FROM THE MIGRATION (so a constraint added to
 * 0055 without a mirror fails here) and the table list is literal (so a table
 * silently dropped from either side fails here too).
 *
 * Pure: no database. Policies, grants, FORCE RLS and triggers are not
 * expressible in the table builder; scripts/giving/test-rls-46.sql and
 * giving.db.test.ts prove those.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
// Enter the domain cycle through the canonical entry point FIRST (schema.ts
// re-exports ./domain): entering at giving.ts -> ./org -> ../schema reaches
// authz.ts before org.ts has initialised `organizationType` (the same reason
// events.schema.test.ts imports from "../schema"). ./giving is not yet
// re-exported from ./domain/index.ts - that line is an integration edit.
import { permissions } from "../schema";
import * as giving from "./giving";

const readMigration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../drizzle/${file}`, import.meta.url)), "utf8");
const MIGRATION_0056 = readMigration("0056_presby_giving_statements.sql");
const MIGRATION = `${readMigration("0055_presby_giving.sql")}\n${MIGRATION_0056}`;

/**
 * Created by 0056 but deliberately NOT declared in giving.ts: the composite FK
 * into blob_assets. assets.ts is imported by the storage adapter alone
 * (DECISION-058), so giving.ts does not import it; scripts/check-schema-parity.ts
 * carries the matching `extra_fk` allowlist row. Nothing else may join this set.
 */
const DDL_ONLY = new Set(["giving_statements_blob_fk"]);
const BLOB_FK_SIGNATURE = "(blob_asset_id,organization_id) -> blob_assets(id,organization_id)";

function namesCreatedByMigration(): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, name: string) => {
    if (!table.startsWith("giving_")) return;
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(name);
  };
  for (const m of MIGRATION.matchAll(/alter table (\w+) add constraint (\w+)/g)) add(m[1], m[2]);
  for (const m of MIGRATION.matchAll(/create (?:unique )?index if not exists (\w+)\s+on (\w+)/g)) add(m[2], m[1]);
  for (const m of MIGRATION.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    for (const c of m[2].matchAll(/constraint (\w+)/g)) add(m[1], c[1]);
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
  ]);
}

const TABLES: PgTable[] = [
  giving.givingSettings,
  giving.givingProviderConnections,
  giving.givingFunds,
  giving.givingDonors,
  giving.givingDonorIdentities,
  giving.givingDonorLinkDecisions,
  giving.givingCheckoutIntents,
  giving.givingProviderEvents,
  giving.givingGifts,
  giving.givingGiftReversals,
  giving.givingSettlements,
  giving.givingSettlementLines,
  giving.givingStatements,
  giving.givingStatementLines,
  giving.givingStatementDeliveries,
];

const COMPOSITE_FKS = [
  "giving_donors_link_fk",
  "giving_donors_merge_fk",
  "giving_identities_donor_fk",
  "giving_identities_conn_fk",
  "giving_link_decisions_donor_fk",
  "giving_link_decisions_member_fk",
  "giving_intents_conn_fk",
  "giving_intents_fund_fk",
  "giving_intents_member_fk",
  "giving_intents_donor_fk",
  "giving_events_conn_fk",
  "giving_gifts_donor_fk",
  "giving_gifts_fund_fk",
  "giving_gifts_conn_fk",
  "giving_gifts_intent_fk",
  "giving_gifts_event_fk",
  "giving_reversals_gift_fk",
  "giving_reversals_conn_fk",
  "giving_reversals_offsets_fk",
  "giving_reversals_event_fk",
  "giving_settlements_conn_fk",
  "giving_settlement_lines_settlement_fk",
  "giving_settlement_lines_gift_fk",
  // 0056
  "giving_statements_donor_fk",
  "giving_statements_supersedes_fk",
  "giving_statement_lines_statement_fk",
  "giving_statement_lines_gift_fk",
  "giving_statement_deliveries_statement_fk",
];

describe("drizzle/0055 + 0056 constraint and index names are mirrored in giving.ts", () => {
  const created = namesCreatedByMigration();

  it("the two migrations create exactly the fifteen giving tables the domain file declares", () => {
    expect([...created.keys()].sort()).toEqual(TABLES.map((t) => getTableName(t)).sort());
  });

  it("the parser is not vacuous: it finds the 28 composite FKs and the partial indexes", () => {
    const all = new Set([...created.values()].flatMap((s) => [...s]));
    for (const fk of COMPOSITE_FKS) expect(all.has(fk), fk).toBe(true);
    expect(all.has("giving_connections_one_open_idx")).toBe(true);
    expect(all.has("giving_donors_one_unidentified_idx")).toBe(true);
    expect(all.has("giving_gifts_txn_idx")).toBe(true);
    expect(all.has("giving_statements_supersedes_once_idx")).toBe(true);
    expect(all.has("giving_statements_version_key")).toBe(true);
    expect(COMPOSITE_FKS).toHaveLength(28);
  });

  it.each(TABLES.map((t) => [getTableName(t), t] as const))(
    "%s declares every name 0055/0056 create on it, and nothing they do not",
    (name, table) => {
      const declared = namesDeclaredByDrizzle(table);
      const expected = created.get(name) ?? new Set<string>();
      for (const n of expected) {
        if (DDL_ONLY.has(n)) continue;
        expect(declared.has(n), `${name} does not declare ${n}`).toBe(true);
      }
      // Drizzle auto-names the single-column `.references()` FKs (to
      // organizations and users); Postgres names those inline FKs itself and
      // check:schema-parity compares them by SHAPE. Every other declared name
      // must exist in 0055.
      for (const n of declared) {
        if (/_(organizations|users)_id_fk$/.test(n)) continue;
        expect(expected.has(n), `${name} declares ${n}, which 0055/0056 do not create`).toBe(true);
      }
    },
  );
});

describe("0056: the DDL-only blob FK", () => {
  it("0056 creates giving_statements_blob_fk as a composite FK into blob_assets", () => {
    expect(MIGRATION_0056).toMatch(
      /constraint giving_statements_blob_fk foreign key \(blob_asset_id, organization_id\)\s+references blob_assets \(id, organization_id\)/,
    );
    expect([...(namesCreatedByMigration().get("giving_statements") ?? [])]).toContain("giving_statements_blob_fk");
  });

  it("giving.ts does not declare it (and does not import assets.ts)", () => {
    expect(getTableConfig(giving.givingStatements).foreignKeys.map((fk) => fk.getName())).not.toContain(
      "giving_statements_blob_fk",
    );
    const source = readFileSync(fileURLToPath(new URL("./giving.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/from "\.\/assets"/);
  });

  it("check:schema-parity allowlists exactly that signature as an architectural extra_fk", () => {
    const checker = readFileSync(
      fileURLToPath(new URL("../../../../scripts/check-schema-parity.ts", import.meta.url)),
      "utf8",
    );
    const entry = checker.slice(checker.indexOf('table: "giving_statements"'));
    expect(entry).toContain('kind: "extra_fk"');
    expect(entry).toContain(`fk: "${BLOB_FK_SIGNATURE}"`);
    expect(entry.slice(0, entry.indexOf("since:"))).toContain('category: "architectural"');
  });
});

describe("the shapes behind the names", () => {
  it("every inter-table FK is composite (x_id, organization_id) -> (id, organization_id) - F2", () => {
    const fks = TABLES.flatMap((t) => getTableConfig(t).foreignKeys);
    const composite = fks.filter((fk) => COMPOSITE_FKS.includes(fk.getName()));
    expect(composite).toHaveLength(COMPOSITE_FKS.length);
    for (const fk of composite) {
      const ref = fk.reference();
      expect(ref.columns.map((c) => c.name)[1], fk.getName()).toBe("organization_id");
      expect(ref.foreignColumns.map((c) => c.name), fk.getName()).toEqual(["id", "organization_id"]);
      // NO ACTION (Postgres default): never RESTRICT, never SET NULL (DECISION-161).
      expect(fk.onDelete ?? "no action", fk.getName()).toBe("no action");
    }
  });

  it("statement totals are bigint; statement line amounts are integer cents", () => {
    const type = (t: PgTable, col: string) =>
      getTableConfig(t).columns.find((c) => c.name === col)?.getSQLType();
    expect(type(giving.givingStatements, "cash_total_cents")).toBe("bigint");
    expect(type(giving.givingStatementLines, "amount_cents")).toBe("integer");
    expect(type(giving.givingStatementLines, "gross_cents")).toBe("integer");
  });

  it("no statement table has an updated_at - the rows are frozen (0056 giving_*_freeze)", () => {
    for (const t of [giving.givingStatements, giving.givingStatementLines, giving.givingStatementDeliveries]) {
      expect(getTableConfig(t).columns.map((c) => c.name), getTableName(t)).not.toContain("updated_at");
    }
  });

  it("giving_donors has no person_id column (schema-design section 7)", () => {
    expect(getTableConfig(giving.givingDonors).columns.map((c) => c.name)).not.toContain("person_id");
  });

  it("every giving table except giving_settings carries unique (id, organization_id)", () => {
    for (const t of TABLES) {
      const keys = getTableConfig(t).uniqueConstraints.filter((u) => u.getName()?.endsWith("_id_org_key"));
      if (t === giving.givingSettings) {
        expect(keys).toHaveLength(0);
      } else {
        expect(keys.map((u) => u.columns.map((c) => c.name)), getTableName(t)).toEqual([["id", "organization_id"]]);
      }
    }
  });

  it("the provider enum has exactly one value (Vanco is designed for, not shipped)", () => {
    expect(giving.givingProvider.enumValues).toEqual(["stripe"]);
  });

  it("permissions.requires_two_factor is declared (check:schema-parity would report extra_column otherwise)", () => {
    const col = getTableConfig(permissions).columns.find((c) => c.name === "requires_two_factor");
    expect(col?.notNull).toBe(true);
  });

  it("settlement amounts are bigint; gift amounts are integer cents", () => {
    const type = (t: PgTable, col: string) =>
      getTableConfig(t).columns.find((c) => c.name === col)?.getSQLType();
    expect(type(giving.givingSettlementLines, "net_cents")).toBe("bigint");
    expect(type(giving.givingSettlements, "gross_cents")).toBe("bigint");
    expect(type(giving.givingGifts, "amount_cents")).toBe("integer");
  });
});
