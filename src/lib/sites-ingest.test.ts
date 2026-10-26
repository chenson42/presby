/**
 * SI-1..SI-13 - `src/lib/sites-ingest.ts`, the one gate / validator / store /
 * publish module behind the four ingest routes (site-ingest-size, DECISION-279;
 * docs/work-log/2026-10-26-site-ingest-size.md, Phase 3 "Test plan").
 *
 * No database: the OIDC verifier, the flag, the site primitives, the audit
 * writer, `next/cache` and the blob adapter are mocked. What this pins is the
 * logic that lives in the module: the bounded body read, the order of the
 * gate, the validators and their literals, the store/publish choreography, and
 * the closed error vocabulary. The database-backed behavior (real rows, real
 * tokens) is each route's own `route.test.ts` and `staged-flow.test.ts`.
 *
 * The wire-literal half of the cross-repository contract is SI-4/SI-9: the
 * same literals are asserted in presby-site-kit's `KI-1`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

const calls: string[] = [];

const verify = vi.fn();
vi.mock("@/lib/sites-ingest-auth", () => ({ verifyGithubActionsOidcToken: (...a: unknown[]) => verify(...a) }));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({ isFlagEnabled: (...a: unknown[]) => isFlagEnabled(...a) }));

const resolveOrganizationByRepo = vi.fn();
const recordSiteIngest = vi.fn();
vi.mock("@/lib/sites", () => ({
  resolveOrganizationByRepo: (...a: unknown[]) => resolveOrganizationByRepo(...a),
  recordSiteIngest: (...a: unknown[]) => recordSiteIngest(...a),
}));

const recordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { SITE_CONTENT_INGESTED: "site.content_ingested" },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const store = vi.fn();
const findByContentHashes = vi.fn();
vi.mock("@/lib/storage/blob-store", () => {
  class BlobValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "BlobValidationError";
    }
  }
  return { getBlobStore: () => ({ store, findByContentHashes }), BlobValidationError };
});

import {
  MAX_REQUEST_BYTES,
  MAX_MANIFEST_ENTRIES,
  MAX_IMAGE_BYTES,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  SHA256_HEADER,
  INGEST_ERROR_CODES,
  errorResponse,
  readBoundedBody,
  validateManifestKey,
  validateSha256,
  validatePlanImages,
  validateCommitBody,
  validatePages,
  storeSiteImage,
  findHeldSiteImages,
  publishSiteBundle,
} from "./sites-ingest";
import { POST as legacyPOST } from "@/app/api/sites/ingest/route";
import { POST as planPOST } from "@/app/api/sites/ingest/plan/route";
import { POST as imagesPOST } from "@/app/api/sites/ingest/images/route";
import { POST as commitPOST } from "@/app/api/sites/ingest/commit/route";
import { BlobValidationError } from "@/lib/storage/blob-store";

const ORG = { organizationId: "11111111-1111-4111-8111-111111111111", slug: "fixture-slug", lastIngestedCommitSha: null as string | null };
const CLAIMS = { repository: "fixture-owner/site-fixture", sha: "a".repeat(40) };
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("synthetic")]);
const H = (n: number) => n.toString(16).padStart(64, "0");

function arrangeGate(over: { lastIngestedCommitSha?: string | null } = {}) {
  verify.mockResolvedValue({ ok: true, claims: CLAIMS });
  isFlagEnabled.mockResolvedValue(true);
  resolveOrganizationByRepo.mockResolvedValue({ ...ORG, ...over });
}

function post(headers: Record<string, string> = {}, body: BodyInit | null = "{}"): Request {
  return new Request("http://presby.example.invalid/api/sites/ingest", {
    method: "POST",
    headers: { authorization: "Bearer t", ...headers },
    body,
  });
}

beforeEach(() => {
  calls.length = 0;
  for (const m of [verify, isFlagEnabled, resolveOrganizationByRepo, recordSiteIngest, recordAudit, revalidatePath, store, findByContentHashes]) {
    m.mockReset();
  }
});

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------

describe("SI-4 - the wire constants (the same literals are asserted in presby-site-kit KI-1)", () => {
  it("pins every literal of the wire contract", () => {
    expect(MAX_REQUEST_BYTES).toBe(4_000_000);
    expect(MAX_MANIFEST_ENTRIES).toBe(2000);
    expect(MAX_IMAGE_BYTES).toBe(4_000_000);
    expect(PROTOCOL_HEADER).toBe("x-presby-ingest-protocol");
    expect(PROTOCOL_VERSION).toBe("1");
    expect(SHA256_HEADER).toBe("x-presby-sha256");
  });
});

describe("SI-1 / SI-2 - readBoundedBody", () => {
  function streamOf(chunkSizes: number[], onCancel?: () => void) {
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= chunkSizes.length) return controller.close();
        controller.enqueue(new Uint8Array(chunkSizes[i++]!).fill(7));
      },
      cancel() {
        onCancel?.();
      },
    });
  }

  it("SI-1: a declared Content-Length of 4,000,001 is refused 413 without pulling the stream", async () => {
    const getReader = vi.fn();
    const req = { headers: new Headers({ "content-length": "4000001" }), body: { getReader } } as unknown as Request;
    const out = await readBoundedBody(req);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.response.status).toBe(413);
    expect(await out.response.json()).toEqual({
      status: "error",
      code: "request_too_large",
      error: "Request body is larger than 4,000,000 bytes.",
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  it("SI-2: with no declared length, a stream of 4,000,001 bytes is refused 413 and the reader is cancelled", async () => {
    let cancelled = false;
    const req = { headers: new Headers(), body: streamOf([2_000_000, 2_000_000, 1], () => (cancelled = true)) } as unknown as Request;
    const out = await readBoundedBody(req);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("SI-2: a lying (small) Content-Length does not defeat the counted limit", async () => {
    const req = { headers: new Headers({ "content-length": "10" }), body: streamOf([4_000_001]) } as unknown as Request;
    const out = await readBoundedBody(req);
    expect(out.ok).toBe(false);
  });

  it("SI-2: exactly 4,000,000 bytes is returned whole", async () => {
    const req = { headers: new Headers({ "content-length": "4000000" }), body: streamOf([1_000_000, 1_000_000, 2_000_000]) } as unknown as Request;
    const out = await readBoundedBody(req);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.bytes.byteLength).toBe(4_000_000);
  });

  it("SI-2: a request with no body is an empty buffer, not an error", async () => {
    const out = await readBoundedBody({ headers: new Headers(), body: null } as unknown as Request);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.bytes.byteLength).toBe(0);
  });

  it("a non-numeric Content-Length is ignored (the counted limit still applies)", async () => {
    const req = { headers: new Headers({ "content-length": "lots" }), body: streamOf([5]) } as unknown as Request;
    const out = await readBoundedBody(req);
    expect(out.ok).toBe(true);
  });
});

describe("SI-3 - the same gate, in the same order, on all four handlers", () => {
  const HANDLERS: Array<[string, (r: Request) => Promise<Response>]> = [
    ["legacy", legacyPOST],
    ["plan", planPOST],
    ["images", imagesPOST],
    ["commit", commitPOST],
  ];

  it.each(HANDLERS)("%s: 401 first - nothing else is consulted, the body is untouched, the error carries a code", async (_n, handler) => {
    verify.mockResolvedValue({ ok: false, status: 401, error: "Missing or malformed Authorization header." });
    const req = post();
    const res = await handler(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ status: "error", code: "unauthorized", error: "Missing or malformed Authorization header." });
    expect(isFlagEnabled).not.toHaveBeenCalled();
    expect(resolveOrganizationByRepo).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
  });

  it.each(HANDLERS)("%s: 503 when sites.public_render is off - before the repository lookup, body untouched", async (_n, handler) => {
    verify.mockResolvedValue({ ok: true, claims: CLAIMS });
    isFlagEnabled.mockResolvedValue(false);
    const req = post();
    const res = await handler(req);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", code: "ingest_disabled", error: "Site ingest is currently disabled." });
    expect(isFlagEnabled).toHaveBeenCalledWith("sites.public_render");
    expect(resolveOrganizationByRepo).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
  });

  it.each(HANDLERS)("%s: 404 when the verified repository has no site - JSON error, body untouched", async (_n, handler) => {
    verify.mockResolvedValue({ ok: true, claims: CLAIMS });
    isFlagEnabled.mockResolvedValue(true);
    resolveOrganizationByRepo.mockResolvedValue(null);
    const req = post();
    const res = await handler(req);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ status: "error", code: "site_not_provisioned", error: "No site is provisioned for this repository." });
    expect(resolveOrganizationByRepo).toHaveBeenCalledWith(CLAIMS.repository);
    expect(req.bodyUsed).toBe(false);
  });

  it.each(HANDLERS)("%s: 200 already_current when the verified sha is already ingested - nothing written, body untouched", async (_n, handler) => {
    arrangeGate({ lastIngestedCommitSha: CLAIMS.sha });
    const req = post();
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "already_current", organizationSlug: ORG.slug, commitSha: CLAIMS.sha });
    expect(req.bodyUsed).toBe(false);
    expect(store).not.toHaveBeenCalled();
    expect(findByContentHashes).not.toHaveBeenCalled();
    expect(recordSiteIngest).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(HANDLERS)("%s: the organization and sha come from the verified claims, never the body", async (_n, handler) => {
    arrangeGate();
    await handler(post({ [PROTOCOL_HEADER]: "1", [SHA256_HEADER]: H(1) }, JSON.stringify({ organizationId: "evil", repository: "evil/evil", sha: "evil" })));
    expect(resolveOrganizationByRepo).toHaveBeenCalledWith(CLAIMS.repository);
  });
});

describe("SI-4 - validators", () => {
  it("validateSha256: exactly 64 lowercase hex characters", () => {
    expect(validateSha256(H(1))).toBe(true);
    for (const bad of [H(1).toUpperCase().replace(/0/g, "A"), "ab".repeat(31), "ab".repeat(33), "g".repeat(64), `${H(1)}\n`, "", 5, null, undefined]) {
      expect(validateSha256(bad)).toBe(false);
    }
  });

  it("validateManifestKey: 1 to 200 UTF-16 units, no control characters (U+0000-U+001F, U+007F)", () => {
    for (const ok of ["a", "a".repeat(200), "hero image.v2", "Kéy ✝ 教会", "__proto__", "a.b.c", ".", " "]) {
      expect(validateManifestKey(ok), JSON.stringify(ok)).toBe(true);
    }
    for (const bad of ["", "a".repeat(201), "a\u0000b", "a\tb", "a\nb", "a\u001fb", "a\u007fb", 5, null, undefined, {}]) {
      expect(validateManifestKey(bad), JSON.stringify(bad)).toBe(false);
    }
    // 100 astral characters are 200 UTF-16 code units; 101 are 202
    expect(validateManifestKey("\u{1F600}".repeat(100))).toBe(true);
    expect(validateManifestKey("\u{1F600}".repeat(101))).toBe(false);
  });

  describe("validatePlanImages", () => {
    const entry = (n: number, size = 10) => ({ sha256: H(n), size });

    it("accepts an empty list and returns the entries", () => {
      expect(validatePlanImages({ images: [] })).toEqual({ ok: true, images: [] });
      expect(validatePlanImages({ images: [entry(1), entry(2, 4_000_000)] })).toEqual({ ok: true, images: [entry(1), entry(2, 4_000_000)] });
    });

    it("size: 0 refused, 1 and 4,000,000 accepted, 4,000,001 refused, non-integers refused", () => {
      expect(validatePlanImages({ images: [entry(1, 0)] }).ok).toBe(false);
      expect(validatePlanImages({ images: [entry(1, 1)] }).ok).toBe(true);
      expect(validatePlanImages({ images: [entry(1, 4_000_000)] }).ok).toBe(true);
      expect(validatePlanImages({ images: [entry(1, 4_000_001)] }).ok).toBe(false);
      expect(validatePlanImages({ images: [{ sha256: H(1), size: 1.5 }] }).ok).toBe(false);
      expect(validatePlanImages({ images: [{ sha256: H(1), size: "10" }] }).ok).toBe(false);
    });

    it("refuses a bad hash, a repeated hash, a non-array and a non-object, with the Copy texts", () => {
      expect(validatePlanImages({ images: [{ sha256: "XYZ", size: 3 }] })).toEqual({
        ok: false,
        error: "images[0] needs a lowercase 64-character sha256 and a size from 1 to 4000000.",
      });
      expect(validatePlanImages({ images: [entry(1), entry(2), entry(1)] })).toEqual({
        ok: false,
        error: "images[2] repeats an earlier sha256.",
      });
      const notArray = { ok: false, error: "images must be an array of at most 2000 entries." };
      expect(validatePlanImages({ images: "x" })).toEqual(notArray);
      expect(validatePlanImages({})).toEqual(notArray);
      expect(validatePlanImages(null)).toEqual({ ok: false, error: "Malformed request body." });
      expect(validatePlanImages({ images: [null] }).ok).toBe(false);
    });

    it("2,000 entries are accepted and 2,001 are refused", () => {
      const make = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1));
      expect(validatePlanImages({ images: make(2000) }).ok).toBe(true);
      expect(validatePlanImages({ images: make(2001) })).toEqual({ ok: false, error: "images must be an array of at most 2000 entries." });
    });
  });

  describe("validateCommitBody", () => {
    const page = { path: "/", frontMatter: { title: "Home" }, mdxAst: { type: "root", children: [] } };
    const img = (key: string, n: number) => ({ manifestKey: key, sha256: H(n) });
    const body = (over: Record<string, unknown> = {}) => ({ schemaVersion: 1, pages: [page], images: [], ...over });

    it("accepts empty images; two keys may share a hash; keys with spaces, unicode and __proto__ survive", () => {
      expect(validateCommitBody(body()).ok).toBe(true);
      const out = validateCommitBody(body({ images: [img("a", 1), img("b", 1), img("my photo é", 2), img("__proto__", 3)] }));
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.images.map((i) => i.manifestKey)).toEqual(["a", "b", "my photo é", "__proto__"]);
      expect(out.pages).toEqual([page]);
    });

    it("refuses a duplicate manifestKey, a bad key, a bad hash, and more than 2,000 entries", () => {
      expect(validateCommitBody(body({ images: [img("a", 1), img("a", 2)] }))).toEqual({
        ok: false,
        code: "invalid_request",
        error: 'images[1] repeats the manifestKey "a".',
      });
      const badEntry = "images[0] needs a manifestKey of 1 to 200 characters with no control characters, and a lowercase 64-character sha256.";
      expect(validateCommitBody(body({ images: [img("", 1)] }))).toMatchObject({ ok: false, error: badEntry });
      expect(validateCommitBody(body({ images: [img("a\u0000", 1)] }))).toMatchObject({ ok: false, error: badEntry });
      expect(validateCommitBody(body({ images: [{ manifestKey: "a", sha256: "NOPE" }] }))).toMatchObject({ ok: false, error: badEntry });
      const many = (n: number) => Array.from({ length: n }, (_, i) => img(`k${i}`, i + 1));
      expect(validateCommitBody(body({ images: many(2000) })).ok).toBe(true);
      expect(validateCommitBody(body({ images: many(2001) }))).toMatchObject({ ok: false, error: "images must be an array of at most 2000 entries." });
    });

    it("refuses empty pages, a bad schemaVersion and a non-object body", () => {
      expect(validateCommitBody(body({ pages: [] }))).toMatchObject({ ok: false, code: "invalid_request", error: "pages must be a non-empty array." });
      expect(validateCommitBody(body({ pages: [{ path: "/" }] }))).toMatchObject({ ok: false, error: "Malformed entry in pages." });
      expect(validateCommitBody(body({ schemaVersion: 2 }))).toMatchObject({ ok: false, code: "invalid_request" });
      expect(validateCommitBody(null)).toMatchObject({ ok: false, code: "invalid_request" });
    });

    it("a reserved page path is refused with the reserved_page code", () => {
      expect(validateCommitBody(body({ pages: [page, { ...page, path: "/give" }] }))).toMatchObject({ ok: false, code: "reserved_page" });
    });
  });
});

describe("SI-5 - validatePages keeps today's messages", () => {
  const page = (path: string) => ({ path, frontMatter: {}, mdxAst: {} });

  it("the reserved texts equal the legacy route's, character for character", () => {
    expect(validatePages([page("/give")], "bundle.pages")).toEqual({
      ok: false,
      code: "reserved_page",
      error: 'Page "/give" is reserved: PresbyPortal serves its own /give page for online giving. Rename or remove it.',
    });
    expect(validatePages([page("/robots.txt")], "bundle.pages")).toEqual({
      ok: false,
      code: "reserved_page",
      error: 'Page "/robots.txt" is reserved: PresbyPortal serves its own /robots.txt path (on a custom domain too). Rename or remove it.',
    });
    expect(validatePages([page("/assets/hero")], "pages")).toMatchObject({
      error: 'Page "/assets/hero" is reserved: PresbyPortal serves its own /assets path (on a custom domain too). Rename or remove it.',
    });
  });

  it("the shape messages carry the caller's field name", () => {
    expect(validatePages([], "bundle.pages")).toMatchObject({ ok: false, code: "invalid_request", error: "bundle.pages must be a non-empty array." });
    expect(validatePages("x", "pages")).toMatchObject({ error: "pages must be a non-empty array." });
    expect(validatePages([{ path: "/" }], "bundle.pages")).toMatchObject({ error: "Malformed entry in bundle.pages." });
    expect(validatePages([page("")], "pages")).toMatchObject({ error: "Malformed entry in pages." });
  });

  it("a long reserved path is truncated to 120 characters in the message", () => {
    const out = validatePages([page(`/give/${"x".repeat(300)}`)], "pages");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain(`"/give/${"x".repeat(114)}"`);
  });

  it("valid pages come back as { path, frontMatter, mdxAst } only", () => {
    const out = validatePages([{ ...page("/"), extra: "dropped" }], "pages");
    expect(out).toEqual({ ok: true, pages: [page("/")] });
  });
});

describe("SI-6 - storeSiteImage", () => {
  const ref = { key: "r1", contentType: "image/png", byteSize: 1, audience: "public_site" };
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP")]);

  it.each([
    ["png", PNG, "image/png"],
    ["jpeg", JPEG, "image/jpeg"],
    ["webp", WEBP, "image/webp"],
  ])("a %s is stored as public_site with the SNIFFED type", async (_n, bytes, type) => {
    store.mockResolvedValue({ ...ref, contentType: type });
    const out = await storeSiteImage(ORG, bytes);
    expect(out).toEqual({ ok: true, ref: { ...ref, contentType: type } });
    expect(store).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith({ organizationId: ORG.organizationId, bytes, contentType: type, audience: "public_site" });
  });

  it("a PDF, garbage and an empty body are refused without a store call", async () => {
    expect(await storeSiteImage(ORG, Buffer.from("%PDF-1.7 fake"))).toEqual({ ok: false, reason: "not_an_image" });
    expect(await storeSiteImage(ORG, Buffer.from("this is not an image"))).toEqual({ ok: false, reason: "not_an_image" });
    expect(await storeSiteImage(ORG, Buffer.alloc(0))).toEqual({ ok: false, reason: "empty" });
    expect(store).not.toHaveBeenCalled();
  });

  it.each([
    ["err.code", { code: "23505" }],
    ["err.cause.code", { cause: { code: "23505" } }],
  ])("a unique violation (%s) is retried once and the second attempt's row is returned", async (_n, shape) => {
    store.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), shape)).mockResolvedValueOnce(ref);
    const out = await storeSiteImage(ORG, PNG);
    expect(out).toEqual({ ok: true, ref });
    expect(store).toHaveBeenCalledTimes(2);
  });

  it("a second failure propagates (no third attempt)", async () => {
    const dup = () => Object.assign(new Error("duplicate key"), { code: "23505" });
    store.mockRejectedValueOnce(dup()).mockRejectedValueOnce(dup());
    await expect(storeSiteImage(ORG, PNG)).rejects.toThrow("duplicate key");
    expect(store).toHaveBeenCalledTimes(2);
  });

  it("any other error is not retried", async () => {
    store.mockRejectedValueOnce(Object.assign(new Error("connection reset"), { code: "08006" }));
    await expect(storeSiteImage(ORG, PNG)).rejects.toThrow("connection reset");
    expect(store).toHaveBeenCalledTimes(1);
  });

  it("a BlobValidationError becomes a 'rejected' result carrying its message", async () => {
    store.mockRejectedValueOnce(new BlobValidationError("blob-store: 99999999 bytes is outside the allowed range"));
    expect(await storeSiteImage(ORG, PNG)).toEqual({
      ok: false,
      reason: "rejected",
      message: "blob-store: 99999999 bytes is outside the allowed range",
    });
  });
});

describe("findHeldSiteImages", () => {
  it("asks for public_site with the given hashes and returns the map", async () => {
    const held = new Map([[H(1), { key: "k1", contentType: "image/png", byteSize: 3, audience: "public_site" }]]);
    findByContentHashes.mockResolvedValue(held);
    const out = await findHeldSiteImages(ORG, [H(1), H(2)]);
    expect(findByContentHashes).toHaveBeenCalledWith({ organizationId: ORG.organizationId, audience: "public_site", contentHashes: [H(1), H(2)] });
    expect([...out.keys()]).toEqual([H(1)]);
  });

  it("short-circuits an empty list without a query", async () => {
    const out = await findHeldSiteImages(ORG, []);
    expect(out.size).toBe(0);
    expect(findByContentHashes).not.toHaveBeenCalled();
  });

  it("SI-11: a held ref whose content type is not an image is treated as not held", async () => {
    findByContentHashes.mockResolvedValue(
      new Map([
        [H(1), { key: "k1", contentType: "application/json", byteSize: 3, audience: "public_site" }],
        [H(2), { key: "k2", contentType: "image/webp", byteSize: 3, audience: "public_site" }],
        [H(3), { key: "k3", contentType: "application/pdf", byteSize: 3, audience: "public_site" }],
      ]),
    );
    const out = await findHeldSiteImages(ORG, [H(1), H(2), H(3)]);
    expect([...out.keys()]).toEqual([H(2)]);
  });
});

describe("SI-7 - publishSiteBundle", () => {
  const pages = [
    { path: "/", frontMatter: { title: "Home" }, mdxAst: {} },
    { path: "/about", frontMatter: {}, mdxAst: {} },
  ];

  function arrangePublish() {
    store.mockImplementation(async () => {
      calls.push("store");
      return { key: "bundle-key", contentType: "application/json", byteSize: 10, audience: "private" };
    });
    recordSiteIngest.mockImplementation(async () => void calls.push("recordSiteIngest"));
    recordAudit.mockImplementation(async () => void calls.push("recordAudit"));
    revalidatePath.mockImplementation(() => void calls.push("revalidatePath"));
  }

  it("stores the private bundle, then records the ingest, then audits, then revalidates - in that order", async () => {
    arrangePublish();
    const res = await publishSiteBundle({ org: ORG, claims: CLAIMS, pages, imageKeys: { hero: "uuid-1" }, imageCount: 1, transport: "staged" });
    expect(calls).toEqual(["store", "recordSiteIngest", "recordAudit", "revalidatePath", "revalidatePath", "revalidatePath"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ingested", organizationSlug: ORG.slug, commitSha: CLAIMS.sha, pageCount: 2 });
  });

  it("stores { schemaVersion: 1, pages, imageKeys } as application/json with audience private", async () => {
    arrangePublish();
    await publishSiteBundle({ org: ORG, claims: CLAIMS, pages, imageKeys: { hero: "uuid-1" }, imageCount: 1, transport: "legacy" });
    const arg = store.mock.calls[0]![0] as { organizationId: string; bytes: Buffer; contentType: string; audience: string };
    expect(arg.organizationId).toBe(ORG.organizationId);
    expect(arg.contentType).toBe("application/json");
    expect(arg.audience).toBe("private");
    expect(JSON.parse(arg.bytes.toString("utf8"))).toEqual({ schemaVersion: 1, pages, imageKeys: { hero: "uuid-1" } });
    expect(recordSiteIngest).toHaveBeenCalledWith(ORG.organizationId, { commitSha: CLAIMS.sha, contentBundleKey: "bundle-key" });
  });

  it("the audit row has exactly these metadata keys, with the transport", async () => {
    arrangePublish();
    await publishSiteBundle({ org: ORG, claims: CLAIMS, pages, imageKeys: {}, imageCount: 7, transport: "staged" });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "site.content_ingested",
      actor: null,
      resourceType: "organization",
      resourceId: ORG.organizationId,
      metadata: { repo: CLAIMS.repository, commitSha: CLAIMS.sha, pageCount: 2, imageCount: 7, transport: "staged" },
    });
  });

  it("revalidates the layout and each page path", async () => {
    arrangePublish();
    await publishSiteBundle({ org: ORG, claims: CLAIMS, pages, imageKeys: {}, imageCount: 0, transport: "legacy" });
    expect(revalidatePath.mock.calls).toEqual([
      [`/site/${ORG.slug}`, "layout"],
      [`/site/${ORG.slug}`],
      [`/site/${ORG.slug}/about`],
    ]);
  });

  it("a __proto__ manifest key is an OWN property in the stored JSON", async () => {
    arrangePublish();
    const imageKeys = Object.fromEntries([["__proto__", "uuid-p"], ["hero", "uuid-h"]]);
    await publishSiteBundle({ org: ORG, claims: CLAIMS, pages, imageKeys, imageCount: 2, transport: "staged" });
    const arg = store.mock.calls[0]![0] as { bytes: Buffer };
    const text = arg.bytes.toString("utf8");
    expect(text).toContain('"__proto__":"uuid-p"');
    const parsed = JSON.parse(text) as { imageKeys: Record<string, string> };
    expect(Object.prototype.hasOwnProperty.call(parsed.imageKeys, "__proto__")).toBe(true);
  });

  it("a BlobValidationError from the bundle store is a 422 and nothing is recorded", async () => {
    store.mockRejectedValue(new BlobValidationError("blob-store: too big"));
    const res = await publishSiteBundle({ org: ORG, claims: CLAIMS, pages, imageKeys: {}, imageCount: 0, transport: "legacy" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ status: "error", code: "invalid_request", error: "blob-store: too big" });
    expect(recordSiteIngest).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("SI-8 - the error vocabulary is closed", () => {
  it("the code set is exactly the contract's", () => {
    expect([...INGEST_ERROR_CODES].sort()).toEqual(
      [
        "unauthorized",
        "site_not_provisioned",
        "ingest_disabled",
        "request_too_large",
        "invalid_json",
        "invalid_request",
        "unsupported_protocol",
        "hash_mismatch",
        "not_an_image",
        "images_not_uploaded",
        "reserved_page",
        "image_rejected",
        "server_error",
      ].sort(),
    );
  });

  it("errorResponse emits only { status, code, error }", async () => {
    const res = errorResponse(422, "invalid_json", "Request body is not valid JSON.");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["code", "error", "status"]);
    expect(body).toEqual({ status: "error", code: "invalid_json", error: "Request body is not valid JSON." });
  });
});

describe("SI-9 - the protocol header on the three staged handlers", () => {
  const STAGED: Array<[string, (r: Request) => Promise<Response>]> = [
    ["plan", planPOST],
    ["images", imagesPOST],
    ["commit", commitPOST],
  ];

  it.each(STAGED)("%s: a missing header, '2' and '01' are 422 unsupported_protocol, with the Copy text", async (_n, handler) => {
    const variants: Array<Record<string, string>> = [{}, { [PROTOCOL_HEADER]: "2" }, { [PROTOCOL_HEADER]: "01" }, { [PROTOCOL_HEADER]: "" }];
    for (const headers of variants) {
      arrangeGate();
      const res = await handler(post(headers, "{}"));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        status: "error",
        code: "unsupported_protocol",
        error: "Unsupported ingest protocol. Send the header x-presby-ingest-protocol: 1.",
      });
    }
    expect(store).not.toHaveBeenCalled();
    expect(findByContentHashes).not.toHaveBeenCalled();
  });

  it("the legacy handler does not require the header", async () => {
    arrangeGate();
    const res = await legacyPOST(post({}, "{}"));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("invalid_request"); // a missing bundle, not a protocol error
  });
});

describe("SI-10 - an uncaught throw is a JSON 500 that leaks nothing", () => {
  it.each([
    ["legacy", legacyPOST],
    ["plan", planPOST],
    ["images", imagesPOST],
    ["commit", commitPOST],
  ] as Array<[string, (r: Request) => Promise<Response>]>)("%s", async (_n, handler) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    verify.mockResolvedValue({ ok: true, claims: CLAIMS });
    isFlagEnabled.mockResolvedValue(true);
    resolveOrganizationByRepo.mockRejectedValue(new Error("password=hunter2 secret-body-content"));
    const res = await handler(post({ [PROTOCOL_HEADER]: "1" }, "{}"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ status: "error", code: "server_error", error: "The platform hit an unexpected error. Try again." });
    expect(JSON.stringify(body)).not.toMatch(/hunter2|secret-body|stack| at /);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/hunter2|secret-body-content/);
  });
});

describe("SI-12 / SI-13 - what the route files do not do (source scans)", () => {
  const ROOT = join(process.cwd(), "src/app/api/sites/ingest");
  const FILES = {
    legacy: "route.ts",
    plan: "plan/route.ts",
    images: "images/route.ts",
    commit: "commit/route.ts",
  };
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

  it.each(Object.entries(FILES))("SI-12: %s exports no maxDuration or runtime", (_n, f) => {
    expect(read(f)).not.toMatch(/export\s+(const|let|var|function)\s+(maxDuration|runtime|dynamic|preferredRegion)\b/);
  });

  it.each(Object.entries(FILES))("SI-13: %s never touches the blob adapter - every audience literal lives in sites-ingest.ts", (_n, f) => {
    const src = read(f);
    expect(src).not.toMatch(/getBlobStore/);
    expect(src).not.toMatch(/storage\/blob-store/);
  });

  it("SI-13: sites-ingest.ts holds exactly the three store calls, in the order the audience table lists them", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/sites-ingest.ts"), "utf8");
    const found = [...src.matchAll(/getBlobStore\(\)\s*\.\s*(store|findByContentHashes)\(\{[^}]*?audience:\s*"(public_site|private)"/gs)].map((m) => `${m[1]}:${m[2]}`);
    expect(found).toEqual(["store:public_site", "findByContentHashes:public_site", "store:private"]);
  });
});
