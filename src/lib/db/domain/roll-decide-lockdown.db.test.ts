/**
 * drizzle/0063_presby_roll_decide_lockdown.sql, proven against a real
 * database (docs/work-log/2026-10-22-founding-admin-directory.md, Increment 2
 * Phase 3 Test Plan 1.11; DECISION-203; F180, F191; the roll_actions part of
 * F176).
 *
 * 0063 is applied only after the code deploy (R16), so this file passes in
 * BOTH states:
 *   - the catalog half applies 0063's own text inside an owner transaction
 *     that is always rolled back, and asserts what it produces (privileges,
 *     policy, the CHECK, the stop-block). It runs in the 0062-only state and
 *     in the locked-down state alike (re-applying is idempotent);
 *   - the behavioural half needs presby_app's real view of the catalog, which
 *     an uncommitted owner transaction cannot give it. It runs only when 0063
 *     is actually applied (read from 0063's own CHECK, never from the
 *     privilege under test) and skips otherwise. Batch B applies 0063
 *     before its DB gate, so the behavioural half runs there;
 *     scripts/session-approval/test-rls-62.sql covers the same ground from
 *     psql.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/roll-decide-lockdown.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";
import { rowsOf, type Row } from "@/lib/testing/invitation-fixture";
import { APPROVABLE_ROLL_ACTION_KINDS } from "@/lib/roll-action-kinds";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const M63 = path.join(process.cwd(), "drizzle", "0063_presby_roll_decide_lockdown.sql");
// The seven approvable kinds, imported from the module the application uses
// (src/lib/roll-action-kinds.ts) rather than retyped: the live policy text is
// proven equal to the code's own list.
const APPROVABLE_KINDS: readonly string[] = APPROVABLE_ROLL_ACTION_KINDS;
const EXPECTED_WITH_CHECK =
  "((approval_status = 'pending'::text) AND (kind = ANY (ARRAY[" +
  APPROVABLE_KINDS.map((k) => `'${k}'::roll_action_kind`).join(", ") +
  "])))";

type Db = ReturnType<typeof import("@/lib/db").getPlatformDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class Rollback extends Error {}

function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  while (cur && out.length < 6) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}
function pgCode(err: unknown): string | undefined {
  for (const e of chain(err)) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}
function pgMessages(err: unknown): string {
  return chain(err).map((e) => (e instanceof Error ? e.message : String(e))).join(" :: ");
}

function section(n: number): string {
  const text = readFileSync(M63, "utf8");
  const start = text.search(new RegExp(`^-- ${n}\\. `, "m"));
  const end = text.search(new RegExp(`^-- ${n + 1}\\. `, "m"));
  if (start < 0 || end < 0) throw new Error(`section ${n} not found in 0063`);
  return text.slice(start, end);
}

describe.skipIf(!hasDb)("drizzle/0063 roll decide lockdown (Postgres-backed)", () => {
  let platform: Db;
  let appDb: typeof import("@/lib/db").db;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let counter = 0;
  const orgIds: string[] = [];
  const personIds: string[] = [];
  const userIds: string[] = [];
  let org: string;
  let actorUser: string;
  let locked = false;

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await platform.execute(query));
  }

  async function inRolledBackOwnerTx(fn: (tx: Tx) => Promise<void>) {
    try {
      await platform.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  async function rejected(tx: Tx, query: SQL): Promise<{ code?: string; text: string }> {
    let caught: unknown;
    try {
      await tx.transaction(async (sp) => { await sp.execute(query); });
    } catch (err) {
      caught = err;
    }
    if (!caught) throw new Error("expected the statement to be rejected");
    return { code: pgCode(caught), text: pgMessages(caught) };
  }

  async function asAppRejected(query: SQL): Promise<{ code?: string; text: string }> {
    let caught: unknown;
    try {
      await appDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
        await tx.execute(query);
      });
    } catch (err) {
      caught = err;
    }
    if (!caught) throw new Error("expected presby_app to be refused");
    return { code: pgCode(caught), text: pgMessages(caught) };
  }

  async function asAppRows(query: SQL, rollback = false): Promise<Row[]> {
    let out: Row[] = [];
    try {
      await appDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
        out = rowsOf(await tx.execute(query));
        if (rollback) throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    return out;
  }

  async function makePerson(first: string, userId: string | null = null): Promise<string> {
    counter += 1;
    const [row] = await q(sql`
      insert into people (first_name, last_name, user_id, deletable_until)
      values (${first}, ${`Lockdown${stamp}${counter}`}, ${userId}::uuid, ${fixtureDeletableUntil()}) returning id`);
    personIds.push(String(row!.id));
    await q(sql`insert into memberships (organization_id, person_id, engagement_status) values (${org}, ${row!.id}, 'regular')`);
    return String(row!.id);
  }

  async function ownerRoll(person: string, kind: string, roll: string | null, status: string): Promise<string> {
    const [row] = await q(sql`
      insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, recorded_at)
      values (${org}, ${person}, ${kind}::roll_action_kind, '2025-01-05', ${roll}, ${status}, clock_timestamp()) returning id`);
    return String(row!.id);
  }

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    platform = dbModule.getPlatformDb();
    appDb = dbModule.db;
    // "0063 is applied" is read from a marker 0063 adds (its CHECK), never
    // from the privilege under test: a re-granted UPDATE must make the
    // behavioural half FAIL, not skip.
    const [mark] = await q(sql`
      select exists (select 1 from pg_constraint
                      where conrelid = 'roll_actions'::regclass
                        and conname = 'roll_actions_terminal_decision_stamps') as applied`);
    locked = mark!.applied === true;

    await q(sql`insert into group_types (key, name) values ('roster', 'Roster'), ('court', 'Court') on conflict do nothing`);
    const slug = `rdl-${stamp}`;
    const [o] = await q(sql`
      insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
      values ('congregation', 'Fixture lockdown congregation', ${slug}, ${slug.replace(/-/g, "_")}, 'managed', ${fixtureDeletableUntil()})
      returning id`);
    org = String(o!.id);
    orgIds.push(org);
    await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      select ${org}, gt.id, v.name, 'derived', v.d, true
        from (values ('court', 'Session', 'session'), ('roster', 'Active Membership', 'active_membership')) as v(t, name, d)
        join group_types gt on gt.key = v.t`);
    const [u] = await q(sql`insert into users (email, name) values (${`rdl-actor-${stamp}@example.invalid`}, 'Lockdown Fixture') returning id`);
    actorUser = String(u!.id);
    userIds.push(actorUser);
    const actor = await makePerson("Actor", actorUser);
    const [r] = await q(sql`insert into app_roles (organization_id, key, name, role_kind) values (${org}, 'rdl_both', 'rdl_both', 'custom') returning id`);
    await q(sql`insert into app_role_permissions (role_id, permission_key) values (${r!.id}, 'roll.approve'), (${r!.id}, 'roll.propose')`);
    await q(sql`insert into role_grants (organization_id, role_id, person_id, starts_on) values (${org}, ${r!.id}, ${actor}, '2020-01-01')`);
  });

  afterAll(async () => {
    if (!platform) return;
    await platform.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    await platform.execute(sql`alter table roll_actions disable trigger roll_actions_freeze`);
    try {
      for (const id of orgIds) await platform.execute(sql`delete from organizations where id = ${id}`);
    } finally {
      await platform.execute(sql`alter table roll_actions enable trigger roll_actions_freeze`);
      await platform.execute(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    for (const id of personIds) await platform.execute(sql`delete from people where id = ${id}`);
    for (const id of userIds) await platform.execute(sql`delete from users where id = ${id}`);
  });

  // =========================================================================
  // Catalog half: 0063's text applied inside a rolled-back owner transaction
  // =========================================================================
  describe("0063 applied in a rolled-back transaction (either state)", () => {
    it("presby_app and presby_platform keep SELECT and INSERT and lose UPDATE and DELETE; FORCE RLS stays on", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql.raw(readFileSync(M63, "utf8")));
        const rows = rowsOf(await tx.execute(sql`
          select r.role,
                 has_table_privilege(r.role, 'roll_actions', 'SELECT') as s,
                 has_table_privilege(r.role, 'roll_actions', 'INSERT') as i,
                 has_table_privilege(r.role, 'roll_actions', 'UPDATE') as u,
                 has_table_privilege(r.role, 'roll_actions', 'DELETE') as d
            from (values ('presby_app'), ('presby_platform')) as r(role) order by r.role`));
        expect(rows).toEqual([
          { role: "presby_app", s: true, i: true, u: false, d: false },
          { role: "presby_platform", s: true, i: true, u: false, d: false },
        ]);
        const force = rowsOf(await tx.execute(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'roll_actions'`));
        expect(force[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      });
    });

    it("F191: the insert policy is RESTRICTIVE, FOR INSERT, TO presby_app, pending AND one of the seven approvable kinds", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql.raw(readFileSync(M63, "utf8")));
        const rows = rowsOf(await tx.execute(sql`
          select policyname, permissive, cmd, roles::text as roles, with_check
            from pg_policies where tablename = 'roll_actions' order by policyname`));
        expect(rows.map((r) => r.policyname)).toEqual(["roll_actions_insert_pending_only", "tenant_isolation"]);
        expect(rows[0]).toMatchObject({ permissive: "RESTRICTIVE", cmd: "INSERT", roles: "{presby_app}", with_check: EXPECTED_WITH_CHECK });
        const kinds = [...String(rows[0]!.with_check).matchAll(/'([a-z_]+)'::roll_action_kind/g)].map((m) => m[1]);
        expect(kinds).toEqual(APPROVABLE_KINDS);
      });
    });

    it("R5: roll_actions_terminal_decision_stamps refuses a denied or withdrawn row without both stamps; approved rows are exempt", async () => {
      const p = await makePerson("Stamps");
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql.raw(readFileSync(M63, "utf8")));
        const [c] = rowsOf(await tx.execute(sql`
          select convalidated from pg_constraint where conname = 'roll_actions_terminal_decision_stamps'`));
        expect(c!.convalidated).toBe(true);
        for (const [status, reasonCol] of [["denied", sql`denial_reason`], ["withdrawn", sql`withdrawal_reason`]] as const) {
          const err = await rejected(tx, sql`
            insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, ${reasonCol}, decided_at)
            values (${org}, ${p}, 'other_gain', '2025-01-05', 'active', ${status}, 'why', now())`);
          expect(err.code, status).toBe("23514");
          expect(err.text, status).toContain("roll_actions_terminal_decision_stamps");
        }
        await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${org}, ${p}, 'opening_balance', '2020-01-01', 'active', 'approved')`);
      });
    });

    it("the stop-block raises with a count on a denied row lacking its stamps, and passes once none exists", async () => {
      const p = await makePerson("Stopblock");
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql.raw(section(1))); // nothing violates: passes
        await tx.execute(sql`alter table roll_actions drop constraint if exists roll_actions_terminal_decision_stamps`);
        await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, denial_reason)
          values (${org}, ${p}, 'other_gain', '2025-01-05', 'active', 'denied', 'legacy deny')`);
        const err = await rejected(tx, sql.raw(section(1)));
        expect(err.code).toBe("23514");
        expect(err.text).toMatch(/0063: 1 denied or withdrawn roll_actions row\(s\) lack decided_by or decided_at/);
      });
    });

    it("the file is idempotent: applied twice in one transaction", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql.raw(readFileSync(M63, "utf8")));
        await tx.execute(sql.raw(readFileSync(M63, "utf8")));
      });
    });
  });

  // =========================================================================
  // Behavioural half: only once 0063 is really applied
  // =========================================================================
  describe("presby_app after 0063 is applied", () => {
    it("the live catalog: presby_app and presby_platform hold no UPDATE or DELETE on roll_actions; the live policy is the narrowed one", async (ctx) => {
      if (!locked) ctx.skip();
      const [priv] = await q(sql`
        select has_table_privilege('presby_app', 'roll_actions', 'UPDATE') as au,
               has_table_privilege('presby_app', 'roll_actions', 'DELETE') as ad,
               has_table_privilege('presby_platform', 'roll_actions', 'UPDATE') as pu,
               has_table_privilege('presby_platform', 'roll_actions', 'DELETE') as pd`);
      expect(priv).toEqual({ au: false, ad: false, pu: false, pd: false });
      const [pol] = await q(sql`
        select with_check from pg_policies where tablename = 'roll_actions' and policyname = 'roll_actions_insert_pending_only'`);
      expect(pol!.with_check).toBe(EXPECTED_WITH_CHECK);
    });

    it("cannot UPDATE or DELETE a roll row by plain SQL (approve, deny, delete): permission denied, 42501", async (ctx) => {
      if (!locked) ctx.skip();
      const p = await makePerson("Plain");
      const id = await ownerRoll(p, "profession_of_faith", "active", "pending");
      for (const query of [
        sql`update roll_actions set approval_status = 'approved', approved_on = current_date where id = ${id}`,
        sql`update roll_actions set approval_status = 'denied', denial_reason = 'no' where id = ${id}`,
        sql`update roll_actions set minute_reference = 'edit' where id = ${id}`,
        sql`delete from roll_actions where id = ${id}`,
      ]) {
        const err = await asAppRejected(query);
        expect(err.code).toBe("42501");
        expect(err.text).toMatch(/permission denied for table roll_actions/);
      }
      const [row] = await q(sql`select approval_status from roll_actions where id = ${id}`);
      expect(row!.approval_status).toBe("pending");
    });

    it("F191: a pending void, a loss kind, opening_balance and other_participant_enrolled are refused at insert; a pending gain is allowed", async (ctx) => {
      if (!locked) ctx.skip();
      const p = await makePerson("Kinds");
      const target = await ownerRoll(p, "other_participant_enrolled", "other_participant", "approved");
      const refused: Array<[string, SQL]> = [
        ["void", sql`insert into roll_actions (organization_id, person_id, kind, effective_date, approval_status, voids_action_id)
                     values (${org}, ${p}, 'void', '2025-02-01', 'pending', ${target})`],
        ["death", sql`insert into roll_actions (organization_id, person_id, kind, effective_date, approval_status)
                      values (${org}, ${p}, 'death', '2025-02-01', 'pending')`],
        ["opening_balance", sql`insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
                                values (${org}, ${p}, 'opening_balance', '2025-02-01', 'active', 'pending')`],
        ["other_participant_enrolled", sql`insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
                                           values (${org}, ${p}, 'other_participant_enrolled', '2025-02-01', 'other_participant', 'pending')`],
      ];
      for (const [label, query] of refused) {
        const err = await asAppRejected(query);
        expect(err.code, label).toBe("42501");
        expect(err.text, label).toMatch(/row-level security policy/);
      }
      const ok = await asAppRows(sql`
        insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
        values (${org}, ${p}, 'profession_of_faith', '2025-02-01', 'active', 'pending') returning id`, true);
      expect(ok).toHaveLength(1);
    });

    it("the decision definers still work for presby_app (the only path out of pending)", async (ctx) => {
      if (!locked) ctx.skip();
      const p = await makePerson("Definer");
      const id = await ownerRoll(p, "profession_of_faith", "active", "pending");
      const [r] = await asAppRows(sql`select * from presby_decide_roll_action(${id}::uuid, 'approve', null, null, ${actorUser}::uuid)`);
      expect(r!.outcome).toBe("ok");
      const p2 = await makePerson("Definer2");
      const id2 = await ownerRoll(p2, "profession_of_faith", "active", "pending");
      const [w] = await asAppRows(sql`select * from presby_withdraw_roll_action(${id2}::uuid, 'mistake', ${actorUser}::uuid)`);
      expect(w!.outcome).toBe("ok");
    });

    it("a person_milestones insert referencing a roll action still works as presby_app (RI checks run as the table owner)", async (ctx) => {
      if (!locked) ctx.skip();
      const p = await makePerson("Milestone");
      const id = await ownerRoll(p, "profession_of_faith", "active", "approved");
      const rows = await asAppRows(sql`
        insert into person_milestones (organization_id, person_id, milestone, occurred_on, roll_action_id)
        values (${org}, ${p}, 'profession_of_faith', '2025-01-05', ${id}) returning id`, true);
      expect(rows).toHaveLength(1);
    });
  });
});
