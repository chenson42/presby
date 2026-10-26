import { NextResponse } from "next/server";
import {
  SHA256_HEADER,
  authorizeIngest,
  errorResponse,
  handleIngest,
  readBoundedBody,
  requireProtocol,
  sha256Hex,
  storeSiteImage,
  validateSha256,
} from "@/lib/sites-ingest";

/**
 * `POST /api/sites/ingest/images` - step two of the staged site ingest
 * (site-ingest-size, DECISION-279; docs/work-log/2026-10-26-site-ingest-size.md,
 * Phase 3 "API Contract"). The raw bytes of ONE image per request; the
 * declared digest and manifest key never travel in the path (the proxy matcher
 * excludes any path ending in an image extension, F151).
 *
 * Request  (`x-presby-ingest-protocol: 1`, `x-presby-sha256: <64 lowercase hex>`,
 *   `authorization: Bearer <OIDC>`; the body is the image, at most 4,000,000
 *   bytes; any `content-type` the client sends is ignored - the sniff decides):
 * Response:
 *   200 { status: "stored", sha256, byteSize, contentType }
 *   200 { status: "already_current", organizationSlug, commitSha }
 *   error { status: "error", code, error } - see `INGEST_ERROR_CODES`:
 *       422 invalid_request (header missing/malformed, empty body),
 *       422 hash_mismatch (the SERVER hashes the bytes itself),
 *       422 not_an_image (magic bytes: PNG, JPEG or WEBP only),
 *       413 request_too_large
 *
 * Stores a `public_site` row through `storeSiteImage` (sniffed type, the
 * server's own hash, dedup on organization + audience + hash: re-uploading held
 * bytes is a 200 and adds no row). Writes no audit row and never touches
 * `organization_sites`: nothing is published until commit. No blob uuid in the
 * answer.
 */
export const POST = handleIngest(async (req: Request): Promise<NextResponse> => {
  const gate = await authorizeIngest(req);
  if (!gate.ok) return gate.response;

  const refused = requireProtocol(req);
  if (refused) return refused;

  const declared = req.headers.get(SHA256_HEADER);
  if (!validateSha256(declared)) {
    return errorResponse(422, "invalid_request", `${SHA256_HEADER} must be a lowercase 64-character hex sha256.`);
  }

  const body = await readBoundedBody(req);
  if (!body.ok) return body.response;
  if (body.bytes.byteLength === 0) {
    return errorResponse(422, "invalid_request", "The image body is empty.");
  }

  if (sha256Hex(body.bytes) !== declared) {
    return errorResponse(422, "hash_mismatch", `The bytes received do not match ${SHA256_HEADER}.`);
  }

  const stored = await storeSiteImage(gate.org, body.bytes);
  if (!stored.ok) {
    if (stored.reason === "not_an_image") {
      return errorResponse(422, "not_an_image", "The uploaded file is not a PNG, JPEG, or WEBP.");
    }
    if (stored.reason === "rejected") {
      return errorResponse(422, "image_rejected", `Image: ${stored.message}`);
    }
    return errorResponse(422, "invalid_request", "The image body is empty.");
  }

  return NextResponse.json({
    status: "stored",
    sha256: declared,
    byteSize: stored.ref.byteSize,
    contentType: stored.ref.contentType,
  });
});
