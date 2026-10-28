/**
 * T8 (F343, DECISION-291): ensureDefaultRole against a real database. The
 * INITIAL_ADMIN_EMAILS first sign-in gets the admin role AND the person's own
 * two-factor setting, in one transaction, audited with a null actor (a system
 * write: the jwt callback is mid-flight, so nothing may call auth()).
 *
 * Run serially: npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/auth/default-role.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";

vi.mock("server-only", () => ({}));
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe("default-role.ts source", () => {
  it("never reaches auth(): no @/auth import, no auth( call, no recordAudit (R2d, E5)", () => {
    const code = fs
      .readFileSync(path.join(__dirname, "default-role.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/@\/auth["']/);
    expect(code).not.toMatch(/\bauth\s*\(/);
    expect(code).not.toMatch(/\brecordAudit\b/);
  });
});

describe.skipIf(!hasDb)("ensureDefaultRole (Postgres-backed)", () => {
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  let ensureDefaultRole: typeof import("./default-role").ensureDefaultRole;
  let platform: ReturnType<typeof import("@/lib/db").getPlatformDb>;
  const q = async (query: SQL) => rowsOf(await platform.execute(query));

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const userIds: string[] = [];
  const emailOf = (label: string) => `defrole-${label}-${stamp}@example.invalid`;

  async function makeUser(label: string, required = false): Promise<string> {
    const [u] = await q(sql`insert into users (email, name, two_factor_required)
      values (${emailOf(label)}, ${`Default Role ${label}`}, ${required}) returning id`);
    userIds.push(String(u!.id));
    return String(u!.id);
  }
  const roleNames = async (id: string) =>
    (await q(sql`select r.name from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${id} order by r.name`)).map((r) => String(r.name));
  const column = async (id: string) => (await q(sql`select two_factor_required as v from users where id = ${id}`))[0]!.v as boolean;
  const changed = (id: string) =>
    q(sql`select actor_user_id, actor_email, metadata from audit_events where resource_id = ${id} and action = 'user.2fa_required.changed'`);

  beforeAll(async () => {
    ({ ensureDefaultRole } = await import("./default-role"));
    platform = (await import("@/lib/db")).getPlatformDb();
  }, 90_000);

  afterAll(async () => {
    for (const id of userIds) {
      await q(sql`delete from audit_events where resource_id = ${id}`);
      await q(sql`delete from users where id = ${id}`);
    }
  }, 90_000);

  it("an INITIAL_ADMIN_EMAILS address: admin role, own setting on, ONE audit row with a null actor (the comparison ignores case)", async () => {
    const id = await makeUser("first-admin");
    await ensureDefaultRole(id, emailOf("first-admin").toUpperCase(), [emailOf("first-admin")]);
    expect(await roleNames(id)).toEqual(["admin"]);
    expect(await column(id)).toBe(true);
    const rows = await changed(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: null, actor_email: null });
    expect(rows[0]!.metadata).toEqual({ required: true, cause: "platform_role_granted", roleName: "admin" });
    expect(authMock).not.toHaveBeenCalled();
  });

  it("any other address: the member role, own setting stays off, no audit row", async () => {
    const id = await makeUser("ordinary");
    await ensureDefaultRole(id, emailOf("ordinary"), [emailOf("someone-else")]);
    expect(await roleNames(id)).toEqual(["member"]);
    expect(await column(id)).toBe(false);
    expect(await changed(id)).toHaveLength(0);
  });

  it("no email at all: the member role and nothing else", async () => {
    const id = await makeUser("no-email");
    await ensureDefaultRole(id, null, [emailOf("no-email")]);
    expect(await roleNames(id)).toEqual(["member"]);
    expect(await column(id)).toBe(false);
  });

  it("a user who already holds a role is left alone, including a first admin whose own setting was switched off (E12)", async () => {
    const id = await makeUser("switched-off");
    await ensureDefaultRole(id, emailOf("switched-off"), [emailOf("switched-off")]);
    await q(sql`update users set two_factor_required = false where id = ${id}`);
    await ensureDefaultRole(id, emailOf("switched-off"), [emailOf("switched-off")]);
    expect(await column(id)).toBe(false);
    expect(await roleNames(id)).toEqual(["admin"]);
    expect(await changed(id)).toHaveLength(1);
  });

  it("running it twice for the same new user writes one grant and one audit row", async () => {
    const id = await makeUser("twice");
    await Promise.all([
      ensureDefaultRole(id, emailOf("twice"), [emailOf("twice")]),
      ensureDefaultRole(id, emailOf("twice"), [emailOf("twice")]),
    ]);
    expect(await roleNames(id)).toEqual(["admin"]);
    expect(await changed(id)).toHaveLength(1);
  });
});
