/**
 * UP-1..UP-10 - `POST /api/sites/ingest/images`, against real Postgres and real
 * OIDC verification (site-ingest-size, DECISION-279;
 * docs/work-log/2026-10-26-site-ingest-size.md, Phase 3 "Test plan"). Needs
 * drizzle/0072 applied.
 *
 * Run: npx dotenv -e .env.local -- vitest run --no-file-parallelism src/app/api/sites/ingest/images/route.test.ts
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

const AUDIENCE = "https://presby.example.invalid/sites-ingest-images-test";
const SITES_ORG = "presby-ingest-images-test-org";
const stamp = Date.now();
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe.skipIf(!hasDb)("POST /api/sites/ingest/images (real Postgres + real OIDC verification)", () => {
  let POST: typeof import("./route").POST;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizationSites: typeof import("@/lib/db/domain/sites").organizationSites;
  let blobAssets: typeof import("@/lib/db/domain/assets").blobAssets;
  let auditEvents: typeof import("@/lib/db/schema").auditEvents;
  let resetJwks: () => void;

  let signer: TokenSigner;
  let fixtures: IngestFixtures;
  let restoreFlag: () => Promise<void>;
  let site: { id: string; slug: string; repo: string };
  let current: { id: string; slug: string; repo: string };

  const PROTOCOL = "x-presby-ingest-protocol";
  const SHA = "x-presby-sha256";
  const img = (seed: string, size = 128, kind: "png" | "jpeg" | "webp" = "png") => syntheticImage(kind, size, `images ${stamp} ${seed}`);

  function uploadRequest(
    token: string | null,
    bytes: Buffer,
    over: { headers?: Record<string, string | null>; hash?: string | null } = {},
  ): Request {
    const h = new Headers({ "content-type": "application/octet-stream", [PROTOCOL]: "1", [SHA]: over.hash === undefined ? sha256Of(bytes) : (over.hash ?? "") });
    if (over.hash === null) h.delete(SHA);
    for (const [k, v] of Object.entries(over.headers ?? {})) {
      if (v === null) h.delete(k);
      else h.set(k, v);
    }
    if (token !== null) h.set("authorization", `Bearer ${token}`);
    return new Request("http://presby.example.invalid/api/sites/ingest/images", { method: "POST", headers: h, body: bytes as unknown as BodyInit });
  }

  const tokenFor = (s: { repo: string }, sha: string) => signer.signToken({ repository: s.repo, sha });

  async function rows(orgId: string) {
    return getPlatformDb()
      .select({ id: blobAssets.id, audience: blobAssets.audience, contentType: blobAssets.contentType, hash: blobAssets.contentHash })
      .from(blobAssets)
      .where(eq(blobAssets.organizationId, orgId));
  }

  beforeAll(async () => {
    ({ POST } = await import("./route"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizationSites } = await import("@/lib/db/domain/sites"));
    ({ blobAssets } = await import("@/lib/db/domain/assets"));
    ({ auditEvents } = await import("@/lib/db/schema"));
    resetJwks = (await import("@/lib/sites-ingest-auth"))._resetJwksCacheForTests;

    signer = createTokenSigner({
      audience: AUDIENCE,
      sitesOrg: SITES_ORG,
      kid: "ingest-images-test-key-1",
      defaultRepo: `${SITES_ORG}/unused`,
      defaultSha: `sha-default-${stamp}`,
    });
    restoreFlag = await enableSitesPublicRender();
    fixtures = await createIngestFixtures("sites-ingest-images-test", stamp);
    site = await fixtures.makeSite("main", `${SITES_ORG}/site-images-main-${stamp}`);
    current = await fixtures.makeSite("current", `${SITES_ORG}/site-images-current-${stamp}`);
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

  describe("UP-1 - the gate", () => {
    it("401: no token", async () => {
      const res = await POST(uploadRequest(null, img("up1")));
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("unauthorized");
    });

    it("503 ingest_disabled when sites.public_render is off, and nothing is stored", async () => {
      const bytes = img("up1-503");
      await setSitesPublicRender(false);
      try {
        const res = await POST(uploadRequest(tokenFor(site, `sha-up1-503-${stamp}`), bytes));
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe("ingest_disabled");
      } finally {
        await setSitesPublicRender(true);
      }
      expect((await rows(site.id)).some((r) => r.hash === sha256Of(bytes))).toBe(false);
    });

    it("404 site_not_provisioned", async () => {
      const res = await POST(uploadRequest(signer.signToken({ repository: `${SITES_ORG}/never-${stamp}`, sha: `sha-up1-404-${stamp}` }), img("up1-404")));
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("site_not_provisioned");
    });

    it("200 already_current: nothing is stored, even for a perfectly good image", async () => {
      const bytes = img("up1-current");
      const res = await POST(uploadRequest(tokenFor(current, `sha-already-${stamp}`), bytes));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "already_current", organizationSlug: current.slug, commitSha: `sha-already-${stamp}` });
      expect(await rows(current.id)).toHaveLength(0);
    });
  });

  it("UP-2: stores a public_site row with the sniffed type, and answers { status, sha256, byteSize, contentType }", async () => {
    const bytes = img("up2", 300);
    const res = await POST(uploadRequest(tokenFor(site, `sha-up2-${stamp}`), bytes));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "stored", sha256: sha256Of(bytes), byteSize: 300, contentType: "image/png" });

    const stored = (await rows(site.id)).filter((r) => r.hash === sha256Of(bytes));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ audience: "public_site", contentType: "image/png" });
  });

  it.each([
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
  ] as const)("UP-2: a %s is stored with its own sniffed type", async (kind, type) => {
    const bytes = img(`up2-${kind}`, 200, kind);
    const res = await POST(uploadRequest(tokenFor(site, `sha-up2-${kind}-${stamp}`), bytes));
    expect(res.status).toBe(200);
    expect((await res.json()).contentType).toBe(type);
  });

  it("UP-2: an image of exactly 4,000,000 bytes (the whole request limit) is accepted", async () => {
    const bytes = img("up2-max", 4_000_000);
    const res = await POST(uploadRequest(tokenFor(site, `sha-up2-max-${stamp}`), bytes));
    expect(res.status).toBe(200);
    expect((await res.json()).byteSize).toBe(4_000_000);
  });

  it("UP-3: bytes that do not match x-presby-sha256 are 422 hash_mismatch and nothing is stored", async () => {
    const bytes = img("up3");
    const other = sha256Of(img("up3-other"));
    const before = (await rows(site.id)).length;
    const res = await POST(uploadRequest(tokenFor(site, `sha-up3-${stamp}`), bytes, { hash: other }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ status: "error", code: "hash_mismatch", error: "The bytes received do not match x-presby-sha256." });
    expect((await rows(site.id)).length).toBe(before);
  });

  describe("UP-4 - not an image", () => {
    it.each([
      ["garbage", Buffer.from("this is definitely not an image, it is text")],
      ["a PDF", Buffer.from("%PDF-1.7\n synthetic pdf body")],
      ["a GIF", Buffer.from("GIF89a-synthetic-gif-bytes")],
    ])("%s is 422 not_an_image (the hash is right; the sniff decides) and nothing is stored", async (_n, bytes) => {
      const before = (await rows(site.id)).length;
      const res = await POST(uploadRequest(tokenFor(site, `sha-up4-${stamp}`), bytes));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ status: "error", code: "not_an_image", error: "The uploaded file is not a PNG, JPEG, or WEBP." });
      expect((await rows(site.id)).length).toBe(before);
    });

    it("an empty body is 422 invalid_request", async () => {
      const res = await POST(uploadRequest(tokenFor(site, `sha-up4-empty-${stamp}`), Buffer.alloc(0)));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ status: "error", code: "invalid_request", error: "The image body is empty." });
    });
  });

  it("UP-5: the hash header missing, uppercase or short is 422 invalid_request", async () => {
    const bytes = img("up5");
    for (const hash of [null, sha256Of(bytes).toUpperCase().replace(/[0-9]/g, "A"), sha256Of(bytes).slice(0, 63), `${sha256Of(bytes)}0`, "not-a-hash"]) {
      const res = await POST(uploadRequest(tokenFor(site, `sha-up5-${stamp}`), bytes, { hash }));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ status: "error", code: "invalid_request", error: "x-presby-sha256 must be a lowercase 64-character hex sha256." });
    }
  });

  it("UP-5: a missing or wrong protocol header is 422 unsupported_protocol", async () => {
    for (const headers of [{ [PROTOCOL]: null }, { [PROTOCOL]: "2" }]) {
      const res = await POST(uploadRequest(tokenFor(site, `sha-up5p-${stamp}`), img("up5p"), { headers }));
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("unsupported_protocol");
    }
  });

  it("UP-6: a body of 4,000,001 bytes is 413 request_too_large - by declared length and by counted bytes - and nothing is stored", async () => {
    const bytes = img("up6", 4_000_001);
    const before = (await rows(site.id)).length;
    const declared = await POST(uploadRequest(tokenFor(site, `sha-up6a-${stamp}`), bytes, { headers: { "content-length": "4000001" } }));
    expect(declared.status).toBe(413);
    expect((await declared.json()).code).toBe("request_too_large");
    const counted = await POST(uploadRequest(tokenFor(site, `sha-up6b-${stamp}`), bytes));
    expect(counted.status).toBe(413);
    expect((await rows(site.id)).length).toBe(before);
    // and without a token it is the 401, not the 413
    const unauth = await POST(uploadRequest(null, bytes, { headers: { "content-length": "4000001" } }));
    expect(unauth.status).toBe(401);
  });

  it("UP-7: uploading held bytes again is 200 and adds no row", async () => {
    const bytes = img("up7");
    const first = await POST(uploadRequest(tokenFor(site, `sha-up7a-${stamp}`), bytes));
    const count = (await rows(site.id)).length;
    const second = await POST(uploadRequest(tokenFor(site, `sha-up7b-${stamp}`), bytes));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "stored", sha256: sha256Of(bytes) });
    expect((await rows(site.id)).length).toBe(count);
  });

  describe("UP-8 - the declared content-type is ignored", () => {
    it("text/plain with PNG bytes stores a PNG", async () => {
      const bytes = img("up8a");
      const res = await POST(uploadRequest(tokenFor(site, `sha-up8a-${stamp}`), bytes, { headers: { "content-type": "text/plain" } }));
      expect(res.status).toBe(200);
      expect((await res.json()).contentType).toBe("image/png");
    });

    it("image/png with GIF bytes is refused", async () => {
      const gif = Buffer.from("GIF89a-synthetic");
      const res = await POST(uploadRequest(tokenFor(site, `sha-up8b-${stamp}`), gif, { headers: { "content-type": "image/png" } }));
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("not_an_image");
    });
  });

  it("UP-9: the answer has no uuid, and an upload writes no audit row and leaves organization_sites alone", async () => {
    const [siteBefore] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
    const auditBefore = await getPlatformDb()
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.resourceId, site.id), eq(auditEvents.action, "site.content_ingested")));

    const res = await POST(uploadRequest(tokenFor(site, `sha-up9-${stamp}`), img("up9")));
    expect(UUID_RE.test(await res.text())).toBe(false);

    const [siteAfter] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
    expect(siteAfter).toEqual(siteBefore);
    const auditAfter = await getPlatformDb()
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.resourceId, site.id), eq(auditEvents.action, "site.content_ingested")));
    expect(auditAfter).toHaveLength(auditBefore.length);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("UP-10: two concurrent uploads of identical bytes are both 200 and make one row", async () => {
    const bytes = img("up10");
    const [a, b] = await Promise.all([
      POST(uploadRequest(tokenFor(site, `sha-up10a-${stamp}`), bytes)),
      POST(uploadRequest(tokenFor(site, `sha-up10b-${stamp}`), bytes)),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await rows(site.id)).filter((r) => r.hash === sha256Of(bytes))).toHaveLength(1);
  });
});
