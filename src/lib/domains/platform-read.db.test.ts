/**
 * The platform admin's read side of domains (Batch 1d), against the real
 * database on the platform connection: one organization's checklist data and the
 * cross-organization list with its filters. Rows are arranged through legal edges
 * on the owner connection (the update guard binds the owner too).
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/domains/platform-read.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe.skipIf(!hasDb)("platform-read (Postgres-backed, platform connection)", () => {
  let fx: CalendarFixture;
  let read: typeof import("./platform-read");
  type Row = Record<string, unknown>;
  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  const q = async (query: SQL) => rowsOf(await fx.platform.execute(query));

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = (name: string) => `${name}-${stamp}.invalid`;
  let org: string;
  let slug: string;
  let otherOrg: string;
  const ids: Record<string, string> = {};

  async function add(key: string, orgId: string, hostname: string, role: "canonical" | "alias", path: string[], extra?: SQL) {
    const [r] = await q(sql`
      insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id, next_check_at)
      values (${orgId}, 'web', ${hostname}, ${hostname}, ${role}, ${"s".repeat(32)}, 'platform', ${fx.actingUserId}, now() + interval '5 hours') returning id`);
    const id = String(r!.id);
    ids[key] = id;
    for (const to of path) {
      if (to === "release_pending") {
        await q(sql`update organization_domains set state = 'release_pending', release_cause = 'force_released', force_release_reason = 'Arranged by the test.' where id = ${id}`);
      } else if (to === "released") {
        await q(sql`update organization_domains set state = 'released' where id = ${id}`);
      } else {
        await q(sql`update organization_domains set state = ${to} where id = ${id}`);
      }
    }
    if (extra) await q(sql`update organization_domains set ${extra} where id = ${id}`);
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("domains-platform-read");
    read = await import("./platform-read");
    org = await fx.makeOrg("read");
    otherOrg = await fx.makeOrg("other");
    const [o] = await q(sql`select slug from organizations where id = ${org}`);
    slug = String(o!.slug);
    await q(sql`insert into organization_sites (organization_id, repo, status) values (${org}, ${`presby-fixtures/site-${slug}`}, 'live')`);
    await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled) values (${org}, 'org_portal.domains', true)`);

    const live = ["verified", "attach_pending", "attached", "live"];
    // Released first: the cap counts non-terminal web hosts, and a terminal row stops counting.
    await add("released", org, host("released"), "alias", [...live, "release_pending", "released"]);
    await add("live", org, host("live"), "canonical", live);
    await add("pending", org, host("pending"), "alias", []);
    await add("held", org, host("held"), "alias", live, sql`platform_hold = 'paused', hold_reason = 'Arranged by the test.'`);
    await add("lapsed", otherOrg, host("lapsed"), "canonical", [...live, "lapsed"]);
    await add("releasing", otherOrg, host("releasing"), "alias", [...live, "release_pending"]);
    await add("attachedOld", otherOrg, host("attachedold"), "alias", ["verified", "attach_pending", "attached"]);
  }, 120_000);

  afterAll(async () => {
    if (!fx) return;
    await q(sql`delete from organization_sites where organization_id = ${org}`);
    await fx.cleanup();
  }, 90_000);

  const mine = (rows: Array<{ hostname: string }>) => rows.filter((r) => r.hostname.endsWith(`-${stamp}.invalid`));

  it("readOrgDomainsForPlatform: the checklist the church sees, the site status, both toggles (a missing row is OFF), state ages, and released history", async () => {
    const data = await read.readOrgDomainsForPlatform(org, slug);
    expect(data.siteStatus).toBe("live");
    expect(data.toggles).toEqual({ "org_portal.domains": true, "org_portal.mail_domain": false });
    expect(data.groups.map((g) => g.claimName).sort()).toEqual([host("held"), host("live"), host("pending")].sort());
    const held = data.groups.find((g) => g.claimName === host("held"))!;
    expect(held.hosts[0]!.hold).toBe("paused");
    expect(held.banners.map((b) => b.code)).toContain("paused");
    // ages are whole, non-negative days and cover every non-terminal host, not the released one
    expect(Object.keys(data.daysInState).sort()).toEqual(data.groups.flatMap((g) => g.hosts.map((h) => h.id)).sort());
    expect(Object.values(data.daysInState).every((d) => Number.isInteger(d) && d >= 0)).toBe(true);
    expect(data.history.map((h) => h.hostname)).toEqual([host("released")]);
    expect(data.history[0]).toMatchObject({ state: "released", releaseCause: "force_released" });
  });

  it("reads nothing of another organization", async () => {
    const data = await read.readOrgDomainsForPlatform(org, slug);
    expect(JSON.stringify(data)).not.toContain(host("lapsed"));
    const none = await read.readOrgDomainsForPlatform("00000000-0000-4000-8000-000000000000", "x");
    expect(none.groups).toEqual([]);
    expect(none.siteStatus).toBeNull();
    expect(none.toggles).toEqual({ "org_portal.domains": false, "org_portal.mail_domain": false });
  });

  it("the proof token is not in any list row", async () => {
    const { rows } = await read.listDomainsAcrossOrgs("all", 500);
    expect(JSON.stringify(rows)).not.toContain("s".repeat(32));
    expect(Object.keys(rows[0]!).sort()).not.toContain("proofToken");
  });

  const names = async (f: Parameters<typeof read.listDomainsAcrossOrgs>[0]) =>
    mine((await read.listDomainsAcrossOrgs(f, 500)).rows).map((r) => r.hostname).sort();

  it("all: every non-terminal host across organizations, with the organization's name and no released row", async () => {
    const all = await names("all");
    expect(all).toEqual([host("attachedold"), host("held"), host("lapsed"), host("live"), host("pending"), host("releasing")].sort());
    const { rows } = await read.listDomainsAcrossOrgs("all", 500);
    const lapsed = rows.find((r) => r.hostname === host("lapsed"))!;
    expect(lapsed.organizationId).toBe(otherOrg);
    expect(lapsed.organizationName.length).toBeGreaterThan(0);
  });

  it.each([
    ["live", () => [host("held"), host("live")]], // a paused host is still in state live
    ["held", () => [host("held")]],
    ["lapsed", () => [host("lapsed")]],
    ["releasing", () => [host("releasing")]],
    ["pending", () => [host("attachedold"), host("pending")]],
    ["attention", () => [host("held"), host("lapsed"), host("releasing")]],
  ] as const)("filter %s", async (filter, expected) => {
    expect(await names(filter)).toEqual([...expected()].sort());
  });

  it("countDomainsNeedingAttention: the dashboard card's number equals the attention list it links to (one predicate)", async () => {
    const [count, list] = await Promise.all([
      read.countDomainsNeedingAttention(),
      read.listDomainsAcrossOrgs("attention", 100_000),
    ]);
    expect(list.truncated).toBe(false);
    expect(count).toBe(list.rows.length);
    // And it includes this suite's three attention hosts.
    expect(mine(list.rows).map((r) => r.hostname).sort()).toEqual([host("held"), host("lapsed"), host("releasing")].sort());
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("days attached without ever being live: counted for an attached host, null for a live one", async () => {
    const { rows } = await read.listDomainsAcrossOrgs("all", 500);
    // attached_at is trigger-owned (not backdatable), so the age is "today": a whole number of days, zero.
    expect(rows.find((r) => r.hostname === host("attachedold"))!.daysAttachedNotLive).toBe(0);
    expect(rows.find((r) => r.hostname === host("live"))!.daysAttachedNotLive).toBeNull();
  });

  it("is capped, and says so", async () => {
    const capped = await read.listDomainsAcrossOrgs("all", 1);
    expect(capped.rows).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });

  it("parsePlatformListFilter accepts the known filters and falls back to all", () => {
    expect(read.parsePlatformListFilter("attention")).toBe("attention");
    expect(read.parsePlatformListFilter("drop table")).toBe("all");
    expect(read.parsePlatformListFilter(undefined)).toBe("all");
  });
});
