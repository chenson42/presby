/**
 * T6 (F343, DECISION-291): requireTwoFactorForPlatformRole against a real
 * database, on the tenant-class connection (`db`, presby_app) exactly as both
 * callers use it. Proves the column write and the audit row, the "only on a
 * changed row" gate, that the grant and the column commit or roll back as one,
 * and that two administrators pressing Add at once write one audit row.
 *
 * Run serially: npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/auth/platform-role-two-factor.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";

vi.mock("server-only", () => ({}));
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe.skipIf(!hasDb)("requireTwoFactorForPlatformRole (Postgres-backed)", () => {
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  let helper: typeof import("./platform-role-two-factor");
  let appDb: typeof import("@/lib/db").db;
  let userRoles: typeof import("@/lib/db/schema").userRoles;
  let platform: ReturnType<typeof import("@/lib/db").getPlatformDb>;
  const q = async (query: SQL) => rowsOf(await platform.execute(query));

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const userIds: string[] = [];
  const role: Record<string, string> = {};

  async function makeUser(label: string, required = false): Promise<string> {
    const [u] = await q(sql`insert into users (email, name, two_factor_required)
      values (${`tfpr-${label}-${stamp}@example.invalid`}, ${`Platform Role ${label}`}, ${required}) returning id`);
    const id = String(u!.id);
    userIds.push(id);
    return id;
  }
  const column = async (id: string) => (await q(sql`select two_factor_required as v from users where id = ${id}`))[0]!.v as boolean;
  const audits = (id: string) =>
    q(sql`select action, actor_user_id, actor_email, resource_type, metadata from audit_events
           where resource_id = ${id} and action = 'user.2fa_required.changed' order by created_at`);
  const holds = async (id: string, roleId: string) =>
    (await q(sql`select 1 from user_roles where user_id = ${id} and role_id = ${roleId}`)).length > 0;

  /** The caller shape: grant row (returning), then the helper, one transaction. */
  async function grant(userId: string, roleName: string, actor: { userId: string; email: string | null } | null) {
    return appDb.transaction(async (tx) => {
      const inserted = await tx.insert(userRoles).values({ userId, roleId: role[roleName]! }).onConflictDoNothing()
        .returning({ roleId: userRoles.roleId });
      if (inserted.length === 0) return null;
      return helper.requireTwoFactorForPlatformRole(tx, { userId, roleId: role[roleName]!, actor });
    });
  }

  beforeAll(async () => {
    helper = await import("./platform-role-two-factor");
    ({ db: appDb } = await import("@/lib/db"));
    ({ userRoles } = await import("@/lib/db/schema"));
    platform = (await import("@/lib/db")).getPlatformDb();
    for (const r of await q(sql`select id, name from roles where name in ('admin','support_operator','member')`)) {
      role[String(r.name)] = String(r.id);
    }
    expect(Object.keys(role).sort()).toEqual(["admin", "member", "support_operator"]);
  }, 90_000);

  afterAll(async () => {
    for (const id of userIds) {
      await q(sql`delete from audit_events where resource_id = ${id}`);
      await q(sql`delete from users where id = ${id}`);
    }
  }, 90_000);

  it("the admin role: column goes true and ONE user.2fa_required.changed row is written with cause and roleName", async () => {
    const id = await makeUser("admin");
    const actor = { userId: await makeUser("actor-a"), email: "actor-a@example.invalid" };
    expect(await grant(id, "admin", actor)).toEqual({ changed: true, roleName: "admin" });
    expect(await column(id)).toBe(true);
    const rows = await audits(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: actor.userId, actor_email: actor.email, resource_type: "user" });
    expect(rows[0]!.metadata).toEqual({ required: true, cause: "platform_role_granted", roleName: "admin" });
    expect(authMock).not.toHaveBeenCalled();
  });

  it("support_operator (a role bound to admin.dashboard): the same", async () => {
    const id = await makeUser("support");
    expect(await grant(id, "support_operator", null)).toEqual({ changed: true, roleName: "support_operator" });
    expect(await column(id)).toBe(true);
    const rows = await audits(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: null, actor_email: null });
    expect(rows[0]!.metadata).toMatchObject({ roleName: "support_operator" });
  });

  it("the member role: nothing is written, nothing is audited", async () => {
    const id = await makeUser("member");
    expect(await grant(id, "member", null)).toEqual({ changed: false, roleName: null });
    expect(await column(id)).toBe(false);
    expect(await audits(id)).toHaveLength(0);
  });

  it("column already true: no second audit row (E8)", async () => {
    const id = await makeUser("already", true);
    expect(await grant(id, "admin", null)).toEqual({ changed: false, roleName: "admin" });
    expect(await audits(id)).toHaveLength(0);
  });

  it("a failure after the helper rolls back the grant AND the column (E7)", async () => {
    const id = await makeUser("rollback");
    await expect(
      appDb.transaction(async (tx) => {
        await tx.insert(userRoles).values({ userId: id, roleId: role.admin! });
        await helper.requireTwoFactorForPlatformRole(tx, { userId: id, roleId: role.admin!, actor: null });
        throw new Error("boom after the helper");
      }),
    ).rejects.toThrow("boom after the helper");
    expect(await column(id)).toBe(false);
    expect(await holds(id, role.admin!)).toBe(false);
    expect(await audits(id)).toHaveLength(0);
  });

  it("a rejected audit insert rolls back both the grant and the column (E7)", async () => {
    const id = await makeUser("audit-fails");
    // actor_user_id is a foreign key to users: an actor that does not exist makes the audit insert fail.
    const ghost = { userId: "00000000-0000-4000-8000-00000000dead", email: null };
    await expect(grant(id, "admin", ghost)).rejects.toThrow();
    expect(await column(id)).toBe(false);
    expect(await holds(id, role.admin!)).toBe(false);
  });

  it("adding a role the person already holds does not undo a deliberate switch-off (P3-3, E9)", async () => {
    const id = await makeUser("switched-off");
    await grant(id, "admin", null);
    await q(sql`update users set two_factor_required = false where id = ${id}`);
    expect(await grant(id, "admin", null)).toBeNull(); // conflict: no new grant row, helper never called
    expect(await column(id)).toBe(false);
    expect(await audits(id)).toHaveLength(1);
  });

  it("a DIFFERENT platform role granted later switches it on again, audited with its own roleName (P3-3)", async () => {
    const id = await makeUser("second-role");
    await grant(id, "admin", null);
    await q(sql`update users set two_factor_required = false where id = ${id}`);
    expect(await grant(id, "support_operator", null)).toEqual({ changed: true, roleName: "support_operator" });
    expect(await column(id)).toBe(true);
    const rows = await audits(id);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.metadata).toMatchObject({ roleName: "support_operator" });
  });

  it("removing the role leaves the column true (R2e, E11)", async () => {
    const id = await makeUser("removed");
    await grant(id, "admin", null);
    await q(sql`delete from user_roles where user_id = ${id}`);
    expect(await column(id)).toBe(true);
  });

  it("two concurrent grants of the same role write ONE audit row (E10)", async () => {
    const id = await makeUser("concurrent");
    const [a, b] = await Promise.all([grant(id, "admin", null), grant(id, "admin", null)]);
    expect([a, b].filter((r) => r?.changed === true)).toHaveLength(1);
    expect(await column(id)).toBe(true);
    expect(await audits(id)).toHaveLength(1);
  });
});
