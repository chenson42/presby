/**
 * "Required, but not enrolled" against the real database on the platform
 * connection: the one predicate (`STRANDED_WHERE`) behind both the `/admin/2fa`
 * list and the dashboard's Two-factor card. Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/admin/two-factor-stranded.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe.skipIf(!hasDb)("two-factor stranded (Postgres-backed, platform connection)", () => {
  let fx: CalendarFixture;
  let mod: typeof import("./two-factor-stranded");
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  const q = async (query: SQL) => rowsOf(await fx.platform.execute(query));

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = (name: string) => `stranded-${name}-${stamp}@example.invalid`;
  const userIds: string[] = [];
  const ids: Record<string, string> = {};

  async function user(key: string, opts: { active?: boolean; required?: boolean; enrolled?: boolean; orgId?: string; ended?: boolean } = {}) {
    const [u] = await q(sql`
      insert into users (email, name, is_active, two_factor_required)
      values (${email(key)}, ${`Stranded ${key}`}, ${opts.active ?? true}, ${opts.required ?? false}) returning id`);
    const id = String(u!.id);
    ids[key] = id;
    userIds.push(id);
    if (opts.enrolled) {
      await q(sql`insert into user_totp (user_id, secret_ciphertext) values (${id}, 'fixture-ciphertext')`);
    }
    if (opts.orgId) {
      const personId = await fx.makePerson("Stranded", key);
      await q(sql`update people set user_id = ${id} where id = ${personId}`);
      await fx.addMember(opts.orgId, personId);
      if (opts.ended) {
        await q(sql`update memberships set ended_on = current_date where person_id = ${personId}`);
      }
    }
  }

  beforeAll(async () => {
    const mod0 = await import("@/lib/testing/calendar-fixture");
    fx = await mod0.createCalendarFixture("two-factor-stranded");
    mod = await import("./two-factor-stranded");
    // A settings row exists only when a time zone is given (the fixture's option).
    const requiring = await fx.makeOrg("requires", { timeZone: "America/New_York" });
    const optional = await fx.makeOrg("optional", { timeZone: "America/New_York" });
    await q(sql`update organization_settings set require_two_factor = true where organization_id = ${requiring}`);

    await user("by-congregation", { orgId: requiring });
    await user("by-own-flag", { required: true });
    await user("enrolled", { required: true, enrolled: true });
    await user("inactive", { required: true, active: false });
    await user("optional-org", { orgId: optional });
    await user("ended-membership", { orgId: requiring, ended: true });
    await user("not-required");
  }, 120_000);

  afterAll(async () => {
    if (!fx) return;
    for (const id of userIds) await q(sql`delete from users where id = ${id}`);
    await fx.cleanup();
  }, 90_000);

  const mine = <T extends { email: string }>(rows: T[]) => rows.filter((r) => r.email.endsWith(`-${stamp}@example.invalid`));

  it("lists exactly the active, un-enrolled accounts required by their own flag or an active membership's policy, and says why", async () => {
    const { rows } = await mod.listStranded(1000);
    const found = Object.fromEntries(mine(rows).map((r) => [r.email, r.source]));
    expect(found).toEqual({
      [email("by-congregation")]: "congregation",
      [email("by-own-flag")]: "this user",
    });
  });

  it("the card's count and the page's total are the same number (one predicate)", async () => {
    const [count, listed] = await Promise.all([mod.countStranded(), mod.listStranded(1)]);
    expect(count).toBe(listed.total);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("listStranded: the total is the true total when the limit truncates, and the rows are bounded", async () => {
    const all = await mod.listStranded(1000);
    const one = await mod.listStranded(1);
    expect(one.rows).toHaveLength(1);
    expect(one.total).toBe(all.total);
    // A non-positive or non-finite limit is clamped to at least one row.
    expect((await mod.listStranded(0)).rows).toHaveLength(1);
  });

  it("returns accounts or a count, never a member count", async () => {
    const { rows } = await mod.listStranded(5);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["email", "id", "name", "source"]);
    expect(typeof (await mod.countStranded())).toBe("number");
  });
});
