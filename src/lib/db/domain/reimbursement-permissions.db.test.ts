/**
 * drizzle/0074_presby_reimbursement_permissions.sql, proven on a real
 * database (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 "Migration
 * 0074", EC29; DECISION-269 as amended by P3-2 / F322).
 *
 *   - the catalog rows (tier 2; 2FA for view, pay, manage) and their
 *     descriptions (Copy C9);
 *   - the treasurer and reimbursement_clerk templates;
 *   - the backfill touches ONLY designation-minted treasurer copies
 *     (organization-owned, key treasurer, constitutional, protected), never a
 *     custom role or founding_administrator, and is idempotent (applied twice);
 *   - the whole file replays cleanly;
 *   - the closing assertion fails when a forbidden role carries a key or the
 *     template lost one (failing-first, inside rolled-back transactions);
 *   - presby_two_factor_required() arm B picks the new 2FA keys up with no
 *     function change, and does not for request_for_others.
 *
 * Owner connection throughout; every write is rolled back except the fixture
 * rows, which the organization teardown removes.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/reimbursement-permissions.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture, Row } from "@/lib/testing/reimbursement-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const M74 = readFileSync(path.join(process.cwd(), "drizzle", "0074_presby_reimbursement_permissions.sql"), "utf8");

function section(n: number): string {
  const start = M74.search(new RegExp(`^-- ${n}\\. `, "m"));
  const next = M74.search(new RegExp(`^-- ${n + 1}\\. `, "m"));
  if (start < 0) throw new Error(`section ${n} not found`);
  return M74.slice(start, next < 0 ? undefined : next);
}

const DESCRIPTIONS: Record<string, string> = {
  "reimbursement.request_for_others": "Enter a reimbursement request on behalf of another member",
  "reimbursement.view": "View every reimbursement request, receipt and history, and export them",
  "reimbursement.pay":
    "Record and reverse reimbursement payments, waive a receipt, send a request back, void it, or approve it when no one else can",
  "reimbursement.manage": "Choose which groups can receive reimbursement requests, manage categories and the treasury team",
};
const KEYS = Object.keys(DESCRIPTIONS).sort();

class Rollback extends Error {}

describe.skipIf(!hasDb)("drizzle/0074 reimbursement permissions (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let rowsOf: (r: unknown) => Row[];
  let pgError: (e: unknown) => { code: string | undefined; message: string };
  type Tx = Parameters<Parameters<ReimbursementFixture["platform"]["transaction"]>[0]>[0];

  async function rolledBack(fn: (tx: Tx) => Promise<void>) {
    await fx.platform
      .transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  }
  const x = async (tx: Tx, text: string) => rowsOf(await tx.execute(sql.raw(text)));

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    rowsOf = mod.rowsOf;
    pgError = mod.pgError;
    fx = await mod.createReimbursementFixture("perm");
  });
  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("the catalog: four tier-2 keys, two-factor for view, pay and manage, descriptions as Copy C9", async () => {
    const rows = await fx.q(sql`select key, module, description, sensitivity_tier, requires_two_factor
                                  from permissions where module = 'reimbursement' order by key`);
    expect(rows.map((r) => r.key)).toEqual(KEYS);
    for (const r of rows) {
      expect(r.description).toBe(DESCRIPTIONS[String(r.key)]);
      expect(Number(r.sensitivity_tier)).toBe(2);
      expect(r.requires_two_factor).toBe(r.key !== "reimbursement.request_for_others");
    }
  });

  it("the treasurer template carries the four (and still giving's three); the clerk template carries request_for_others alone", async () => {
    const t = await fx.q(sql`select rp.permission_key from app_roles r join app_role_permissions rp on rp.role_id = r.id
                              where r.organization_id is null and r.key = 'treasurer' order by 1`);
    expect(t.map((r) => r.permission_key)).toEqual(["giving.manage", "giving.record", "giving.view", ...KEYS].sort());
    const c = await fx.q(sql`select r.role_kind, r.is_protected, r.organization_type_scope, rp.permission_key
                               from app_roles r join app_role_permissions rp on rp.role_id = r.id
                              where r.organization_id is null and r.key = 'reimbursement_clerk'`);
    expect(c).toEqual([{ role_kind: "custom", is_protected: false, organization_type_scope: null,
      permission_key: "reimbursement.request_for_others" }]);
  });

  it("no founding_administrator, stated clerk, session_member or installed_pastor role carries a reimbursement key, anywhere", async () => {
    const [r] = await fx.q(sql`select count(*)::int as n from app_roles r
      join app_role_permissions rp on rp.role_id = r.id join permissions pm on pm.key = rp.permission_key
     where pm.module = 'reimbursement'
       and r.key in ('founding_administrator', 'stated_clerk', 'congregation_stated_clerk', 'presbytery_stated_clerk',
                     'session_member', 'installed_pastor')`);
    expect(r!.n).toBe(0);
  });

  it("EC29: the backfill binds the four keys to designation-minted copies only, and is idempotent", async () => {
    await rolledBack(async (tx) => {
      const org = await fx.makeOrg("backfill");
      const role = async (key: string, kind: string, isProtected: boolean) => {
        const [r] = rowsOf(await tx.execute(sql`
          insert into app_roles (organization_id, key, name, role_kind, is_protected)
          values (${org}, ${key}, ${key}, ${kind}, ${isProtected}) returning id`));
        await tx.execute(sql`insert into app_role_permissions (role_id, permission_key) values (${r!.id}, 'giving.view')`);
        return String(r!.id);
      };
      // The designation-minted shape; a congregation's adopted copy (custom); founding administrator.
      const minted = await role("treasurer", "constitutional", true);
      const founding = await role("founding_administrator", "constitutional", true);
      const otherOrg = await fx.makeOrg("backfill-adopted");
      const [adopted] = rowsOf(await tx.execute(sql`
        insert into app_roles (organization_id, key, name, role_kind, is_protected)
        values (${otherOrg}, 'treasurer', 'Treasurer', 'custom', false) returning id`));

      const keysOf = async (id: string) =>
        rowsOf(await tx.execute(sql`select permission_key from app_role_permissions
                                     where role_id = ${id} and permission_key like 'reimbursement.%' order by 1`))
          .map((r) => r.permission_key);
      const total = async () =>
        Number(rowsOf(await tx.execute(sql`select count(*)::int as n from app_role_permissions where permission_key like 'reimbursement.%'`))[0]!.n);

      await x(tx, section(4));
      const afterOnce = await total();
      await x(tx, section(4));
      expect(await total()).toBe(afterOnce);
      expect(await keysOf(minted)).toEqual(KEYS);
      expect(await keysOf(founding)).toEqual([]);
      expect(await keysOf(String(adopted!.id))).toEqual([]);
      await x(tx, section(5)); // the closing assertion holds after the backfill
    });
  });

  it("the whole file replays inside a transaction with no error and no row-count change", async () => {
    await rolledBack(async (tx) => {
      const count = async () => Number(rowsOf(await tx.execute(sql`
        select (select count(*) from permissions where module = 'reimbursement')
             + (select count(*) from app_role_permissions where permission_key like 'reimbursement.%')
             + (select count(*) from app_roles where key = 'reimbursement_clerk') as n`))[0]!.n);
      const before = await count();
      await x(tx, M74);
      await x(tx, M74);
      expect(await count()).toBe(before);
    });
  });

  it("the closing assertion fails first: a key on a protected non-treasurer role, or a template missing a key", async () => {
    await rolledBack(async (tx) => {
      const org = await fx.makeOrg("assert");
      const [r] = rowsOf(await tx.execute(sql`
        insert into app_roles (organization_id, key, name, role_kind, is_protected)
        values (${org}, 'stated_clerk', 'Clerk of Session', 'constitutional', true) returning id`));
      await tx.execute(sql`insert into app_role_permissions (role_id, permission_key) values (${r!.id}, 'reimbursement.view')`);
      let caught: unknown;
      try {
        await tx.transaction(async (sp) => {
          await sp.execute(sql.raw(section(5)));
        });
      } catch (err) {
        caught = err;
      }
      expect(pgError(caught).message).toMatch(/roles carry a reimbursement key they must not/);
    });
    await rolledBack(async (tx) => {
      await tx.execute(sql`delete from app_role_permissions where permission_key = 'reimbursement.pay'
                             and role_id = (select id from app_roles where organization_id is null and key = 'treasurer')`);
      let caught: unknown;
      try {
        await tx.transaction(async (sp) => {
          await sp.execute(sql.raw(section(5)));
        });
      } catch (err) {
        caught = err;
      }
      expect(pgError(caught).message).toContain("the treasurer template does not carry the four reimbursement keys");
    });
  });

  it("presby_two_factor_required() arm B picks up view, pay and manage with no function change; request_for_others alone does not", async () => {
    const org = await fx.makeOrg("tfa");
    const viewer = await fx.member(org, "TfaViewer");
    const clerk = await fx.member(org, "TfaClerk");
    await fx.grant(org, await fx.makeRole(org, "tfa_view", ["reimbursement.view"]), viewer.personId);
    await fx.grant(org, await fx.makeRole(org, "tfa_clerk", ["reimbursement.request_for_others"]), clerk.personId);
    const [r] = await fx.q(sql`select presby_two_factor_required(${viewer.userId}) as v, presby_two_factor_required(${clerk.userId}) as c`);
    expect(r).toEqual({ v: true, c: false });
  });
});
