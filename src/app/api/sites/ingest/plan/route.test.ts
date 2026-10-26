/**
 * PL-1..PL-11 - `POST /api/sites/ingest/plan`, against real Postgres and real
 * OIDC verification (site-ingest-size, DECISION-279;
 * docs/work-log/2026-10-26-site-ingest-size.md, Phase 3 "Test plan"). Needs
 * drizzle/0072 applied. The shared signer, JWKS stub and fixture orgs are
 * src/lib/testing/site-ingest-harness.ts.
 *
 * Run: npx dotenv -e .env.local -- vitest run --no-file-parallelism src/app/api/sites/ingest/plan/route.test.ts
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
  setSitesPublicRender,
  sha256Of,
  syntheticImage,
  type IngestFixtures,
  type TokenSigner,
} from "@/lib/testing/site-ingest-harness";

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const AUDIENCE = "https://presby.example.invalid/sites-ingest-plan-test";
const SITES_ORG = "presby-ingest-plan-test-org";
const stamp = Date.now();
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe.skipIf(!hasDb)("POST /api/sites/ingest/plan (real Postgres + real OIDC verification)", () => {
  let POST: typeof import("./route").POST;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizationSites: typeof import("@/lib/db/domain/sites").organizationSites;
  let blobAssets: typeof import("@/lib/db/domain/assets").blobAssets;
  let getBlobStore: typeof import("@/lib/storage/blob-store").getBlobStore;
  let resetJwks: () => void;

  let signer: TokenSigner;
  let fixtures: IngestFixtures;
  let restoreFlag: () => Promise<void>;
  let site: { id: string; slug: string; repo: string };
  let otherSite: { id: string; slug: string; repo: string };
  let current: { id: string; slug: string; repo: string };

  const PROTOCOL = { "x-presby-ingest-protocol": "1" };

  function planRequest(token: string | null, body: unknown, headers: Record<string, string> = PROTOCOL): Request {
    const h = new Headers({ "content-type": "application/json", ...headers });
    if (token !== null) h.set("authorization", `Bearer ${token}`);
    return new Request("http://presby.example.invalid/api/sites/ingest/plan", {
      method: "POST",
      headers: h,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  const tokenFor = (s: { repo: string }, sha: string) => signer.signToken({ repository: s.repo, sha });
  const img = (seed: string, size = 64) => syntheticImage("png", size, `plan ${stamp} ${seed}`);

  async function blobCount(orgId: string): Promise<number> {
    return (await getPlatformDb().select({ id: blobAssets.id }).from(blobAssets).where(eq(blobAssets.organizationId, orgId))).length;
  }

  beforeAll(async () => {
    ({ POST } = await import("./route"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizationSites } = await import("@/lib/db/domain/sites"));
    ({ blobAssets } = await import("@/lib/db/domain/assets"));
    ({ getBlobStore } = await import("@/lib/storage/blob-store"));
    const auth = await import("@/lib/sites-ingest-auth");
    resetJwks = auth._resetJwksCacheForTests;

    signer = createTokenSigner({
      audience: AUDIENCE,
      sitesOrg: SITES_ORG,
      kid: "ingest-plan-test-key-1",
      defaultRepo: `${SITES_ORG}/unused`,
      defaultSha: `sha-default-${stamp}`,
    });
    restoreFlag = await enableSitesPublicRender();
    fixtures = await createIngestFixtures("sites-ingest-plan-test", stamp);
    site = await fixtures.makeSite("main", `${SITES_ORG}/site-plan-main-${stamp}`);
    otherSite = await fixtures.makeSite("other", `${SITES_ORG}/site-plan-other-${stamp}`);
    current = await fixtures.makeSite("current", `${SITES_ORG}/site-plan-current-${stamp}`);
    // `current` has already ingested a commit
    await getPlatformDb()
      .update(organizationSites)
      .set({ lastIngestedCommitSha: `sha-already-${stamp}` })
      .where(eq(organizationSites.organizationId, current.id));
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

  describe("PL-1 - the gate", () => {
    it("401: no token, and a token for a different audience", async () => {
      const none = await POST(planRequest(null, { images: [] }));
      expect(none.status).toBe(401);
      expect((await none.json()).code).toBe("unauthorized");
      const wrong = await POST(planRequest(signer.signToken({ aud: "https://elsewhere.example.invalid" }), { images: [] }));
      expect(wrong.status).toBe(401);
    });

    it("503 ingest_disabled when sites.public_render is off", async () => {
      await setSitesPublicRender(false);
      try {
        const res = await POST(planRequest(tokenFor(site, `sha-pl1-503-${stamp}`), { images: [] }));
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ status: "error", code: "ingest_disabled", error: "Site ingest is currently disabled." });
      } finally {
        await setSitesPublicRender(true);
      }
    });

    it("404 site_not_provisioned, in the JSON error format (the client tells it from a platform without staged routes)", async () => {
      const res = await POST(planRequest(signer.signToken({ repository: `${SITES_ORG}/never-${stamp}`, sha: `sha-pl1-404-${stamp}` }), { images: [] }));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(await res.json()).toEqual({ status: "error", code: "site_not_provisioned", error: "No site is provisioned for this repository." });
    });

    it("200 already_current when the verified sha is the last ingested one - before the body is read", async () => {
      const res = await POST(planRequest(tokenFor(current, `sha-already-${stamp}`), "this is not json", {}));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "already_current", organizationSlug: current.slug, commitSha: `sha-already-${stamp}` });
    });
  });

  it("PL-2: an organization that holds nothing reports every hash missing, in request order", async () => {
    const hashes = [sha256Of(img("a")), sha256Of(img("b")), sha256Of(img("c"))];
    const res = await POST(planRequest(tokenFor(site, `sha-pl2-${stamp}`), { images: hashes.map((sha256) => ({ sha256, size: 64 })) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "planned", missing: hashes });
  });

  it("PL-3: only the hashes this organization does not already hold as public_site are missing", async () => {
    const held = img("pl3-held");
    await getBlobStore().store({ organizationId: site.id, bytes: held, contentType: "image/png", audience: "public_site" });
    const wanted = [sha256Of(img("pl3-x")), sha256Of(held), sha256Of(img("pl3-y"))];
    const res = await POST(planRequest(tokenFor(site, `sha-pl3-${stamp}`), { images: wanted.map((sha256) => ({ sha256, size: 64 })) }));
    expect(await res.json()).toEqual({ status: "planned", missing: [wanted[0], wanted[2]] });
  });

  it("PL-4: a hash held only as private is missing", async () => {
    const privateOnly = img("pl4");
    await getBlobStore().store({ organizationId: site.id, bytes: privateOnly, contentType: "image/png", audience: "private" });
    const res = await POST(planRequest(tokenFor(site, `sha-pl4-${stamp}`), { images: [{ sha256: sha256Of(privateOnly), size: 64 }] }));
    expect(await res.json()).toEqual({ status: "planned", missing: [sha256Of(privateOnly)] });
  });

  it("PL-5: identical bytes held as public_site by ANOTHER organization are missing", async () => {
    const theirs = img("pl5");
    await getBlobStore().store({ organizationId: otherSite.id, bytes: theirs, contentType: "image/png", audience: "public_site" });
    const res = await POST(planRequest(tokenFor(site, `sha-pl5-${stamp}`), { images: [{ sha256: sha256Of(theirs), size: 64 }] }));
    expect(await res.json()).toEqual({ status: "planned", missing: [sha256Of(theirs)] });
  });

  it("PL-6: an empty images list plans with nothing missing", async () => {
    const res = await POST(planRequest(tokenFor(site, `sha-pl6-${stamp}`), { images: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "planned", missing: [] });
  });

  describe("PL-7 - 422 invalid_request", () => {
    const ok = (n: number) => ({ sha256: n.toString(16).padStart(64, "0"), size: 5 });
    it.each([
      ["a bad hash", { images: [{ sha256: "XYZ", size: 5 }] }, "images[0] needs a lowercase 64-character sha256 and a size from 1 to 4000000."],
      ["an uppercase hash", { images: [{ sha256: "A".repeat(64), size: 5 }] }, "images[0] needs a lowercase 64-character sha256 and a size from 1 to 4000000."],
      ["size 0", { images: [{ ...ok(1), size: 0 }] }, "images[0] needs a lowercase 64-character sha256 and a size from 1 to 4000000."],
      ["size 4,000,001", { images: [{ ...ok(1), size: 4_000_001 }] }, "images[0] needs a lowercase 64-character sha256 and a size from 1 to 4000000."],
      ["a repeated hash", { images: [ok(1), ok(2), ok(1)] }, "images[2] repeats an earlier sha256."],
      ["images not an array", { images: "x" }, "images must be an array of at most 2000 entries."],
      ["no images key", {}, "images must be an array of at most 2000 entries."],
      ["2,001 entries", { images: Array.from({ length: 2001 }, (_, i) => ok(i + 1)) }, "images must be an array of at most 2000 entries."],
    ])("%s", async (_name, body, message) => {
      const res = await POST(planRequest(tokenFor(site, `sha-pl7-${stamp}`), body));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ status: "error", code: "invalid_request", error: message });
    });

    it("2,000 entries are accepted", async () => {
      const res = await POST(planRequest(tokenFor(site, `sha-pl7b-${stamp}`), { images: Array.from({ length: 2000 }, (_, i) => ok(i + 1)) }));
      expect(res.status).toBe(200);
      expect((await res.json()).missing).toHaveLength(2000);
    });

    it("a body that is not JSON is 422 invalid_json", async () => {
      const res = await POST(planRequest(tokenFor(site, `sha-pl7c-${stamp}`), "{nope"));
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("invalid_json");
    });
  });

  it("PL-8: a missing or wrong protocol header is 422 unsupported_protocol", async () => {
    for (const headers of [{}, { "x-presby-ingest-protocol": "2" }] as Array<Record<string, string>>) {
      const res = await POST(planRequest(tokenFor(site, `sha-pl8-${stamp}`), { images: [] }, headers));
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("unsupported_protocol");
    }
  });

  it("PL-9: a plan writes nothing - no blob row, and organization_sites is untouched", async () => {
    const before = await blobCount(site.id);
    const [siteBefore] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
    await POST(planRequest(tokenFor(site, `sha-pl9-${stamp}`), { images: [{ sha256: sha256Of(img("pl9")), size: 64 }] }));
    expect(await blobCount(site.id)).toBe(before);
    const [siteAfter] = await getPlatformDb().select().from(organizationSites).where(eq(organizationSites.organizationId, site.id));
    expect(siteAfter).toEqual(siteBefore);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("PL-10: the answer contains no uuid-shaped string, even when images are held", async () => {
    const held = img("pl10");
    await getBlobStore().store({ organizationId: site.id, bytes: held, contentType: "image/png", audience: "public_site" });
    const res = await POST(planRequest(tokenFor(site, `sha-pl10-${stamp}`), { images: [{ sha256: sha256Of(held), size: 64 }, { sha256: sha256Of(img("pl10b")), size: 64 }] }));
    expect(UUID_RE.test(await res.text())).toBe(false);
  });

  it("PL-11: an oversize body is 413 request_too_large (authenticated callers only)", async () => {
    const big = JSON.stringify({ images: [], pad: "a".repeat(4_000_001) });
    const res = await POST(planRequest(tokenFor(site, `sha-pl11-${stamp}`), big));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("request_too_large");
    const unauth = await POST(planRequest(null, big, { ...PROTOCOL, "content-length": String(Buffer.byteLength(big)) }));
    expect(unauth.status).toBe(401);
  });
});
