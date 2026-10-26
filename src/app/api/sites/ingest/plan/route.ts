import { NextResponse } from "next/server";
import {
  authorizeIngest,
  errorResponse,
  findHeldSiteImages,
  handleIngest,
  readJsonBody,
  requireProtocol,
  validatePlanImages,
} from "@/lib/sites-ingest";

/**
 * `POST /api/sites/ingest/plan` - step one of the staged site ingest
 * (site-ingest-size, DECISION-279; docs/work-log/2026-10-26-site-ingest-size.md,
 * Phase 3 "API Contract"). The caller sends the sha256 and size of every
 * DISTINCT image its site uses (never the bytes) and learns which of them this
 * organization does not yet hold as a `public_site` image.
 *
 * Request  (`x-presby-ingest-protocol: 1`, `authorization: Bearer <OIDC>`):
 *   { images: [{ sha256: "<64 lowercase hex>", size: <1..4000000> }] }
 *   `images` may be empty (a site with no images still plans, so a repeat
 *   commit sha is answered `already_current` here, before anything is sent).
 *   Distinct by hash, at most 2,000 entries.
 * Response:
 *   200 { status: "planned", missing: ["<hex>", ...] }  in request order
 *   200 { status: "already_current", organizationSlug, commitSha }
 *   error { status: "error", code, error } - see `INGEST_ERROR_CODES`
 *
 * A hash held only as `private`, or only by another organization, is MISSING:
 * the lookup asks for `public_site` (F289), so a plan can never say "held" for
 * an image a public bundle could not serve. Writes nothing. `size` is
 * validated and otherwise unused. No blob uuid appears in the answer: an
 * uploaded-but-unpublished image stays unreachable because nothing discloses
 * its key.
 */
export const POST = handleIngest(async (req: Request): Promise<NextResponse> => {
  const gate = await authorizeIngest(req);
  if (!gate.ok) return gate.response;

  const refused = requireProtocol(req);
  if (refused) return refused;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const plan = validatePlanImages(body.value);
  if (!plan.ok) return errorResponse(422, "invalid_request", plan.error);

  const hashes = plan.images.map((image) => image.sha256);
  const held = await findHeldSiteImages(gate.org, hashes);
  return NextResponse.json({
    status: "planned",
    missing: hashes.filter((hash) => !held.has(hash)),
  });
});
