/**
 * SF-1..SF-5 - the staged ingest end to end, IN PROCESS: the real plan, images
 * and commit handlers called in sequence against real Postgres, with a real
 * signed token minted for every request (site-ingest-size, DECISION-279;
 * docs/work-log/2026-10-26-site-ingest-size.md, Phase 3 "Test plan"). This is
 * the regression for the production failure: a site whose single-request bundle
 * is over the platform's 4.5 MB cap now publishes, and NO request in the
 * sequence carries more than 4,000,000 bytes. Needs drizzle/0072 applied.
 *
 * All image bytes are synthetic (a valid PNG signature plus deterministic
 * filler). Nothing from any real site.
 *
 * Run: npx dotenv -e .env.local -- vitest run --no-file-parallelism src/app/api/sites/ingest/staged-flow.test.ts
 */
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createIngestFixtures,
  createTokenSigner,
  enableSitesPublicRender,
  sha256Of,
  syntheticImage,
  type IngestFixtures,
  type TokenSigner,
} from "@/lib/testing/site-ingest-harness";

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const AUDIENCE = "https://presby.example.invalid/sites-ingest-flow-test";
const SITES_ORG = "presby-ingest-flow-test-org";
const stamp = Date.now();
const LIMIT = 4_000_000;
const VERCEL_CAP = 4_500_000;

describe.skipIf(!hasDb)("staged ingest, plan -> upload -> commit, in process (real Postgres)", () => {
  let handlers: {
    plan: typeof import("./plan/route").POST;
    images: typeof import("./images/route").POST;
    commit: typeof import("./commit/route").POST;
  };
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizationSites: typeof import("@/lib/db/domain/sites").organizationSites;
  let blobAssets: typeof import("@/lib/db/domain/assets").blobAssets;
  let getBlobStore: typeof import("@/lib/storage/blob-store").getBlobStore;
  let resetJwks: () => void;

  let signer: TokenSigner;
  let fixtures: IngestFixtures;
  let restoreFlag: () => Promise<void>;

  /** Every request body the flow sends, by step, in bytes. */
  let sent: Array<{ step: string; bytes: number }>;

  // Five synthetic photos of 1,000,000 bytes: 5 MB raw, so the legacy (base64) body is ~6.7 MB.
  const photos = Array.from({ length: 5 }, (_, i) => ({
    key: `photo-${i + 1}`,
    bytes: syntheticImage(i % 2 === 0 ? "jpeg" : "png", 1_000_000, `flow ${stamp} ${i}`),
  }));
  const page = (path: string) => ({ path, frontMatter: { title: path }, mdxAst: { type: "root", children: [] } });
  const pages = [page("/"), page("/about")];

  function legacyBodyBytes(): number {
    const images = photos.map((p) => ({ manifestKey: p.key, contentType: "image/png", bytesBase64: p.bytes.toString("base64") }));
    return Buffer.byteLength(JSON.stringify({ bundle: { schemaVersion: 1, pages, images } }));
  }

  function makeClient(repo: string, sha: string) {
    const token = () => signer.signToken({ repository: repo, sha }); // a fresh token for EVERY request
    const send = async (step: "plan" | "images" | "commit", payload: string | Buffer, extra: Record<string, string> = {}) => {
      sent.push({ step, bytes: Buffer.byteLength(payload) });
      const handler = handlers[step];
      return handler(
        new Request(`http://presby.example.invalid/api/sites/ingest/${step}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token()}`, "x-presby-ingest-protocol": "1", ...extra },
          body: payload as unknown as BodyInit,
        }),
      );
    };
    return {
      plan: (hashes: string[]) =>
        send("plan", JSON.stringify({ images: hashes.map((sha256) => ({ sha256, size: 1_000_000 })) }), { "content-type": "application/json" }),
      upload: (bytes: Buffer) => send("images", bytes, { "content-type": "application/octet-stream", "x-presby-sha256": sha256Of(bytes) }),
      commit: (images: Array<{ manifestKey: string; sha256: string }>) =>
        send("commit", JSON.stringify({ schemaVersion: 1, pages, images }), { "content-type": "application/json" }),
    };
  }

  const allImages = () => photos.map((p) => ({ manifestKey: p.key, sha256: sha256Of(p.bytes) }));

  beforeAll(async () => {
    handlers = {
      plan: (await import("./plan/route")).POST,
      images: (await import("./images/route")).POST,
      commit: (await import("./commit/route")).POST,
    };
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizationSites } = await import("@/lib/db/domain/sites"));
    ({ blobAssets } = await import("@/lib/db/domain/assets"));
    ({ getBlobStore } = await import("@/lib/storage/blob-store"));
    resetJwks = (await import("@/lib/sites-ingest-auth"))._resetJwksCacheForTests;

    signer = createTokenSigner({
      audience: AUDIENCE,
      sitesOrg: SITES_ORG,
      kid: "ingest-flow-test-key-1",
      defaultRepo: `${SITES_ORG}/unused`,
      defaultSha: `sha-default-${stamp}`,
    });
    restoreFlag = await enableSitesPublicRender();
    fixtures = await createIngestFixtures("sites-ingest-flow-test", stamp);
  }, 40_000);

  afterAll(async () => {
    await restoreFlag?.();
    await fixtures?.teardown();
  });

  beforeEach(() => {
    sent = [];
    signer.stubEnv();
    signer.stubJwksFetch();
    mockRevalidatePath.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetJwks();
  });

  it("the fixture is genuinely over the cap: the legacy single-request body would exceed the platform's 4.5 MB", () => {
    expect(legacyBodyBytes()).toBeGreaterThan(VERCEL_CAP);
  });

  describe("SF-1 .. SF-3, SF-5 - one site, three pushes", () => {
    let site: { id: string; slug: string; repo: string };
    const SHA_1 = `sha-flow-1-${stamp}`;
    const SHA_2 = `sha-flow-2-${stamp}`;

    beforeAll(async () => {
      site = await fixtures.makeSite("flow", `${SITES_ORG}/site-flow-${stamp}`);
    });

    it("SF-1: publishes a site larger than 4.5 MB through plan, five uploads and a commit - every request within 4,000,000 bytes", async () => {
      const client = makeClient(site.repo, SHA_1);

      const planned = await client.plan([...new Set(allImages().map((i) => i.sha256))]);
      expect(await planned.json()).toEqual({ status: "planned", missing: allImages().map((i) => i.sha256) });

      for (const photo of photos) {
        const res = await client.upload(photo.bytes);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ status: "stored", sha256: sha256Of(photo.bytes), byteSize: 1_000_000 });
      }

      const committed = await client.commit(allImages());
      expect(committed.status).toBe(200);
      expect(await committed.json()).toEqual({ status: "ingested", organizationSlug: site.slug, commitSha: SHA_1, pageCount: 2 });

      expect(sent.map((s) => s.step)).toEqual(["plan", "images", "images", "images", "images", "images", "commit"]);
      for (const request of sent) expect(request.bytes, request.step).toBeLessThanOrEqual(LIMIT);
      // the point of the exercise: the sum is far over the cap, no single request is
      expect(sent.reduce((n, r) => n + r.bytes, 0)).toBeGreaterThan(5_000_000);
      expect(Math.max(...sent.map((s) => s.bytes))).toBeLessThanOrEqual(LIMIT);

      const [row] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
      expect(row!.lastIngestedCommitSha).toBe(SHA_1);
      expect(row!.status).toBe("live");
    });

    it("SF-5: every published imageKeys value resolves to the original bytes through the public door (resolvePublic)", async () => {
      const [row] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
      const bundle = await getBlobStore().resolve({ organizationId: site.id, key: row!.contentBundleKey!, audience: "private" });
      const stored = JSON.parse(bundle!.bytes.toString("utf8")) as { schemaVersion: number; imageKeys: Record<string, string> };
      expect(stored.schemaVersion).toBe(1);
      expect(Object.keys(stored.imageKeys).sort()).toEqual(photos.map((p) => p.key).sort());
      for (const photo of photos) {
        const served = await getBlobStore().resolvePublic({ organizationId: site.id, key: stored.imageKeys[photo.key]! });
        expect(served, photo.key).not.toBeNull();
        expect(served!.bytes.equals(photo.bytes)).toBe(true);
        expect(served!.cacheClass).toBe("site");
      }
    });

    it("SF-2: a new commit sha with the same images plans zero missing and needs only the commit", async () => {
      const client = makeClient(site.repo, SHA_2);
      const planned = await client.plan(allImages().map((i) => i.sha256));
      expect(await planned.json()).toEqual({ status: "planned", missing: [] });

      const imageRows = async () =>
        (await getPlatformDb().select({ audience: blobAssets.audience, contentType: blobAssets.contentType }).from(blobAssets).where(eq(blobAssets.organizationId, site.id))).filter(
          (r) => r.audience === "public_site",
        ).length;
      const imagesBefore = await imageRows();
      const committed = await client.commit(allImages());
      expect(committed.status).toBe(200);
      expect((await committed.json()).status).toBe("ingested");
      // no image row was added (and the bundle JSON is identical bytes, so it dedups too)
      expect(await imageRows()).toBe(imagesBefore);
      expect(imagesBefore).toBe(photos.length);
      const [row] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
      expect(row!.lastIngestedCommitSha).toBe(SHA_2);
      expect(sent.map((s) => s.step)).toEqual(["plan", "commit"]);
    });

    it("SF-3: the same sha again is already_current at the plan, and nothing is written", async () => {
      const blobsBefore = (await getPlatformDb().select({ id: blobAssets.id }).from(blobAssets).where(eq(blobAssets.organizationId, site.id))).length;
      const [rowBefore] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
      mockRevalidatePath.mockClear();

      const client = makeClient(site.repo, SHA_2);
      const planned = await client.plan(allImages().map((i) => i.sha256));
      expect(await planned.json()).toEqual({ status: "already_current", organizationSlug: site.slug, commitSha: SHA_2 });

      const blobsAfter = (await getPlatformDb().select({ id: blobAssets.id }).from(blobAssets).where(eq(blobAssets.organizationId, site.id))).length;
      expect(blobsAfter).toBe(blobsBefore);
      const [rowAfter] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
      expect(rowAfter).toEqual(rowBefore);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  it("SF-4: upload some, the commit is refused, upload the rest, and the same commit then succeeds (the sha is written last)", async () => {
    const site = await fixtures.makeSite("flow-partial", `${SITES_ORG}/site-flow-partial-${stamp}`);
    const sha = `sha-flow-partial-${stamp}`;
    const client = makeClient(site.repo, sha);

    for (const photo of photos.slice(0, 3)) expect((await client.upload(photo.bytes)).status).toBe(200);

    // an interrupted run re-plans: it now reports exactly the two it still lacks
    const replanned = await client.plan(allImages().map((i) => i.sha256));
    expect(await replanned.json()).toEqual({ status: "planned", missing: allImages().slice(3).map((i) => i.sha256) });

    const refused = await client.commit(allImages());
    expect(refused.status).toBe(422);
    const refusal = await refused.json();
    expect(refusal.code).toBe("images_not_uploaded");
    expect(refusal.error).toContain('"photo-4", "photo-5"');
    const [during] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
    expect(during!.lastIngestedCommitSha).toBeNull();
    expect(during!.contentBundleKey).toBeNull();

    for (const photo of photos.slice(3)) expect((await client.upload(photo.bytes)).status).toBe(200);
    const committed = await client.commit(allImages());
    expect(committed.status).toBe(200);
    const [after] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
    expect(after!.lastIngestedCommitSha).toBe(sha);
    for (const request of sent) expect(request.bytes).toBeLessThanOrEqual(LIMIT);
  });
});
