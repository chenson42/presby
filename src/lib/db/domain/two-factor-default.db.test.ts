/**
 * T1 (F343, DECISION-291; docs/work-log/2026-10-26-2fa-default.md, Phase 3
 * "Test plan"): migration 0080 against a REAL database.
 *
 *   - `users.two_factor_required` defaults to false (check-schema-parity.ts does
 *     not compare defaults, so this is the pin, R1(g));
 *   - an insert that omits the column stores false, and with no membership the
 *     definer agrees the account is not required;
 *   - the NextAuth adapter's `createUser` (the Google first sign-in path,
 *     src/auth.ts) stores false, through the same `db` connection src/auth.ts
 *     hands the adapter;
 *   - exactly six permissions carry `requires_two_factor`: the three giving keys
 *     (0055) and roles.manage, role_grants.manage, domains.manage (0080).
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/two-factor-default.db.test.ts
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("two-factor default (0080, Postgres-backed)", () => {
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  const platform = async () => (await import("@/lib/db")).getPlatformDb();
  const q = async (query: SQL) => rowsOf(await (await platform()).execute(query));

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = (name: string) => `tfa-default-${name}-${stamp}@example.invalid`;
  const userIds: string[] = [];

  afterAll(async () => {
    if (userIds.length === 0) return;
    // Nothing here writes an audit row or a person; the user rows are the only residue.
    for (const id of userIds) await q(sql`delete from users where id = ${id}`);
  });

  it("users.two_factor_required column_default is false", async () => {
    const [c] = await q(sql`
      select column_default, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'users' and column_name = 'two_factor_required'`);
    expect(c).toEqual({ column_default: "false", is_nullable: "NO" });
  });

  it("an insert that omits the column stores false, and presby_two_factor_required is false for it", async () => {
    const [u] = await q(sql`insert into users (email, name) values (${email("omit")}, 'Omits Column') returning id, two_factor_required`);
    userIds.push(String(u!.id));
    expect(u!.two_factor_required).toBe(false);
    const [r] = await q(sql`select presby_two_factor_required(${String(u!.id)}::uuid) as required`);
    expect(r!.required).toBe(false);
  });

  it("the NextAuth adapter's createUser stores false", async () => {
    const { DrizzleAdapter } = await import("@auth/drizzle-adapter");
    const { db } = await import("@/lib/db");
    const { users, accounts, sessions, verificationTokens } = await import("@/lib/db/schema");
    // The same adapter construction as src/auth.ts, on the same (presby_app) connection.
    const adapter = DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    });
    const created = await adapter.createUser!({
      id: crypto.randomUUID(),
      email: email("adapter"),
      // null, as Auth.js's OAuth path passes it: since 0065 (users_guard_email_proof,
      // DECISION-225) a non-owner role may not stamp email_verified, so a dated value
      // here is refused by the trigger, not by anything this test is about.
      emailVerified: null,
      name: "Adapter Created",
    });
    userIds.push(created.id);
    const [u] = await q(sql`select two_factor_required from users where id = ${created.id}`);
    expect(u!.two_factor_required).toBe(false);
  });

  it("exactly six permissions are flagged: giving.view/record/manage (module giving, tier 2) and roles.manage, role_grants.manage, domains.manage", async () => {
    const rows = await q(sql`
      select key, module, sensitivity_tier from permissions where requires_two_factor order by key`);
    expect(rows).toEqual([
      { key: "domains.manage", module: "domains", sensitivity_tier: 1 },
      { key: "giving.manage", module: "giving", sensitivity_tier: 2 },
      { key: "giving.record", module: "giving", sensitivity_tier: 2 },
      { key: "giving.view", module: "giving", sensitivity_tier: 2 },
      { key: "role_grants.manage", module: "authz", sensitivity_tier: 1 },
      { key: "roles.manage", module: "authz", sensitivity_tier: 1 },
    ]);
  });
});
