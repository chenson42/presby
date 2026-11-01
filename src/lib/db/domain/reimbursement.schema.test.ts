/**
 * Schema pin for drizzle/0073_presby_reimbursements.sql (DECISION-267, F2).
 *
 * `npm run check:schema-parity` compares columns, nullability and foreign keys
 * between the Drizzle domain model and the live catalog; it does NOT compare
 * CHECK constraints or indexes. This file is the complement: every constraint
 * and index name 0073 creates on a reimbursement table must be declared on the
 * matching Drizzle table (reimbursement.ts), so a reader sees the shape the
 * database enforces. Names are READ FROM THE MIGRATION, the table list is
 * literal.
 *
 * Pure: no database. Policies, grants, FORCE RLS and triggers are not
 * expressible in the table builder; scripts/treasury/test-rls-73.sql and the
 * reimbursement*.db.test.ts files prove those.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
// Enter the domain cycle through the canonical entry point first (the reason
// giving.schema.test.ts gives); ./reimbursement is re-exported from
// ./domain/index.ts only at integration (Rule 16).
import { permissions } from "../schema";
import * as reimbursement from "./reimbursement";

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../drizzle/0073_presby_reimbursements.sql", import.meta.url)),
  "utf8",
);

/** Line comments removed, so a marker quoted in a comment can never satisfy an assertion. */
const SQL_NO_COMMENTS = MIGRATION.replace(/--[^\n]*/g, "");

const TABLES: PgTable[] = [
  reimbursement.reimbursementChargeableGroups,
  reimbursement.reimbursementCategories,
  reimbursement.reimbursementRequests,
  reimbursement.reimbursementAttachments,
  reimbursement.reimbursementPayments,
  reimbursement.reimbursementEvents,
];

/** Composite (x, organization_id) FKs; the target columns per FK. */
const COMPOSITE_FKS: Record<string, [string, string]> = {
  reimbursement_chargeable_groups_group_fk: ["id", "organization_id"],
  reimbursement_requests_group_fk: ["id", "organization_id"],
  reimbursement_requests_category_fk: ["id", "organization_id"],
  reimbursement_requests_creator_fk: ["person_id", "organization_id"],
  reimbursement_requests_beneficiary_fk: ["person_id", "organization_id"],
  reimbursement_requests_approver_fk: ["person_id", "organization_id"],
  reimbursement_requests_waiver_person_fk: ["person_id", "organization_id"],
  reimbursement_attachments_request_fk: ["id", "organization_id"],
  reimbursement_payments_request_fk: ["id", "organization_id"],
  reimbursement_payments_payer_fk: ["person_id", "organization_id"],
  reimbursement_payments_offsets_fk: ["id", "organization_id"],
  reimbursement_events_request_fk: ["id", "organization_id"],
  reimbursement_events_actor_fk: ["person_id", "organization_id"],
  reimbursement_events_payment_fk: ["id", "organization_id"],
};

/**
 * Names 0073 creates that the mirror deliberately does NOT declare. One entry:
 * the receipt FK into blob_assets, DDL-only because declaring it would make
 * reimbursement.ts import assets.ts (DECISION-058; giving_statements_blob_fk is
 * the precedent). Pinned by text below instead, and by catalog in
 * reimbursement.db.test.ts and scripts/treasury/test-rls-73.sql (73a).
 */
const DDL_ONLY = new Set(["reimbursement_attachments_blob_fk"]);

function namesCreatedByMigration(): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, name: string) => {
    if (!table.startsWith("reimbursement_")) return;
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(name);
  };
  for (const m of MIGRATION.matchAll(/alter table (\w+) add constraint (\w+)/g)) add(m[1]!, m[2]!);
  for (const m of MIGRATION.matchAll(/create (?:unique )?index if not exists (\w+)\s+on (\w+)/g)) add(m[2]!, m[1]!);
  for (const m of MIGRATION.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
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
  ]);
}

describe("drizzle/0073 constraint and index names are mirrored in reimbursement.ts", () => {
  const created = namesCreatedByMigration();

  it("the import entry point resolves (domain cycle order)", () => {
    expect(getTableName(permissions)).toBe("permissions");
  });

  it("0073 creates exactly the six tables the domain file declares", () => {
    expect([...created.keys()].sort()).toEqual(TABLES.map((t) => getTableName(t)).sort());
  });

  it("the parser is not vacuous: it finds every composite FK and the partial indexes", () => {
    const all = new Set([...created.values()].flatMap((s) => [...s]));
    for (const fk of Object.keys(COMPOSITE_FKS)) expect(all.has(fk), fk).toBe(true);
    for (const idx of ["reimbursement_chargeable_groups_one_active_idx", "reimbursement_categories_active_name_idx",
      "reimbursement_attachments_live_sha_idx", "reimbursement_payments_one_reversal_idx",
      "reimbursement_events_request_seq_idx"]) {
      expect(all.has(idx), idx).toBe(true);
    }
  });

  it.each(TABLES.map((t) => [getTableName(t), t] as const))(
    "%s declares every name 0073 creates on it, and nothing it does not",
    (name, table) => {
      const declared = namesDeclaredByDrizzle(table);
      const expected = created.get(name) ?? new Set<string>();
      for (const n of expected) {
        if (DDL_ONLY.has(n)) {
          expect(declared.has(n), `${name} declares the DDL-only ${n}`).toBe(false);
          continue;
        }
        expect(declared.has(n), `${name} does not declare ${n}`).toBe(true);
      }
      for (const n of declared) {
        // Drizzle auto-names single-column .references() FKs (organizations, users).
        if (/_(organizations|users)_id_fk$/.test(n)) continue;
        expect(expected.has(n), `${name} declares ${n}, which 0073 does not create`).toBe(true);
      }
    },
  );
});

describe("the shapes behind the names (F2, DECISION-270)", () => {
  it("every inter-table FK is composite on organization_id, NO ACTION (never cascade, never set null)", () => {
    const fks = TABLES.flatMap((t) => getTableConfig(t).foreignKeys).filter((fk) => fk.getName() in COMPOSITE_FKS);
    expect(fks).toHaveLength(Object.keys(COMPOSITE_FKS).length);
    for (const fk of fks) {
      const ref = fk.reference();
      expect(ref.columns.map((c) => c.name)[1], fk.getName()).toBe("organization_id");
      expect(ref.foreignColumns.map((c) => c.name), fk.getName()).toEqual(COMPOSITE_FKS[fk.getName()]);
      expect(fk.onDelete ?? "no action", fk.getName()).toBe("no action");
    }
  });

  it("the only single-column FKs go to organizations (cascade) and users (actors)", () => {
    for (const t of TABLES) {
      for (const fk of getTableConfig(t).foreignKeys) {
        if (fk.getName() in COMPOSITE_FKS) continue;
        const target = getTableName(fk.reference().foreignTable);
        expect(["organizations", "users"], `${getTableName(t)}.${fk.getName()}`).toContain(target);
        if (target === "organizations") expect(fk.onDelete).toBe("cascade");
      }
    }
  });

  it("money is integer cents; there is no fund or account column yet (Increment 5)", () => {
    const type = (t: PgTable, col: string) => getTableConfig(t).columns.find((c) => c.name === col)?.getSQLType();
    expect(type(reimbursement.reimbursementRequests, "amount_cents")).toBe("integer");
    expect(type(reimbursement.reimbursementPayments, "amount_cents")).toBe("integer");
    for (const t of TABLES) {
      const cols = getTableConfig(t).columns.map((c) => c.name);
      expect(cols.some((c) => /fund|account/.test(c)), getTableName(t)).toBe(false);
    }
  });

  it("receipts carry the constant private audience, and 0073 pins it in the three-column FK into blob_assets (F289)", () => {
    const col = getTableConfig(reimbursement.reimbursementAttachments).columns.find((c) => c.name === "asset_audience");
    expect(col?.notNull).toBe(true);
    expect(col?.default).toBe("private");
    expect(SQL_NO_COMMENTS).toMatch(
      /alter table reimbursement_attachments add constraint reimbursement_attachments_blob_fk\s+foreign key \(blob_key, organization_id, asset_audience\)\s+references blob_assets \(id, organization_id, audience\) on delete no action on update no action;/,
    );
    // Drop-then-add, so the whole file re-applies.
    expect(SQL_NO_COMMENTS.indexOf("drop constraint if exists reimbursement_attachments_blob_fk")).toBeGreaterThan(-1);
    expect(SQL_NO_COMMENTS.indexOf("drop constraint if exists reimbursement_attachments_blob_fk")).toBeLessThan(
      SQL_NO_COMMENTS.indexOf("add constraint reimbursement_attachments_blob_fk"),
    );
    expect(MIGRATION).not.toContain("TODO(Batch 1b");
    // The mirror stays off assets.ts (DECISION-058): no FK of the attachments table targets blob_assets.
    for (const fk of getTableConfig(reimbursement.reimbursementAttachments).foreignKeys) {
      expect(getTableName(fk.reference().foreignTable)).not.toBe("blob_assets");
    }
  });

  it("D10: the 0072 guard raises before the FIRST table is created (the file has no transaction of its own)", () => {
    const guard = SQL_NO_COMMENTS.indexOf("raise exception 'reimbursement 0073: apply 0072 (blob_assets audience) first'");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(SQL_NO_COMMENTS.indexOf("create table if not exists"));
    expect(SQL_NO_COMMENTS).toMatch(/conname = 'blob_assets_id_org_audience_key'/);
  });

  it("D7: attach_receipt's pre-check names only this organization's PRIVATE blob of the stated type and size", () => {
    const start = SQL_NO_COMMENTS.indexOf("create or replace function presby_reimbursement_attach_receipt(");
    const body = SQL_NO_COMMENTS.slice(start, SQL_NO_COMMENTS.indexOf("create or replace function", start + 10));
    expect(body).toMatch(
      /not exists \(select 1 from blob_assets b\s+where b\.id = p_blob_key and b\.organization_id = v_org\s+and b\.audience = 'private'\s+and b\.content_type = p_content_type and b\.byte_size = p_byte_size\)/,
    );
  });

  it("no table has a deletable_until column (the delete guard admits only the org-teardown cascade)", () => {
    for (const t of TABLES) {
      expect(getTableConfig(t).columns.map((c) => c.name), getTableName(t)).not.toContain("deletable_until");
    }
  });
});
