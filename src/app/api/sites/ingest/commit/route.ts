import { NextResponse } from "next/server";
import {
  authorizeIngest,
  describeMissingKeys,
  errorResponse,
  findHeldSiteImages,
  handleIngest,
  publishSiteBundle,
  readJsonBody,
  requireProtocol,
  validateCommitBody,
} from "@/lib/sites-ingest";

/**
 * `POST /api/sites/ingest/commit` - the last step of the staged site ingest
 * (site-ingest-size, DECISION-279; docs/work-log/2026-10-26-site-ingest-size.md,
 * Phase 3 "API Contract"). The pages plus, per image, the manifest key and the
 * sha256 of bytes the caller has already uploaded.
 *
 * Request  (`x-presby-ingest-protocol: 1`, `authorization: Bearer <OIDC>`):
 *   { schemaVersion: 1,
 *     pages:  [{ path, frontMatter, mdxAst }],
 *     images: [{ manifestKey, sha256 }] }
 *   `images` may be empty; two keys may share a hash; a key may not repeat;
 *   at most 2,000 entries. `schemaVersion` is the STORED bundle's page-shape
 *   version (the wire version is the protocol header).
 * Response (identical to the legacy success body):
 *   200 { status: "ingested", organizationSlug, commitSha, pageCount }
 *   200 { status: "already_current", organizationSlug, commitSha }
 *   error { status: "error", code, error } - see `INGEST_ERROR_CODES`:
 *       422 images_not_uploaded (names up to 20 manifest keys), 422 reserved_page,
 *       422 invalid_request, 413 request_too_large
 *
 * SELF-VALIDATING: it never relies on a plan or an upload having happened.
 * Every declared hash is resolved by the SERVER to a `public_site` image in the
 * caller's organization (`findHeldSiteImages`); the client never sends or
 * receives a blob uuid. One missing hash refuses the whole commit and writes
 * nothing, so a retry after uploading it succeeds with the same sha. Publishing
 * (`publishSiteBundle`) is shared with the legacy route: the single
 * `recordSiteIngest` UPDATE that writes the commit sha runs only after every
 * image is confirmed held.
 */
export const POST = handleIngest(async (req: Request): Promise<NextResponse> => {
  const gate = await authorizeIngest(req);
  if (!gate.ok) return gate.response;

  const refused = requireProtocol(req);
  if (refused) return refused;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const commit = validateCommitBody(body.value);
  if (!commit.ok) return errorResponse(422, commit.code, commit.error);

  const distinctHashes = [...new Set(commit.images.map((image) => image.sha256))];
  const held = await findHeldSiteImages(gate.org, distinctHashes);

  const notHeld = commit.images.filter((image) => !held.has(image.sha256)).map((image) => image.manifestKey);
  if (notHeld.length > 0) {
    return errorResponse(
      422,
      "images_not_uploaded",
      `These images are not available to this site yet: ${describeMissingKeys(notHeld)}. Upload them, then commit again.`,
    );
  }

  // Object.fromEntries, not assignment: a manifest key of "__proto__" is data.
  const imageKeys = Object.fromEntries(
    commit.images.map((image) => [image.manifestKey, held.get(image.sha256)!.key] as const),
  );

  return publishSiteBundle({
    org: gate.org,
    claims: gate.claims,
    pages: commit.pages,
    imageKeys,
    imageCount: commit.images.length,
    transport: "staged",
  });
});
