import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isFlagEnabled } from "@/lib/flags";
import { verifyGithubActionsOidcToken, type VerifiedOidcClaims } from "@/lib/sites-ingest-auth";
import {
  resolveOrganizationByRepo,
  recordSiteIngest,
  type PublishedSiteBundlePage,
} from "@/lib/sites";
import { getBlobStore, BlobValidationError, type BlobRef } from "@/lib/storage/blob-store";
import { sniffTicketAttachmentContentType } from "@/lib/storage/sniff";
import { reservedSitePath } from "@/lib/sites-reserved-paths";
import { slugSitePath } from "@/lib/site-urls";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

/**
 * The one gate, validator, store and publish module behind the four site-ingest
 * routes (site-ingest-size, DECISION-279; docs/work-log/2026-10-26-site-ingest-size.md):
 *
 *   POST /api/sites/ingest           the legacy single request (a whole bundle, base64 images)
 *   POST /api/sites/ingest/plan      which image hashes does the platform still need?
 *   POST /api/sites/ingest/images    the raw bytes of ONE image, hash-verified
 *   POST /api/sites/ingest/commit    the pages plus { manifestKey, sha256 } per image
 *
 * All four go through `authorizeIngest()` (OIDC, then `sites.public_render`,
 * then the repository's site, then the `already_current` short-circuit, in
 * that order) and the two ways of publishing share `publishSiteBundle()`, so
 * they cannot drift apart. The routes themselves call no blob adapter method:
 * every `audience` literal lives in this file (F289, DECISION-277), in the order
 * `audience-callsites.test.ts` lists them - `storeSiteImage`,
 * `findHeldSiteImages`, `publishSiteBundle`. Keep that source order.
 *
 * THE WIRE CONTRACT is pinned here and, with the same literals, in
 * presby-site-kit's `scripts/ingest.mjs` (test KI-1); the work-log's Phase 3
 * "API Contract" is the specification. One request body is never more than
 * `MAX_REQUEST_BYTES` (about 11% under Vercel's 4.5 MB cap, which answers a
 * plain-text 413 before any route code runs), and the app enforces the number
 * itself so a local server behaves like production.
 *
 * TRUST. The organization and the commit sha come only from the verified OIDC
 * claims, never from a body. The client never sends or receives a blob uuid:
 * `commit` builds `imageKeys` itself from sha256 digests the platform holds as
 * `public_site` images in the caller's organization.
 */

// ---------------------------------------------------------------------------
// The wire constants
// ---------------------------------------------------------------------------

/** Per request BODY, all four routes. Exactly this many bytes is accepted; one more is refused. */
export const MAX_REQUEST_BYTES = 4_000_000;
/** The most `images` entries in a plan, a commit and a legacy bundle. */
export const MAX_MANIFEST_ENTRIES = 2000;
/** An image is one request body, so this equals `MAX_REQUEST_BYTES`. */
export const MAX_IMAGE_BYTES = 4_000_000;
export const PROTOCOL_HEADER = "x-presby-ingest-protocol";
export const PROTOCOL_VERSION = "1";
export const SHA256_HEADER = "x-presby-sha256";

const MAX_MANIFEST_KEY_UNITS = 200;
const MAX_NAMED_KEYS = 20;
const SHA256_RE = /^[0-9a-f]{64}$/;
// U+0000-U+001F and U+007F
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const PUBLIC_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** The closed set of `code` values an ingest error body may carry. */
export const INGEST_ERROR_CODES = [
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
] as const;
export type IngestErrorCode = (typeof INGEST_ERROR_CODES)[number];

export type IngestTransport = "legacy" | "staged";

/** `{ status: "error", code, error }` - the one shape of every non-2xx ingest answer. */
export function errorResponse(status: number, code: IngestErrorCode, error: string): NextResponse {
  return NextResponse.json({ status: "error", code, error }, { status });
}

/**
 * Wraps a route handler so an uncaught throw is a JSON 500, not Next's HTML
 * page, and a log line that carries NO request content: Drizzle's error text
 * quotes the failing statement and its bound values (image bytes included), so
 * only the error's name and Postgres code are logged.
 */
export function handleIngest(
  fn: (req: Request) => Promise<NextResponse>,
): (req: Request) => Promise<NextResponse> {
  return async (req) => {
    try {
      return await fn(req);
    } catch (err) {
      const e = err as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
      console.error("site-ingest: unhandled error", {
        name: typeof e?.name === "string" ? e.name : typeof err,
        code: typeof (e?.code ?? e?.cause?.code) === "string" ? (e?.code ?? e?.cause?.code) : undefined,
      });
      return errorResponse(500, "server_error", "The platform hit an unexpected error. Try again.");
    }
  };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface IngestOrg {
  organizationId: string;
  slug: string;
  lastIngestedCommitSha: string | null;
}

export type IngestGate =
  | { ok: true; org: IngestOrg; claims: VerifiedOidcClaims }
  /** Stop: `response` is the 401, 503, 404 or the 200 `already_current` answer. */
  | { ok: false; response: NextResponse };

/**
 * Every request passes through here, in this order, before its body is read:
 * the OIDC token (401), `sites.public_render` (503: a disabled feature rejects
 * ingest too, not just the read path), the organization the VERIFIED repository
 * resolves to (404: safe to be specific, the caller is GitHub's own trusted CI),
 * and the idempotency short-circuit (a repeat commit sha answers
 * `already_current` and writes nothing, on any route - the sha is written last,
 * so a re-run of a half-finished publish is always safe).
 */
export async function authorizeIngest(req: Request): Promise<IngestGate> {
  const verified = await verifyGithubActionsOidcToken(req.headers.get("authorization"));
  if (!verified.ok) {
    return { ok: false, response: errorResponse(verified.status, "unauthorized", verified.error) };
  }

  if (!(await isFlagEnabled("sites.public_render"))) {
    return { ok: false, response: errorResponse(503, "ingest_disabled", "Site ingest is currently disabled.") };
  }

  const org = await resolveOrganizationByRepo(verified.claims.repository);
  if (!org) {
    return {
      ok: false,
      response: errorResponse(404, "site_not_provisioned", "No site is provisioned for this repository."),
    };
  }

  if (verified.claims.sha === org.lastIngestedCommitSha) {
    return {
      ok: false,
      response: NextResponse.json({
        status: "already_current",
        organizationSlug: org.slug,
        commitSha: verified.claims.sha,
      }),
    };
  }

  return { ok: true, org, claims: verified.claims };
}

/** Staged routes only: `x-presby-ingest-protocol: 1`, exactly. Returns the refusal, or null. */
export function requireProtocol(req: Request): NextResponse | null {
  if (req.headers.get(PROTOCOL_HEADER) === PROTOCOL_VERSION) return null;
  return errorResponse(
    422,
    "unsupported_protocol",
    `Unsupported ingest protocol. Send the header ${PROTOCOL_HEADER}: ${PROTOCOL_VERSION}.`,
  );
}

// ---------------------------------------------------------------------------
// Bounded body
// ---------------------------------------------------------------------------

function tooLarge(): NextResponse {
  return errorResponse(413, "request_too_large", "Request body is larger than 4,000,000 bytes.");
}

/**
 * The request body, at most `MAX_REQUEST_BYTES`. A declared `Content-Length`
 * over the limit is refused without reading a byte; otherwise the bytes
 * actually read are counted and the stream is cancelled at the limit, so a
 * client that declares a small length and sends more is stopped too.
 */
export async function readBoundedBody(
  req: Request,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; response: NextResponse }> {
  const declared = req.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared.trim()) > MAX_REQUEST_BYTES) {
    return { ok: false, response: tooLarge() };
  }
  if (!req.body) return { ok: true, bytes: Buffer.alloc(0) };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, response: tooLarge() };
    }
    chunks.push(value);
  }
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}

/** `readBoundedBody` then `JSON.parse`; not JSON is a 422 `invalid_json`. */
export async function readJsonBody(
  req: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const body = await readBoundedBody(req);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(body.bytes.toString("utf8")) as unknown };
  } catch {
    return { ok: false, response: errorResponse(422, "invalid_json", "Request body is not valid JSON.") };
  }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** 64 lowercase hex characters. */
export function validateSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

/** 1 to 200 UTF-16 code units, no U+0000-U+001F and no U+007F; everything else is allowed. */
export function validateManifestKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_MANIFEST_KEY_UNITS &&
    !CONTROL_CHARACTER_RE.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type PagesResult =
  | { ok: true; pages: PublishedSiteBundlePage[] }
  | { ok: false; code: "invalid_request" | "reserved_page"; error: string };

/**
 * Pages exactly as the legacy route always validated them (shape, then the
 * reserved paths). `field` is how the caller names the array in its messages:
 * `bundle.pages` (legacy) or `pages` (commit).
 */
export function validatePages(pages: unknown, field: "bundle.pages" | "pages"): PagesResult {
  if (!Array.isArray(pages) || pages.length === 0) {
    return { ok: false, code: "invalid_request", error: `${field} must be a non-empty array.` };
  }
  const out: PublishedSiteBundlePage[] = [];
  for (const p of pages) {
    if (
      !isRecord(p) ||
      typeof p.path !== "string" ||
      p.path.length === 0 ||
      typeof p.frontMatter !== "object" ||
      p.frontMatter === null ||
      !("mdxAst" in p)
    ) {
      return { ok: false, code: "invalid_request", error: `Malformed entry in ${field}.` };
    }
    // PresbyPortal serves its own giving page at /give (and /give/return), the
    // asset route, robots.txt and sitemap.xml (T15: a custom domain serves them at
    // the root); a static route segment beats the catch-all that renders bundle
    // pages, so a bundle page there would be stored and never shown. Refuse it, by name.
    const reserved = reservedSitePath(p.path);
    if (reserved.reserved) {
      return {
        ok: false,
        code: "reserved_page",
        error:
          reserved.segment === "give"
            ? `Page "${p.path.slice(0, 120)}" is reserved: PresbyPortal serves its own /${reserved.segment} page for online giving. Rename or remove it.`
            : reserved.segment === "careers"
              ? // Copy I1. Descendants only: the bare /careers is allowed, so this
                // message must never say /careers ITSELF is reserved.
                `Page "${p.path.slice(0, 120)}" is reserved: PresbyPortal serves its own pages for job openings under /careers/ (on a custom domain too). A page at /careers itself is fine. Rename or remove it.`
              : `Page "${p.path.slice(0, 120)}" is reserved: PresbyPortal serves its own /${reserved.segment} path (on a custom domain too). Rename or remove it.`,
      };
    }
    out.push({
      path: p.path,
      frontMatter: p.frontMatter as Record<string, unknown>,
      mdxAst: p.mdxAst,
    });
  }
  return { ok: true, pages: out };
}

const IMAGES_ARRAY_ERROR = `images must be an array of at most ${MAX_MANIFEST_ENTRIES} entries.`;

export interface PlanImage {
  sha256: string;
  size: number;
}

/** The `/plan` body: `{ images: [{ sha256, size }] }`, distinct by hash, at most 2,000, may be empty. */
export function validatePlanImages(
  body: unknown,
): { ok: true; images: PlanImage[] } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Malformed request body." };
  const images = body.images;
  if (!Array.isArray(images) || images.length > MAX_MANIFEST_ENTRIES) {
    return { ok: false, error: IMAGES_ARRAY_ERROR };
  }
  const seen = new Set<string>();
  const out: PlanImage[] = [];
  for (let i = 0; i < images.length; i++) {
    const e = images[i];
    if (
      !isRecord(e) ||
      !validateSha256(e.sha256) ||
      typeof e.size !== "number" ||
      !Number.isInteger(e.size) ||
      e.size < 1 ||
      e.size > MAX_IMAGE_BYTES
    ) {
      return {
        ok: false,
        error: `images[${i}] needs a lowercase 64-character sha256 and a size from 1 to ${MAX_IMAGE_BYTES}.`,
      };
    }
    if (seen.has(e.sha256)) {
      return { ok: false, error: `images[${i}] repeats an earlier sha256.` };
    }
    seen.add(e.sha256);
    out.push({ sha256: e.sha256, size: e.size });
  }
  return { ok: true, images: out };
}

export interface CommitImage {
  manifestKey: string;
  sha256: string;
}

/**
 * The `/commit` body: `{ schemaVersion: 1, pages, images: [{ manifestKey, sha256 }] }`.
 * `schemaVersion` is the STORED bundle's page-shape version (the wire version
 * is the protocol header). Two keys may share a hash; a key may not repeat.
 */
export function validateCommitBody(
  body: unknown,
):
  | { ok: true; pages: PublishedSiteBundlePage[]; images: CommitImage[] }
  | { ok: false; code: "invalid_request" | "reserved_page"; error: string } {
  if (!isRecord(body)) return { ok: false, code: "invalid_request", error: "Malformed request body." };
  if (body.schemaVersion !== 1) {
    return { ok: false, code: "invalid_request", error: "Unsupported schemaVersion." };
  }

  const pages = validatePages(body.pages, "pages");
  if (!pages.ok) return pages;

  const images = body.images;
  if (!Array.isArray(images) || images.length > MAX_MANIFEST_ENTRIES) {
    return { ok: false, code: "invalid_request", error: IMAGES_ARRAY_ERROR };
  }
  const seenKeys = new Set<string>();
  const out: CommitImage[] = [];
  for (let i = 0; i < images.length; i++) {
    const e = images[i];
    if (!isRecord(e) || !validateManifestKey(e.manifestKey) || !validateSha256(e.sha256)) {
      return {
        ok: false,
        code: "invalid_request",
        error: `images[${i}] needs a manifestKey of 1 to ${MAX_MANIFEST_KEY_UNITS} characters with no control characters, and a lowercase 64-character sha256.`,
      };
    }
    if (seenKeys.has(e.manifestKey)) {
      return { ok: false, code: "invalid_request", error: `images[${i}] repeats the manifestKey "${e.manifestKey}".` };
    }
    seenKeys.add(e.manifestKey);
    out.push({ manifestKey: e.manifestKey, sha256: e.sha256 });
  }
  return { ok: true, pages: pages.pages, images: out };
}

/** "a", "b" (and 3 more) - at most 20 keys named. */
export function describeMissingKeys(keys: readonly string[]): string {
  const named = keys.slice(0, MAX_NAMED_KEYS).map((k) => `"${k}"`).join(", ");
  const rest = keys.length - MAX_NAMED_KEYS;
  return rest > 0 ? `${named} (and ${rest} more)` : named;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Storing an image (F289: public_site)
// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export type StoreSiteImageResult =
  | { ok: true; ref: BlobRef }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "not_an_image" }
  | { ok: false; reason: "rejected"; message: string };

/**
 * Magic-byte sniff (never trust a declared type; PNG, JPEG and WEBP only), then
 * `store()` as a `public_site` image. The adapter dedups on (organization,
 * audience, content hash). Two simultaneous stores of identical bytes can both
 * miss the dedup SELECT and one then hits the unique key (F289 Edge Case 17),
 * so a unique violation is retried ONCE - the second attempt's SELECT finds the
 * row. A second failure propagates.
 */
export async function storeSiteImage(org: IngestOrg, bytes: Buffer): Promise<StoreSiteImageResult> {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  const sniffed = sniffTicketAttachmentContentType(bytes);
  if (!sniffed || sniffed === "application/pdf") return { ok: false, reason: "not_an_image" };

  const attempt = () =>
    getBlobStore().store({
      organizationId: org.organizationId,
      bytes,
      contentType: sniffed,
      audience: "public_site",
    });

  try {
    try {
      return { ok: true, ref: await attempt() };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return { ok: true, ref: await attempt() };
    }
  } catch (err) {
    if (err instanceof BlobValidationError) return { ok: false, reason: "rejected", message: err.message };
    throw err;
  }
}

/**
 * Which of these (distinct) hashes this organization holds as a `public_site`
 * IMAGE. A hash held only as `private`, or only by another organization, is
 * not in the map; neither is a row whose type is somehow not an image (a second
 * check behind the database CHECK). An empty list is answered without a query.
 */
export async function findHeldSiteImages(
  org: IngestOrg,
  hashes: readonly string[],
): Promise<Map<string, BlobRef>> {
  if (hashes.length === 0) return new Map();
  const found = await getBlobStore().findByContentHashes({
    organizationId: org.organizationId,
    audience: "public_site",
    contentHashes: hashes,
  });
  const held = new Map<string, BlobRef>();
  for (const [hash, ref] of found) {
    if (PUBLIC_IMAGE_TYPES.has(ref.contentType)) held.set(hash, ref);
  }
  return held;
}

// ---------------------------------------------------------------------------
// Publishing (shared by the legacy and the commit route)
// ---------------------------------------------------------------------------

/**
 * The tail of every publish: store the bundle JSON (`private`: only a
 * server-side reader uses it), then `recordSiteIngest` (the ONE update that
 * makes the new content live, and the only place the commit sha is written),
 * then the audit row, then the revalidations. `imageKeys` must already map each
 * manifest key to a blob uuid the SERVER chose. `imageCount` counts manifest
 * entries on both transports.
 */
export async function publishSiteBundle(input: {
  org: IngestOrg;
  claims: VerifiedOidcClaims;
  pages: PublishedSiteBundlePage[];
  imageKeys: Record<string, string>;
  imageCount: number;
  transport: IngestTransport;
}): Promise<NextResponse> {
  const { org, claims, pages, imageKeys, imageCount, transport } = input;

  const bundleBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, pages, imageKeys }), "utf-8");

  let bundleRef: BlobRef;
  try {
    bundleRef = await getBlobStore().store({
      organizationId: org.organizationId,
      bytes: bundleBytes,
      contentType: "application/json",
      audience: "private",
    });
  } catch (err) {
    if (err instanceof BlobValidationError) {
      return errorResponse(422, "invalid_request", err.message);
    }
    throw err;
  }

  await recordSiteIngest(org.organizationId, {
    commitSha: claims.sha,
    contentBundleKey: bundleRef.key,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.SITE_CONTENT_INGESTED,
    actor: null,
    resourceType: "organization",
    resourceId: org.organizationId,
    metadata: {
      repo: claims.repository,
      commitSha: claims.sha,
      pageCount: pages.length,
      imageCount,
      transport,
    },
  });

  // Both a layout-level revalidate and a per-page one - a layout-only
  // revalidate does not guarantee every already-cached leaf segment is torn
  // down under partial prerendering (Phase 3's own step 9 reasoning).
  // slugSitePath() is the one builder of a slug URL (DECISION-181). Revalidation of the
  // slug URL is what a platform-host render needs; every segment under /site/[slug] is
  // force-dynamic (site-urls.test.ts pins that), so a custom host never serves a stale page.
  revalidatePath(slugSitePath(org.slug), "layout");
  for (const page of pages) {
    revalidatePath(slugSitePath(org.slug, page.path));
  }

  return NextResponse.json({
    status: "ingested",
    organizationSlug: org.slug,
    commitSha: claims.sha,
    pageCount: pages.length,
  });
}
