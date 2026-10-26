/**
 * D4 - the REAL public asset route against the real database (F289,
 * DECISION-277; docs/work-log/2026-10-25-public-asset-allowlist.md, Phase 3
 * "Test Plan" D4): the real `resolveSiteOrganization()`, the real
 * `presby_public_site_asset()` door, the real `sites.public_render` flag
 * (captured and restored). Only `next/headers` is faked, to supply the Host.
 *
 * What it pins end to end that the unit test (route.test.ts) can only assume:
 *
 *   - a `public_site` image serves 200, immutable, nosniff;
 *   - a listed roster photo serves 200 with exactly `private, max-age=86400`,
 *     and the SAME request after un-listing is the neutral 404;
 *   - the 404 for a private image, a private PDF, the bundle JSON, an unlisted
 *     photo, a foreign-org key and a random uuid is BYTE-IDENTICAL (status, body,
 *     every header) - DECISION-040: nothing observable says which of them exists;
 *   - slug mode and host mode give the same answers;
 *   - flag off is the same 404.
 *
 * Run (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism "src/app/(public)/site/[slug]/assets/[key]/route.db.test.ts"
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { CalendarFixture } from "@/lib/testing/calendar-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
type Row = Record<string, unknown>;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

describe.skipIf(!hasDb)("F289 public asset route (Postgres-backed)", () => {
  let fx: CalendarFixture;
  let GET: typeof import("./route").GET;
  let originalFlag: boolean;

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const HOST = `www.assets-${stamp}.invalid`;
  const ALIAS = `assets-${stamp}.invalid`;
  let org: string;
  let slug: string;
  let foreignOrg: string;

  const k: Record<string, string> = {};

  const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
  const q = async (query: SQL) => rowsOf(await fx.platform.execute(query));
  const hostIs = (host: string) => mockHeaders.mockResolvedValue(new Headers({ host }));

  async function blob(o: { org: string; bytes: Buffer; contentType: string; audience: "public_site" | "private"; id?: string }) {
    const id = o.id ?? randomUUID();
    await q(sql`insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
                values (${id}, ${o.org}, ${createHash("sha256").update(o.bytes).digest("hex")}, ${o.contentType},
                        ${o.bytes.byteLength}, decode(${o.bytes.toString("hex")}, 'hex'), ${o.audience})`);
    return id;
  }
  const png = (seed: string) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(`f289 d4 ${seed} ${randomUUID()}`)]);

  async function insertDomain(host: string, role: "canonical" | "alias"): Promise<string> {
    const [r] = await q(sql`
      insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)
      values (${org}, 'web', ${host}, ${ALIAS}, ${role}, ${"s".repeat(32)}, 'platform', ${fx.actingUserId}) returning id`);
    for (const to of ["verified", "attach_pending", "attached", "live"]) {
      await q(sql`update organization_domains set state = ${to} where id = ${String(r!.id)}`);
    }
    return String(r!.id);
  }

  async function fetchAsset(siteKey: string, key: string, path: "slug" | "host") {
    const url = path === "slug" ? `http://x/site/${siteKey}/assets/${key}` : `http://x/assets/${key}`;
    return GET(new Request(url), { params: Promise.resolve({ slug: siteKey, key }) });
  }

  /** Status, body bytes and every header, sorted: everything an observer can see. */
  async function shape(res: Response) {
    return {
      status: res.status,
      body: Buffer.from(await res.arrayBuffer()).toString("hex"),
      headers: [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b)),
    };
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/calendar-fixture");
    fx = await mod.createCalendarFixture("route-assets");
    ({ GET } = await import("./route"));

    const [flag] = await q(sql`select enabled from feature_flags where key = 'sites.public_render'`);
    originalFlag = Boolean(flag!.enabled);
    await q(sql`update feature_flags set enabled = true where key = 'sites.public_render'`);

    org = await fx.makeOrg("route");
    foreignOrg = await fx.makeOrg("route-foreign");
    const [o] = await q(sql`select slug from organizations where id = ${org}`);
    slug = String(o!.slug);
    for (const [id, s] of [[org, slug]] as const) {
      await q(sql`insert into organization_sites (organization_id, repo, status) values (${id}, ${`presby-fixtures/site-${s}`}, 'live')`);
    }
    const [fo] = await q(sql`select slug from organizations where id = ${foreignOrg}`);
    await q(sql`insert into organization_sites (organization_id, repo, status) values (${foreignOrg}, ${`presby-fixtures/site-${String(fo!.slug)}`}, 'live')`);
    await q(sql`insert into organization_feature_toggles (organization_id, feature_key, enabled) values (${org}, 'org_portal.domains', true)`);
    await insertDomain(HOST, "canonical");
    await insertDomain(ALIAS, "alias");

    k.siteImage = await blob({ org, bytes: png("site"), contentType: "image/png", audience: "public_site" });
    k.privateImage = await blob({ org, bytes: png("private"), contentType: "image/png", audience: "private" });
    k.privatePdf = await blob({ org, bytes: Buffer.from(`%PDF-1.7 f289 ${randomUUID()}`), contentType: "application/pdf", audience: "private" });
    k.bundle = await blob({
      org,
      bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, pages: [], imageKeys: {} })),
      contentType: "application/json",
      audience: "private",
    });
    await q(sql`update organization_sites set content_bundle_key = ${k.bundle} where organization_id = ${org}`);
    k.foreign = await blob({ org: foreignOrg, bytes: png("foreign"), contentType: "image/png", audience: "public_site" });

    // A roster photo: stored private, listed.
    k.photo = randomUUID();
    await blob({ org, id: k.photo, bytes: png("photo"), contentType: "image/png", audience: "private" });
    const person = await fx.makePerson("Listed", stamp);
    await q(sql`update people set photo_key = ${k.photo} where id = ${person}`);
    await fx.addMember(org, person);
    await q(sql`insert into staff_positions (organization_id, person_id, position, position_key, starts_on, public_listed)
                values (${org}, ${person}, 'Organist', 'organist', '2020-01-01', true)`);
    // An unlisted person's photo, stored public_site (the exclusion).
    k.unlistedPhoto = randomUUID();
    await blob({ org, id: k.unlistedPhoto, bytes: png("unlisted"), contentType: "image/png", audience: "public_site" });
    const unlisted = await fx.makePerson("Unlisted", stamp);
    await q(sql`update people set photo_key = ${k.unlistedPhoto} where id = ${unlisted}`);
    await fx.addMember(org, unlisted);
    await q(sql`insert into staff_positions (organization_id, person_id, position, position_key, starts_on, public_listed)
                values (${org}, ${unlisted}, 'Sexton', 'sexton', '2020-01-01', false)`);
  }, 90_000);

  afterAll(async () => {
    if (!fx) return;
    await q(sql`update feature_flags set enabled = ${originalFlag} where key = 'sites.public_render'`);
    const [after] = await q(sql`select enabled from feature_flags where key = 'sites.public_render'`);
    expect(Boolean(after!.enabled), "sites.public_render restored").toBe(originalFlag);
    for (const o of [org, foreignOrg]) {
      await q(sql`delete from organization_sites where organization_id = ${o}`);
    }
    await fx.cleanup();
  }, 90_000);

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", "app.example.invalid");
    hostIs("app.example.invalid");
  });

  it("a public_site image: 200, stored type, immutable, nosniff, exact bytes (slug mode and host mode agree)", async () => {
    const bySlug = await fetchAsset(slug, k.siteImage!, "slug");
    hostIs(HOST);
    const byHost = await fetchAsset(HOST, k.siteImage!, "host");

    for (const res of [bySlug, byHost]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
    expect(await shape(bySlug)).toEqual(await shape(byHost));
    hostIs("app.example.invalid"); // back to the platform host for the slug-mode read below
    const [stored] = await q(sql`select encode(bytes, 'hex') as hex from blob_assets where id = ${k.siteImage!}`);
    expect(Buffer.from(await (await fetchAsset(slug, k.siteImage!, "slug")).arrayBuffer()).toString("hex")).toBe(stored!.hex);
  });

  it("a listed roster photo: 200 with exactly 'private, max-age=86400'; un-listed, the same request is the neutral 404", async () => {
    const listed = await fetchAsset(slug, k.photo!, "slug");
    expect(listed.status).toBe(200);
    expect(listed.headers.get("Cache-Control")).toBe("private, max-age=86400");

    await q(sql`update staff_positions set public_listed = false where organization_id = ${org} and position_key = 'organist'`);
    try {
      const gone = await fetchAsset(slug, k.photo!, "slug");
      expect(gone.status).toBe(404);
      expect(await gone.text()).toBe('{"error":"Not found"}');
    } finally {
      await q(sql`update staff_positions set public_listed = true where organization_id = ${org} and position_key = 'organist'`);
    }
    expect((await fetchAsset(slug, k.photo!, "slug")).status).toBe(200);
  });

  it("every miss is byte-identical: a private image, a private PDF, the bundle JSON, an unlisted photo, a foreign-org key, a random uuid, a malformed key", async () => {
    const keys: Array<[string, string]> = [
      ["private image", k.privateImage!],
      ["private PDF", k.privatePdf!],
      ["bundle JSON", k.bundle!],
      ["unlisted photo stored public_site", k.unlistedPhoto!],
      ["foreign-org key", k.foreign!],
      ["random uuid", randomUUID()],
      ["nil uuid", "00000000-0000-0000-0000-000000000000"],
      ["malformed", "not-a-uuid"],
    ];
    const baseline = await shape(await fetchAsset(slug, randomUUID(), "slug"));
    expect(baseline.status).toBe(404);
    expect(Buffer.from(baseline.body, "hex").toString()).toBe('{"error":"Not found"}');
    expect(Object.fromEntries(baseline.headers)).toMatchObject({ "cache-control": "no-store", "x-content-type-options": "nosniff" });

    for (const [label, key] of keys) {
      expect(await shape(await fetchAsset(slug, key, "slug")), `${label} (slug mode)`).toEqual(baseline);
    }
    hostIs(HOST);
    for (const [label, key] of keys) {
      expect(await shape(await fetchAsset(HOST, key, "host")), `${label} (host mode)`).toEqual(baseline);
    }
    // An unknown slug and an unknown host are the same bytes too.
    expect(await shape(await fetchAsset(`nope-${stamp}`, k.siteImage!, "slug"))).toEqual(baseline);
    hostIs(`unclaimed-${stamp}.invalid`);
    expect(await shape(await fetchAsset(`unclaimed-${stamp}.invalid`, k.siteImage!, "host"))).toEqual(baseline);
  });

  it("the alias host serves the asset (no redirect) and a case variant of the key is the same answer", async () => {
    hostIs(ALIAS);
    const res = await fetchAsset(ALIAS, k.siteImage!.toUpperCase(), "host");
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("flag off: the same neutral 404, then restored", async () => {
    const baseline = await shape(await fetchAsset(slug, randomUUID(), "slug"));
    await q(sql`update feature_flags set enabled = false where key = 'sites.public_render'`);
    try {
      expect(await shape(await fetchAsset(slug, k.siteImage!, "slug"))).toEqual(baseline);
    } finally {
      await q(sql`update feature_flags set enabled = true where key = 'sites.public_render'`);
    }
    expect((await fetchAsset(slug, k.siteImage!, "slug")).status).toBe(200);
  });
});
