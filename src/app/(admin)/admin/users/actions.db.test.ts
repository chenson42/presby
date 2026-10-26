/**
 * T7 (F343, DECISION-291): assignRoleAction against a real database. The role
 * grant and the platform-role two-factor write are one transaction; a
 * non-admin session writes nothing; USER_ROLE_ASSIGNED is still recorded; a
 * self-grant refreshes the actor's own token.
 *
 * Run serially: npx dotenv -e .env.local -- vitest run --no-file-parallelism "src/app/(admin)/admin/users/actions.db.test.ts"
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), unstable_update: vi.fn(async () => undefined) }));
vi.mock("@/auth", () => ({ auth: mocks.auth, unstable_update: mocks.unstable_update }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe.skipIf(!hasDb)("assignRoleAction (Postgres-backed)", () => {
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  let actions: typeof import("./actions");
  let platform: ReturnType<typeof import("@/lib/db").getPlatformDb>;
  const q = async (query: SQL) => rowsOf(await platform.execute(query));

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const userIds: string[] = [];
  const role: Record<string, string> = {};
  let adminId = "";
  let nonAdminId = "";

  async function makeUser(label: string): Promise<string> {
    const [u] = await q(sql`insert into users (email, name) values (${`assign-${label}-${stamp}@example.invalid`}, ${`Assign ${label}`}) returning id`);
    userIds.push(String(u!.id));
    return String(u!.id);
  }
  const session = (id: string, roles: string[]) => ({
    user: { id, email: `assign-actor-${stamp}@example.invalid`, roles, features: [] as string[] },
  });
  const form = (userId: string, roleId: string) => {
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("roleId", roleId);
    return fd;
  };
  const column = async (id: string) => (await q(sql`select two_factor_required as v from users where id = ${id}`))[0]!.v as boolean;
  const changed = (id: string) =>
    q(sql`select actor_user_id, metadata from audit_events where resource_id = ${id} and action = 'user.2fa_required.changed'`);
  const assigned = (id: string) =>
    q(sql`select actor_user_id, metadata from audit_events where resource_id = ${id} and action = 'user.role.assigned'`);
  const holds = async (id: string, roleId: string) =>
    (await q(sql`select 1 from user_roles where user_id = ${id} and role_id = ${roleId}`)).length > 0;

  beforeAll(async () => {
    actions = await import("./actions");
    platform = (await import("@/lib/db")).getPlatformDb();
    for (const r of await q(sql`select id, name from roles where name in ('admin','support_operator','member')`)) {
      role[String(r.name)] = String(r.id);
    }
    adminId = await makeUser("actor-admin");
    nonAdminId = await makeUser("actor-member");
  }, 90_000);

  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.unstable_update.mockClear();
    mocks.auth.mockResolvedValue(session(adminId, ["admin"]));
  });

  afterAll(async () => {
    for (const id of userIds) {
      await q(sql`delete from audit_events where resource_id = ${id}`);
      await q(sql`delete from users where id = ${id}`);
    }
  }, 90_000);

  it("granting the admin role switches the person's own setting on, with one 2fa_required row naming the acting admin, and still records USER_ROLE_ASSIGNED", async () => {
    const target = await makeUser("to-admin");
    await actions.assignRoleAction(form(target, role.admin!));
    expect(await holds(target, role.admin!)).toBe(true);
    expect(await column(target)).toBe(true);
    const rows = await changed(target);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: adminId });
    expect(rows[0]!.metadata).toEqual({ required: true, cause: "platform_role_granted", roleName: "admin" });
    expect(await assigned(target)).toHaveLength(1);
  });

  it("support_operator (admin.dashboard): the same", async () => {
    const target = await makeUser("to-support");
    await actions.assignRoleAction(form(target, role.support_operator!));
    expect(await column(target)).toBe(true);
    const rows = await changed(target);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ roleName: "support_operator" });
  });

  it("the member role: the grant is made, the setting is untouched, nothing is audited as a 2FA change", async () => {
    const target = await makeUser("to-member");
    await actions.assignRoleAction(form(target, role.member!));
    expect(await holds(target, role.member!)).toBe(true);
    expect(await column(target)).toBe(false);
    expect(await changed(target)).toHaveLength(0);
    expect(await assigned(target)).toHaveLength(1);
  });

  it("pressing Add on a role already held writes no second 2fa row and does not undo a switch-off (P3-3)", async () => {
    const target = await makeUser("again");
    await actions.assignRoleAction(form(target, role.admin!));
    await q(sql`update users set two_factor_required = false where id = ${target}`);
    await actions.assignRoleAction(form(target, role.admin!));
    expect(await column(target)).toBe(false);
    expect(await changed(target)).toHaveLength(1);
  });

  it("an audit failure inside the action rolls back the grant and the column together (R2b, E7) - regression for the grant and column write sharing one transaction", async () => {
    // A ghost actor: audit_events.actor_user_id references users.id, so the
    // helper's audit insert fails AFTER the grant and the column write. If the
    // grant had committed on its own connection it would survive.
    const ghostId = "00000000-0000-4000-8000-00000000dead";
    const target = await makeUser("atomic");
    mocks.auth.mockResolvedValue(session(ghostId, ["admin"]));
    await expect(actions.assignRoleAction(form(target, role.admin!))).rejects.toThrow();
    expect(await holds(target, role.admin!)).toBe(false);
    expect(await column(target)).toBe(false);
    expect(await changed(target)).toHaveLength(0);
  });

  it("a non-admin session throws Forbidden and writes nothing", async () => {
    const target = await makeUser("forbidden");
    mocks.auth.mockResolvedValue(session(nonAdminId, ["member"]));
    await expect(actions.assignRoleAction(form(target, role.admin!))).rejects.toThrow("Forbidden");
    expect(await holds(target, role.admin!)).toBe(false);
    expect(await column(target)).toBe(false);
    expect(await changed(target)).toHaveLength(0);
    expect(await assigned(target)).toHaveLength(0);
  });

  it("a self-grant refreshes the actor's own token; a grant to someone else does not", async () => {
    const other = await makeUser("not-self");
    await actions.assignRoleAction(form(other, role.admin!));
    expect(mocks.unstable_update).not.toHaveBeenCalled();
    const self = await makeUser("self");
    mocks.auth.mockResolvedValue(session(self, ["admin"]));
    await actions.assignRoleAction(form(self, role.admin!));
    expect(mocks.unstable_update).toHaveBeenCalledTimes(1);
  });
});
