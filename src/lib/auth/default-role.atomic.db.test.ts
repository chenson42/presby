/**
 * T8b (F343, DECISION-291, R2b/E7): the default-role grant and the person's own
 * two-factor write are ONE transaction. The helper is wrapped so it runs for
 * real (the column is written and audited) and THEN throws; if the grant had
 * been committed on its own connection it would survive the failure.
 *
 * Its own file because a file-level vi.mock of the helper would leak into the
 * other cases in default-role.db.test.ts.
 *
 * Run serially: npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/auth/default-role.atomic.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("./platform-role-two-factor", async (orig) => {
  const real = await orig<typeof import("./platform-role-two-factor")>();
  return {
    ...real,
    requireTwoFactorForPlatformRole: vi.fn(
      async (...args: Parameters<typeof real.requireTwoFactorForPlatformRole>) => {
        await real.requireTwoFactorForPlatformRole(...args);
        throw new Error("boom");
      },
    ),
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe.skipIf(!hasDb)("ensureDefaultRole atomicity (Postgres-backed)", () => {
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  let ensureDefaultRole: typeof import("./default-role").ensureDefaultRole;
  let platform: ReturnType<typeof import("@/lib/db").getPlatformDb>;
  const q = async (query: SQL) => rowsOf(await platform.execute(query));

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `defrole-atomic-${stamp}@example.invalid`;
  let userId = "";

  beforeAll(async () => {
    ({ ensureDefaultRole } = await import("./default-role"));
    platform = (await import("@/lib/db")).getPlatformDb();
    const [u] = await q(sql`insert into users (email, name) values (${email}, 'Default Role Atomic') returning id`);
    userId = String(u!.id);
  }, 90_000);

  afterAll(async () => {
    if (!userId) return;
    await q(sql`delete from audit_events where resource_id = ${userId}`);
    await q(sql`delete from users where id = ${userId}`);
  }, 90_000);

  it("a failure after the helper rolls back the default role and the column together", async () => {
    await expect(ensureDefaultRole(userId, email, [email])).rejects.toThrow("boom");
    expect(await q(sql`select 1 from user_roles where user_id = ${userId}`)).toHaveLength(0);
    expect((await q(sql`select two_factor_required as v from users where id = ${userId}`))[0]!.v).toBe(false);
    expect(
      await q(sql`select 1 from audit_events where resource_id = ${userId} and action = 'user.2fa_required.changed'`),
    ).toHaveLength(0);
  });
});
