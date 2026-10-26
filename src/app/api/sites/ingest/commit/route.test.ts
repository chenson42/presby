/**
 * CM-1..CM-12 - `POST /api/sites/ingest/commit`, against real Postgres and real
 * OIDC verification (site-ingest-size, DECISION-279;
 * docs/work-log/2026-10-26-site-ingest-size.md, Phase 3 "Test plan"). Needs
 * drizzle/0072 applied.
 *
 * Run: npx dotenv -e .env.local -- vitest run --no-file-parallelism src/app/api/sites/ingest/commit/route.test.ts
 */
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createIngestFixtures,
  createTokenSigner,
  enableSitesPublicRender,
  setSitesPublicRender,
  sha256Of,
  syntheticImage,
  type IngestFixtures,
  type TokenSigner,
} from "@/lib/testing/site-ingest-harness";

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const AUDIENCE = "https://presby.example.invalid/sites-ingest-commit-test";
const SITES_ORG = "presby-ingest-commit-test-org";
const stamp = Date.now();
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Site = { id: string; slug: string; repo: string };

describe.skipIf(!hasDb)("POST /api/sites/ingest/commit (real Postgres + real OIDC verification)", () => {
  let POST: typeof import("./route").POST;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizationSites: typeof import("@/lib/db/domain/sites").organizationSites;
  let blobAssets: typeof import("@/lib/db/domain/assets").blobAssets;
  let auditEvents: typeof import("@/lib/db/schema").auditEvents;
  let getBlobStore: typeof import("@/lib/storage/blob-store").getBlobStore;
  let getPublishedSite: typeof import("@/lib/sites").getPublishedSite;
  let resetJwks: () => void;

  let signer: TokenSigner;
  let fixtures: IngestFixtures;
  let restoreFlag: () => Promise<void>;
  let site: Site;
  let otherSite: Site;
  let current: Site;
  let suspended: Site;

  const PROTOCOL = { "x-presby-ingest-protocol": "1" };
  const img = (seed: string, size = 96) => syntheticImage("png", size, `commit ${stamp} ${seed}`);
  const page = (path = "/") => ({ path, frontMatter: { title: "Fixture" }, mdxAst: { type: "root", children: [] } });
  const body = (over: Record<string, unknown> = {}) => ({ schemaVersion: 1, pages: [page()], images: [], ...over });

  function commitRequest(token: string | null, payload: unknown, headers: Record<string, string> = PROTOCOL): Request {
    const h = new Headers({ "content-type": "application/json", ...headers });
    if (token !== null) h.set("authorization", `Bearer ${token}`);
    return new Request("http://presby.example.invalid/api/sites/ingest/commit", {
      method: "POST",
      headers: h,
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  }

  const tokenFor = (s: { repo: string }, sha: string) => signer.signToken({ repository: s.repo, sha });
  const hold = (orgId: string, bytes: Buffer, audience: "public_site" | "private" = "public_site") =>
    getBlobStore().store({ organizationId: orgId, bytes, contentType: "image/png", audience });

  async function siteRow(orgId: string) {
    const [row] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, orgId));
    return row!;
  }
  async function blobRows(orgId: string) {
    return getPlatformDb()
      .select({ id: blobAssets.id, audience: blobAssets.audience, contentType: blobAssets.contentType, hash: blobAssets.contentHash, bytes: blobAssets.bytes })
      .from(blobAssets)
      .where(eq(blobAssets.organizationId, orgId));
  }
  async function auditRows(orgId: string) {
    return getPlatformDb()
      .select({ metadata: auditEvents.metadata, actorUserId: auditEvents.actorUserId })
      .from(auditEvents)
      .where(and(eq(auditEvents.resourceId, orgId), eq(auditEvents.action, "site.content_ingested")));
  }

  beforeAll(async () => {
    ({ POST } = await import("./route"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizationSites } = await import("@/lib/db/domain/sites"));
    ({ blobAssets } = await import("@/lib/db/domain/assets"));
    ({ auditEvents } = await import("@/lib/db/schema"));
    ({ getBlobStore } = await import("@/lib/storage/blob-store"));
    ({ getPublishedSite } = await import("@/lib/sites"));
    resetJwks = (await import("@/lib/sites-ingest-auth"))._resetJwksCacheForTests;

    signer = createTokenSigner({
      audience: AUDIENCE,
      sitesOrg: SITES_ORG,
      kid: "ingest-commit-test-key-1",
      defaultRepo: `${SITES_ORG}/unused`,
      defaultSha: `sha-default-${stamp}`,
    });
    restoreFlag = await enableSitesPublicRender();
    fixtures = await createIngestFixtures("sites-ingest-commit-test", stamp);
    site = await fixtures.makeSite("main", `${SITES_ORG}/site-commit-main-${stamp}`);
    otherSite = await fixtures.makeSite("other", `${SITES_ORG}/site-commit-other-${stamp}`);
    current = await fixtures.makeSite("current", `${SITES_ORG}/site-commit-current-${stamp}`);
    suspended = await fixtures.makeSite("suspended", `${SITES_ORG}/site-commit-suspended-${stamp}`, { suspended: true });
    await getPlatformDb().update(organizationSites).set({ lastIngestedCommitSha: `sha-already-${stamp}` }).where(eq(organizationSites.organizationId, current.id));
  }, 40_000);

  afterAll(async () => {
    await restoreFlag?.();
    await fixtures?.teardown();
  });

  beforeEach(() => {
    signer.stubEnv();
    signer.stubJwksFetch();
    mockRevalidatePath.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetJwks();
  });

  describe("CM-1 - the gate", () => {
    it("401 with no token", async () => {
      const res = await POST(commitRequest(null, body()));
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("unauthorized");
    });

    it("503 ingest_disabled when sites.public_render is off", async () => {
      await setSitesPublicRender(false);
      try {
        const res = await POST(commitRequest(tokenFor(site, `sha-cm1-503-${stamp}`), body()));
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe("ingest_disabled");
      } finally {
        await setSitesPublicRender(true);
      }
      expect((await siteRow(site.id)).lastIngestedCommitSha).toBeNull();
    });

    it("404 site_not_provisioned", async () => {
      const res = await POST(commitRequest(signer.signToken({ repository: `${SITES_ORG}/never-${stamp}`, sha: `sha-cm1-404-${stamp}` }), body()));
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("site_not_provisioned");
    });

    it("200 already_current: nothing is published", async () => {
      const res = await POST(commitRequest(tokenFor(current, `sha-already-${stamp}`), body()));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "already_current", organizationSlug: current.slug, commitSha: `sha-already-${stamp}` });
      expect(await blobRows(current.id)).toHaveLength(0);
      expect(await auditRows(current.id)).toHaveLength(0);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  it("CM-2: publishes - the legacy success body, a private { schemaVersion, pages, imageKeys } bundle, public_site image keys, the staged audit row, both revalidations", async () => {
    const hero = img("cm2-hero");
    const logo = img("cm2-logo", 140);
    await hold(site.id, hero);
    await hold(site.id, logo);
    const sha = `sha-cm2-${stamp}`;
    const pages = [page("/"), page("/about")];

    const res = await POST(
      commitRequest(tokenFor(site, sha), body({ pages, images: [{ manifestKey: "hero", sha256: sha256Of(hero) }, { manifestKey: "logo", sha256: sha256Of(logo) }] })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ingested", organizationSlug: site.slug, commitSha: sha, pageCount: 2 });

    const row = await siteRow(site.id);
    expect(row.lastIngestedCommitSha).toBe(sha);
    expect(row.status).toBe("live");
    expect(row.contentBundleKey).toBeTruthy();

    // the bundle is a PRIVATE application/json row, in the stored shape
    const bundleRow = (await blobRows(site.id)).find((r) => r.id === row.contentBundleKey)!;
    expect(bundleRow).toMatchObject({ audience: "private", contentType: "application/json" });
    const stored = JSON.parse(Buffer.from(bundleRow.bytes).toString("utf8")) as { schemaVersion: number; pages: unknown; imageKeys: Record<string, string> };
    expect(Object.keys(stored).sort()).toEqual(["imageKeys", "pages", "schemaVersion"]);
    expect(stored.schemaVersion).toBe(1);
    expect(stored.pages).toEqual(pages);

    // every imageKeys value resolves as a public_site image with the original bytes
    expect(Object.keys(stored.imageKeys).sort()).toEqual(["hero", "logo"]);
    for (const [key, bytes] of [["hero", hero], ["logo", logo]] as const) {
      const resolved = await getBlobStore().resolve({ organizationId: site.id, key: stored.imageKeys[key]!, audience: "public_site" });
      expect(resolved?.bytes.equals(bytes)).toBe(true);
    }

    const audit = await auditRows(site.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBeNull();
    expect(audit[0]!.metadata).toEqual({ repo: site.repo, commitSha: sha, pageCount: 2, imageCount: 2, transport: "staged" });

    expect(mockRevalidatePath).toHaveBeenCalledWith(`/site/${site.slug}`, "layout");
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/site/${site.slug}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/site/${site.slug}/about`);
    expect(mockRevalidatePath).toHaveBeenCalledTimes(3);
  });

  it("CM-3: two manifest keys with one hash make one blob and two keys", async () => {
    const twin = img("cm3");
    await hold(site.id, twin);
    const before = (await blobRows(site.id)).filter((r) => r.hash === sha256Of(twin)).length;
    const res = await POST(
      commitRequest(tokenFor(site, `sha-cm3-${stamp}`), body({ images: [{ manifestKey: "a", sha256: sha256Of(twin) }, { manifestKey: "b", sha256: sha256Of(twin) }] })),
    );
    expect(res.status).toBe(200);
    const row = await siteRow(site.id);
    const bundleRow = (await blobRows(site.id)).find((r) => r.id === row.contentBundleKey)!;
    const stored = JSON.parse(Buffer.from(bundleRow.bytes).toString("utf8")) as { imageKeys: Record<string, string> };
    expect(stored.imageKeys.a).toBeTruthy();
    expect(stored.imageKeys.a).toBe(stored.imageKeys.b);
    expect((await blobRows(site.id)).filter((r) => r.hash === sha256Of(twin))).toHaveLength(before);
    expect(before).toBe(1);
  });

  it("CM-4: a hash that was never uploaded refuses the whole commit naming the keys, changes nothing, and the same commit succeeds once it is uploaded", async () => {
    const present = img("cm4-present");
    const absent = img("cm4-absent");
    await hold(site.id, present);
    const sha = `sha-cm4-${stamp}`;
    const before = await siteRow(site.id);
    const blobsBefore = (await blobRows(site.id)).length;
    const auditBefore = (await auditRows(site.id)).length;
    const payload = body({ images: [{ manifestKey: "here", sha256: sha256Of(present) }, { manifestKey: "gone", sha256: sha256Of(absent) }] });

    const refused = await POST(commitRequest(tokenFor(site, sha), payload));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      status: "error",
      code: "images_not_uploaded",
      error: 'These images are not available to this site yet: "gone". Upload them, then commit again.',
    });
    const after = await siteRow(site.id);
    expect(after.lastIngestedCommitSha).toBe(before.lastIngestedCommitSha);
    expect(after.contentBundleKey).toBe(before.contentBundleKey);
    expect((await blobRows(site.id)).length).toBe(blobsBefore); // no bundle row either
    expect((await auditRows(site.id)).length).toBe(auditBefore);
    expect(mockRevalidatePath).not.toHaveBeenCalled();

    await hold(site.id, absent);
    const ok = await POST(commitRequest(tokenFor(site, sha), payload));
    expect(ok.status).toBe(200);
    expect((await siteRow(site.id)).lastIngestedCommitSha).toBe(sha);
  });

  it("CM-4: more than 20 missing keys name 20 and count the rest", async () => {
    const images = Array.from({ length: 25 }, (_, i) => ({ manifestKey: `m${String(i).padStart(2, "0")}`, sha256: sha256Of(img(`cm4-many-${i}`)) }));
    const res = await POST(commitRequest(tokenFor(site, `sha-cm4-many-${stamp}`), body({ images })));
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error).toContain('"m00", "m01"');
    expect(error).toContain('"m19" (and 5 more).');
    expect(error).not.toContain('"m20"');
  });

  describe("CM-5 - only public_site images in this organization count", () => {
    it("a hash held only as private is refused", async () => {
      const privateOnly = img("cm5-private");
      await hold(site.id, privateOnly, "private");
      const res = await POST(commitRequest(tokenFor(site, `sha-cm5a-${stamp}`), body({ images: [{ manifestKey: "p", sha256: sha256Of(privateOnly) }] })));
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("images_not_uploaded");
    });

    it("a hash held only by another organization is refused", async () => {
      const theirs = img("cm5-other");
      await hold(otherSite.id, theirs);
      const res = await POST(commitRequest(tokenFor(site, `sha-cm5b-${stamp}`), body({ images: [{ manifestKey: "t", sha256: sha256Of(theirs) }] })));
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("images_not_uploaded");
    });
  });

  it("CM-6: a repeated manifestKey is 422", async () => {
    const x = img("cm6");
    await hold(site.id, x);
    const res = await POST(
      commitRequest(tokenFor(site, `sha-cm6-${stamp}`), body({ images: [{ manifestKey: "k", sha256: sha256Of(x) }, { manifestKey: "k", sha256: sha256Of(x) }] })),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ status: "error", code: "invalid_request", error: 'images[1] repeats the manifestKey "k".' });
  });

  describe("CM-7 - manifest key rules", () => {
    const entry = (manifestKey: string) => ({ manifestKey, sha256: "a".repeat(64) });
    const refusal = "images[0] needs a manifestKey of 1 to 200 characters with no control characters, and a lowercase 64-character sha256.";

    it.each([["empty", ""], ["201 characters", "k".repeat(201)], ["a control character", "bad\u0001key"], ["DEL", "bad\u007fkey"]])("refuses %s", async (_n, key) => {
      const res = await POST(commitRequest(tokenFor(site, `sha-cm7-${stamp}`), body({ images: [entry(key)] })));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe(refusal);
    });

    it("accepts a 200-character key, spaces, non-ASCII and __proto__ - and __proto__ survives as data", async () => {
      const bytes = img("cm7");
      await hold(site.id, bytes);
      const sha = `sha-cm7-ok-${stamp}`;
      const keys = ["k".repeat(200), "hero image v2", "Kéy 教会", "__proto__"];
      const res = await POST(commitRequest(tokenFor(site, sha), body({ images: keys.map((manifestKey) => ({ manifestKey, sha256: sha256Of(bytes) })) })));
      expect(res.status).toBe(200);
      const row = await siteRow(site.id);
      const bundleRow = (await blobRows(site.id)).find((r) => r.id === row.contentBundleKey)!;
      const text = Buffer.from(bundleRow.bytes).toString("utf8");
      const stored = JSON.parse(text) as { imageKeys: Record<string, string> };
      expect(Object.keys(stored.imageKeys).sort()).toEqual([...keys].sort());
      expect(Object.prototype.hasOwnProperty.call(stored.imageKeys, "__proto__")).toBe(true);
    });
  });

  it.each([
    ["/give", "give"],
    ["/robots.txt", "robots.txt"],
  ])("CM-8: a page at %s is 422 reserved_page with today's text, and nothing is written", async (path, segment) => {
    const before = await siteRow(site.id);
    const res = await POST(commitRequest(tokenFor(site, `sha-cm8-${segment}-${stamp}`), body({ pages: [page("/"), page(path)] })));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe("reserved_page");
    expect(json.error).toContain(`Page "${path}" is reserved: PresbyPortal serves its own /${segment}`);
    expect((await siteRow(site.id)).lastIngestedCommitSha).toBe(before.lastIngestedCommitSha);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("CM-9: empty images publish; empty pages are refused", async () => {
    const empty = await POST(commitRequest(tokenFor(site, `sha-cm9a-${stamp}`), body({ images: [] })));
    expect(empty.status).toBe(200);
    const none = await POST(commitRequest(tokenFor(site, `sha-cm9b-${stamp}`), body({ pages: [] })));
    expect(none.status).toBe(422);
    expect(await none.json()).toEqual({ status: "error", code: "invalid_request", error: "pages must be a non-empty array." });
  });

  it("CM-10: a suspended site stays suspended, its content still advances", async () => {
    const sha = `sha-cm10-${stamp}`;
    const res = await POST(commitRequest(tokenFor(suspended, sha), body()));
    expect(res.status).toBe(200);
    const row = await siteRow(suspended.id);
    expect(row.status).toBe("suspended");
    expect(row.lastIngestedCommitSha).toBe(sha);
    expect(await getPublishedSite(suspended.slug)).toEqual({ kind: "not_found" });
  });

  it("CM-11: 4,000,001 bytes is 413; a missing or wrong protocol header is 422 unsupported_protocol", async () => {
    const big = JSON.stringify({ ...body(), pad: "a".repeat(4_000_001) });
    const tooBig = await POST(commitRequest(tokenFor(site, `sha-cm11a-${stamp}`), big));
    expect(tooBig.status).toBe(413);
    expect((await tooBig.json()).code).toBe("request_too_large");
    const unauth = await POST(commitRequest(null, big, { ...PROTOCOL, "content-length": String(Buffer.byteLength(big)) }));
    expect(unauth.status).toBe(401);

    for (const headers of [{}, { "x-presby-ingest-protocol": "2" }] as Array<Record<string, string>>) {
      const res = await POST(commitRequest(tokenFor(site, `sha-cm11b-${stamp}`), body(), headers));
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("unsupported_protocol");
    }
    const notJson = await POST(commitRequest(tokenFor(site, `sha-cm11c-${stamp}`), "{nope"));
    expect(notJson.status).toBe(422);
    expect((await notJson.json()).code).toBe("invalid_json");
  });

  it("CM-12: no response body contains a uuid-shaped string - published, refused or already current", async () => {
    const held = img("cm12");
    await hold(site.id, held);
    const published = await POST(commitRequest(tokenFor(site, `sha-cm12a-${stamp}`), body({ images: [{ manifestKey: "h", sha256: sha256Of(held) }] })));
    expect(published.status).toBe(200);
    expect(UUID_RE.test(await published.text())).toBe(false);

    const refused = await POST(commitRequest(tokenFor(site, `sha-cm12b-${stamp}`), body({ images: [{ manifestKey: "x", sha256: sha256Of(img("cm12-none")) }] })));
    expect(UUID_RE.test(await refused.text())).toBe(false);

    const again = await POST(commitRequest(tokenFor(site, `sha-cm12a-${stamp}`), body()));
    expect(await again.json()).toMatchObject({ status: "already_current" });
  });
});
