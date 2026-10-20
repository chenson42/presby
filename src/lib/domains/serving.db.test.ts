/**
 * The Track F serving contract end to end, against the real database through the
 * `presby_app` connection (the anonymous public path), with the real
 * `resolveSiteOrganization()` / `resolveSite()` / `resolveGiveSite()` and the real
 * `donorOrigin()`. Only `next/headers` is faked, to supply the request `Host`.
 *
 * Unit tests prove the resolver's logic against stubbed rows; the SQL predicate has its own
 * matrix (src/lib/db/domain/domains.db.test.ts). THIS file proves the two meet: a host that
 * the database serves resolves through the app, every state the database darkens is the same
 * `not_found` through the app, and the donor's return origin follows the same predicate.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/domains/serving.db.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe.skipIf(!hasDb)("Track F serving contract (Postgres-backed, presby_app)", () => {
  let fx: CalendarFixture;
  let sites: typeof import("@/lib/sites");
  let donor: typeof import("@/lib/giving/donor-origin");
  let originalFlag: boolean;

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const CANONICAL = `www.serving-${stamp}.invalid`;
  const ALIAS = `serving-${stamp}.invalid`;
  const OTHER = `unclaimed-${stamp}.invalid`;
  const PLATFORM = "localhost:3000";
  let org: string;
  let slug: string;
  let canonicalId: string;
  let aliasId: string;

  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  const q = async (query: SQL) => rowsOf(await fx.platform.execute(query));
  const hostIs = (host: string, extra: Record<string, string> = {}) =>
    mockHeaders.mockResolvedValue(new Headers({ host, ...extra }));

  async function insertDomain(host: string, role: "canonical" | "alias"): Promise<string> {
    const [r] = await q(sql`
      insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
      values (${org}, 'web', ${host}, ${ALIAS}, ${role}, ${"s".repeat(32)}, 'platform', ${fx.actingUserId}) returning id`);
    return String(r!.id);
  }
  async function walkToLive(id: string) {
    for (const to of ["verified", "attach_pending", "attached", "live"]) {
      await q(sql`update organization_domains set state = ${to} where id = ${id}`);
    }
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("domains-serving");
    sites = await import("@/lib/sites");
    donor = await import("@/lib/giving/donor-origin");

    const [flag] = await q(sql`select enabled from feature_flags where key = 'sites.public_render'`);
    originalFlag = Boolean(flag!.enabled);
    await q(sql`update feature_flags set enabled = true where key = 'sites.public_render'`);

    org = await fx.makeOrg("serving");
    const [o] = await q(sql`select slug from organizations where id = ${org}`);
    slug = String(o!.slug);
    const bundle = Buffer.from(
      JSON.stringify({ schemaVersion: 1, pages: [{ path: "/", frontMatter: { title: "Serving Fixture" }, mdxAst: null }], imageKeys: {} }),
    );
    const [blob] = await q(sql`
      insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
      values (${org}, ${createHash("sha256").update(bundle).digest("hex")}, 'application/json', ${bundle.byteLength}, decode(${bundle.toString("hex")}, 'hex'))
      returning id`);
    await q(sql`insert into organization_sites (organization_id, repo, status, content_bundle_key)
                values (${org}, ${`presby-fixtures/site-${slug}`}, 'live', ${String(blob!.id)})`);
    await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled) values (${org}, 'org_portal.domains', true)`);
    canonicalId = await insertDomain(CANONICAL, "canonical");
    aliasId = await insertDomain(ALIAS, "alias");
    await walkToLive(canonicalId);
    await walkToLive(aliasId);
  }, 90_000);

  afterAll(async () => {
    if (!fx) return;
    await q(sql`update feature_flags set enabled = ${originalFlag} where key = 'sites.public_render'`);
    await q(sql`update organization_sites set content_bundle_key = null where organization_id = ${org}`);
    await q(sql`delete from organization_sites where organization_id = ${org}`);
    await q(sql`delete from blob_assets where organization_id = ${org}`);
    await fx.cleanup();
  }, 90_000);

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", "app.example.invalid");
    hostIs(CANONICAL);
  });

  /** Apply `flip`, run `fn`, and put it back (owner connection; each flip is its own committed write). */
  async function withFlip<T>(flip: SQL, restore: SQL | SQL[], fn: () => Promise<T>): Promise<T> {
    await q(flip);
    try {
      return await fn();
    } finally {
      for (const r of Array.isArray(restore) ? restore : [restore]) await q(r);
    }
  }

  it("POSITIVE CONTROL: the canonical host resolves, with the DB's slug and a clean-path url builder", async () => {
    hostIs(CANONICAL);
    const r = await sites.resolveSiteOrganization(CANONICAL);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r).toMatchObject({ mode: "host", slug, organizationId: org, redirectHost: null });
    expect(r.urls.page("/about")).toBe("/about");
    expect(r.urls.canonical("/about")).toBe(`https://${CANONICAL}/about`);
    expect(r.urls.portal()).toBe(`https://app.example.invalid/o/${slug}`);
  });

  it("the full resolution hydrates the staged bundle", async () => {
    hostIs(CANONICAL);
    const r = await sites.resolveSite(CANONICAL);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.site.pages.map((p) => p.path)).toEqual(["/"]);
  });

  it("the alias resolves too, and redirects to the canonical host", async () => {
    hostIs(ALIAS);
    const r = await sites.resolveSiteOrganization(ALIAS);
    expect(r).toMatchObject({ kind: "ok", mode: "host", slug, redirectHost: CANONICAL });
  });

  it("the slug URL on a platform host names the serving host to hand off to", async () => {
    hostIs(PLATFORM);
    expect(await sites.resolveSiteOrganization(slug)).toMatchObject({ kind: "ok", mode: "slug", slug, redirectHost: CANONICAL });
  });

  it("an unclaimed host is the same not_found as a darkened one, and the request Host must equal the key", async () => {
    hostIs(OTHER);
    expect(await sites.resolveSiteOrganization(OTHER)).toEqual({ kind: "not_found", mode: "host", slug: null });
    hostIs(OTHER);
    // The real, serving key, requested from a different Host: refused before the database is asked.
    expect(await sites.resolveSiteOrganization(CANONICAL)).toEqual({ kind: "not_found", mode: "host", slug: null });
  });

  const DARKENERS: Array<[string, () => SQL, () => SQL | SQL[]]> = [
    ["canonical live -> lapsed", () => sql`update organization_domains set state = 'lapsed' where id = ${canonicalId}`, () => [
        sql`update organization_domains set state = 'verified' where id = ${canonicalId}`,
        sql`update organization_domains set state = 'attach_pending' where id = ${canonicalId}`,
        sql`update organization_domains set state = 'attached' where id = ${canonicalId}`,
        sql`update organization_domains set state = 'live' where id = ${canonicalId}`,
      ]],
    ["canonical paused", () => sql`update organization_domains set platform_hold = 'paused', hold_reason = 'fixture hold' where id = ${canonicalId}`, () => sql`update organization_domains set platform_hold = null, hold_reason = null where id = ${canonicalId}`],
    ["canonical disputed", () => sql`update organization_domains set platform_hold = 'disputed', hold_reason = 'fixture hold' where id = ${canonicalId}`, () => sql`update organization_domains set platform_hold = null, hold_reason = null where id = ${canonicalId}`],
    ["toggle off", () => sql`update organization_feature_toggles set enabled = false where organization_id = ${org} and feature_key = 'org_portal.domains'`, () => sql`update organization_feature_toggles set enabled = true where organization_id = ${org} and feature_key = 'org_portal.domains'`],
    ["site suspended", () => sql`update organization_sites set status = 'suspended' where organization_id = ${org}`, () => sql`update organization_sites set status = 'live' where organization_id = ${org}`],
    ["org inactive", () => sql`update organizations set status = 'inactive' where id = ${org}`, () => sql`update organizations set status = 'active' where id = ${org}`],
    ["render flag off", () => sql`update feature_flags set enabled = false where key = 'sites.public_render'`, () => sql`update feature_flags set enabled = true where key = 'sites.public_render'`],
  ];

  it.each(DARKENERS)("%s: the host is the one neutral not_found through the app", async (label, flip, restore) => {
    await withFlip(flip(), restore(), async () => {
      hostIs(CANONICAL);
      expect(await sites.resolveSiteOrganization(CANONICAL), label).toEqual({ kind: "not_found", mode: "host", slug: null });
      hostIs(CANONICAL);
      expect((await sites.resolveSite(CANONICAL)).kind, label).toBe("not_found");
      hostIs(CANONICAL);
      expect(await sites.resolveGiveSite(CANONICAL), label).toBeNull();
    });
    // ...and restoring the condition restores service (the flag is cached per module only by React's cache(), which is a no-op here).
    hostIs(CANONICAL);
    expect((await sites.resolveSiteOrganization(CANONICAL)).kind, `${label} restored`).toBe("ok");
  });

  describe("donorOrigin: the donor's return origin follows the same predicate", () => {
    it("a serving org returns its canonical custom host; the platform origin when nothing serves", async () => {
      expect(await donor.donorOrigin(slug)).toEqual({ origin: `https://${CANONICAL}`, custom: true });
      await withFlip(
        sql`update organization_domains set platform_hold = 'paused', hold_reason = 'fixture hold' where id = ${canonicalId}`,
        sql`update organization_domains set platform_hold = null, hold_reason = null where id = ${canonicalId}`,
        async () => {
          expect(await donor.donorOrigin(slug)).toEqual({ origin: "https://app.example.invalid", custom: false });
        },
      );
      expect(await donor.donorOrigin(slug)).toEqual({ origin: `https://${CANONICAL}`, custom: true });
    });

    it("an unknown slug, a suspended site and a toggle-off org all fall to the platform origin", async () => {
      expect(await donor.donorOrigin(`no-such-${stamp}`)).toEqual({ origin: "https://app.example.invalid", custom: false });
      for (const [, flip, restore] of DARKENERS.filter(([l]) => l === "site suspended" || l === "toggle off" || l === "org inactive")) {
        await withFlip(flip(), restore(), async () => {
          expect(await donor.donorOrigin(slug)).toEqual({ origin: "https://app.example.invalid", custom: false });
        });
      }
    });

    it("the request's Host / X-Forwarded-Host play no part: the answer is a function of the slug alone", async () => {
      hostIs("attacker.invalid", { "x-forwarded-host": "attacker.invalid", forwarded: "host=attacker.invalid" });
      expect(await donor.donorOrigin(slug)).toEqual({ origin: `https://${CANONICAL}`, custom: true });
    });
  });
});
