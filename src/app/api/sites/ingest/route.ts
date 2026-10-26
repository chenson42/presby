import { NextResponse } from "next/server";
import {
  MAX_MANIFEST_ENTRIES,
  authorizeIngest,
  errorResponse,
  handleIngest,
  publishSiteBundle,
  readJsonBody,
  storeSiteImage,
  validatePages,
} from "@/lib/sites-ingest";
import type { PublishedSiteBundlePage } from "@/lib/sites";

/**
 * `POST /api/sites/ingest` - the LEGACY single-request ingest: the platform's
 * own GitHub Actions CI POSTs a normalized content bundle (pages plus every
 * image, base64) here on a push to `main` in a `site-<slug>` repo. See
 * docs/work-log/2026-08-20-public-sites.md Phase 3 "API Contract".
 *
 * Since site-ingest-size (DECISION-279) this is one of FOUR routes. A site whose
 * whole bundle exceeds the 4,000,000-byte request limit cannot use this one and
 * publishes through the staged, content-addressed routes instead:
 *   POST /api/sites/ingest/plan     which image hashes the platform still needs
 *   POST /api/sites/ingest/images   one image's raw bytes, hash-verified
 *   POST /api/sites/ingest/commit   the pages plus { manifestKey, sha256 } per image
 * This route is kept indefinitely (the client uses it whenever the bundle fits,
 * so neither repository's deploy order can break a small site). It shares the
 * gate (`authorizeIngest`), the bounded body read and `publishSiteBundle` with
 * the staged routes through `src/lib/sites-ingest.ts`; every blob-store call and
 * its `audience` literal lives there.
 *
 * NOT a Server Action, and deliberately NOT under `src/app/api/webhooks/` -
 * that tree (DECISION-028) is scoped to THIRD-PARTY inbound webhooks; this is
 * the platform's own CI, a different trust class (Phase 2's placement
 * ruling). Auth is GitHub Actions OIDC, verified per-request against token
 * claims (`src/lib/sites-ingest-auth.ts`) - never a session, never
 * `hasFeature`/`hasPermission`. `src/proxy.ts`'s existing unconditional
 * `/api/*` bypass already lets these routes through with no proxy change.
 *
 * The `check:audit` tripwire scans only `src/app/**\/actions.ts` files - the
 * `SITE_CONTENT_INGESTED` write is intentionally outside that scope
 * (DECISION-084), the fifth instance of the documented
 * RATE_LIMIT_BLOCKED/EMAIL_QUEUE_PERMANENT_FAILURE/ACCESS_DENIED/
 * USER_ACCOUNT_LOCKED precedent pattern in `src/lib/audit.ts`.
 *
 * Request: `{ bundle: { schemaVersion: 1, pages, images: [{ manifestKey,
 * contentType, bytesBase64 }] } }`, at most 4,000,000 bytes and 2,000 images.
 *
 * Response contract (`SitesIngestResponse`):
 *   200 { status: "ingested", organizationSlug, commitSha, pageCount }
 *   200 { status: "already_current", organizationSlug, commitSha }
 *   error { status: "error", code, error } - `code` is the closed set in
 *       `INGEST_ERROR_CODES`:
 *   401 unauthorized - OIDC verification failed
 *   404 site_not_provisioned - the token's `repository` claim resolves to no
 *       organization_sites row. Safe to be specific: the caller is GitHub's
 *       own trusted CI, not a public prober.
 *   413 request_too_large - the body is over 4,000,000 bytes (authenticated callers only)
 *   422 invalid_json | invalid_request | reserved_page | not_an_image |
 *       image_rejected - malformed bundle / bad image
 *   503 ingest_disabled - sites.public_render is off. A disabled feature
 *       rejects ingest too, not just the read path (Phase 3 Permissions &
 *       Flags) - an org's content should not silently go "live" behind a flag
 *       that then flips on with stale-vs-fresh ambiguity.
 *   500 server_error - anything uncaught, with no detail
 */

interface IngestBundleImageInput {
  manifestKey: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  bytesBase64: string;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type ValidatedBundle =
  | { ok: true; pages: PublishedSiteBundlePage[]; images: IngestBundleImageInput[] }
  | { ok: false; code: "invalid_request" | "reserved_page"; error: string };

function validateBundle(body: unknown): ValidatedBundle {
  if (typeof body !== "object" || body === null) {
    return { ok: false, code: "invalid_request", error: "Malformed request body." };
  }
  const bundle = (body as Record<string, unknown>).bundle;
  if (typeof bundle !== "object" || bundle === null) {
    return { ok: false, code: "invalid_request", error: "Missing bundle." };
  }
  const b = bundle as Record<string, unknown>;

  if (b.schemaVersion !== 1) {
    return { ok: false, code: "invalid_request", error: "Unsupported bundle.schemaVersion." };
  }

  const pages = validatePages(b.pages, "bundle.pages");
  if (!pages.ok) return pages;

  if (!Array.isArray(b.images)) {
    return { ok: false, code: "invalid_request", error: "bundle.images must be an array." };
  }
  if (b.images.length > MAX_MANIFEST_ENTRIES) {
    return {
      ok: false,
      code: "invalid_request",
      error: `bundle.images has more than ${MAX_MANIFEST_ENTRIES} entries.`,
    };
  }
  for (const img of b.images) {
    if (
      typeof img !== "object" ||
      img === null ||
      typeof (img as Record<string, unknown>).manifestKey !== "string" ||
      ((img as Record<string, unknown>).manifestKey as string).length === 0 ||
      !ALLOWED_IMAGE_TYPES.has(String((img as Record<string, unknown>).contentType)) ||
      typeof (img as Record<string, unknown>).bytesBase64 !== "string" ||
      ((img as Record<string, unknown>).bytesBase64 as string).length === 0
    ) {
      return { ok: false, code: "invalid_request", error: "Malformed entry in bundle.images." };
    }
  }

  return { ok: true, pages: pages.pages, images: b.images as IngestBundleImageInput[] };
}

export const POST = handleIngest(async (req: Request): Promise<NextResponse> => {
  const gate = await authorizeIngest(req);
  if (!gate.ok) return gate.response;
  const { org, claims } = gate;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const validated = validateBundle(body.value);
  if (!validated.ok) {
    return errorResponse(422, validated.code, validated.error);
  }

  const imageEntries: Array<[string, string]> = [];
  for (const image of validated.images) {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(image.bytesBase64, "base64");
    } catch {
      return errorResponse(422, "invalid_request", `Image "${image.manifestKey}" is not valid base64.`);
    }
    if (bytes.byteLength === 0) {
      return errorResponse(422, "invalid_request", `Image "${image.manifestKey}" decoded to 0 bytes.`);
    }
    // Sniff magic bytes - never trust the bundle's declared contentType
    // (same discipline as every other upload path in this codebase).
    const stored = await storeSiteImage(org, bytes);
    if (!stored.ok) {
      if (stored.reason === "not_an_image") {
        return errorResponse(422, "not_an_image", `Image "${image.manifestKey}" is not a PNG, JPEG, or WEBP.`);
      }
      if (stored.reason === "rejected") {
        return errorResponse(422, "image_rejected", `Image "${image.manifestKey}": ${stored.message}`);
      }
      return errorResponse(422, "invalid_request", `Image "${image.manifestKey}" decoded to 0 bytes.`);
    }
    imageEntries.push([image.manifestKey, stored.ref.key]);
  }

  // Object.fromEntries, not `imageKeys[key] = ...`: a manifest key of "__proto__"
  // is data here, never a prototype assignment.
  return publishSiteBundle({
    org,
    claims,
    pages: validated.pages,
    imageKeys: Object.fromEntries(imageEntries),
    imageCount: validated.images.length,
    transport: "legacy",
  });
});
