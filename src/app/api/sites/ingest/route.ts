import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isFlagEnabled } from "@/lib/flags";
import { verifyGithubActionsOidcToken } from "@/lib/sites-ingest-auth";
import {
  resolveOrganizationByRepo,
  recordSiteIngest,
  type PublishedSiteBundlePage,
} from "@/lib/sites";
import { getBlobStore, BlobValidationError } from "@/lib/storage/blob-store";
import { sniffTicketAttachmentContentType } from "@/lib/storage/sniff";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

/**
 * `POST /api/sites/ingest` — the platform's own GitHub Actions CI POSTs a
 * normalized content bundle here on every push to `main` in a `site-<slug>`
 * repo. See docs/work-log/2026-08-20-public-sites.md Phase 3 "API Contract".
 *
 * NOT a Server Action, and deliberately NOT under `src/app/api/webhooks/` —
 * that tree (DECISION-028) is scoped to THIRD-PARTY inbound webhooks; this is
 * the platform's own CI, a different trust class (Phase 2's placement
 * ruling). Auth is GitHub Actions OIDC, verified per-request against token
 * claims (`src/lib/sites-ingest-auth.ts`) — never a session, never
 * `hasFeature`/`hasPermission`. `src/proxy.ts`'s existing unconditional
 * `/api/*` bypass already lets this route through with no proxy change.
 *
 * The `check:audit` tripwire scans only `src/app/**\/actions.ts` files — this
 * route's `SITE_CONTENT_INGESTED` write is intentionally outside that scope
 * (DECISION-084), the fifth instance of the documented
 * RATE_LIMIT_BLOCKED/EMAIL_QUEUE_PERMANENT_FAILURE/ACCESS_DENIED/
 * USER_ACCOUNT_LOCKED precedent pattern in `src/lib/audit.ts`.
 *
 * Response contract (`SitesIngestResponse`):
 *   200 { status: "ingested", organizationSlug, commitSha, pageCount }
 *   200 { status: "already_current", organizationSlug, commitSha }
 *   401 { status: "error", error } — OIDC verification failed
 *   404 { status: "error", error } — token's `repository` claim resolves to
 *       no organization_sites row. Safe to be specific: the caller is
 *       GitHub's own trusted CI, not a public prober.
 *   422 { status: "error", error } — malformed bundle / bad image
 *   503 { status: "error", error } — sites.public_render is off. A disabled
 *       feature rejects ingest too, not just the read path (Phase 3
 *       Permissions & Flags) — an org's content should not silently go
 *       "live" behind a flag that then flips on with stale-vs-fresh
 *       ambiguity.
 */

interface IngestBundlePageInput {
  path: string;
  frontMatter: Record<string, unknown>;
  mdxAst: unknown;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface IngestBundleImageInput {
  manifestKey: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  bytesBase64: string;
}

interface SitesIngestRequestBundle {
  schemaVersion: 1;
  pages: IngestBundlePageInput[];
  images: IngestBundleImageInput[];
}

function errorResponse(status: number, error: string): NextResponse {
  return NextResponse.json({ status: "error", error }, { status });
}

function validateBundle(
  body: unknown,
): { ok: true; bundle: SitesIngestRequestBundle } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Malformed request body." };
  }
  const bundle = (body as Record<string, unknown>).bundle;
  if (typeof bundle !== "object" || bundle === null) {
    return { ok: false, error: "Missing bundle." };
  }
  const b = bundle as Record<string, unknown>;

  if (b.schemaVersion !== 1) {
    return { ok: false, error: "Unsupported bundle.schemaVersion." };
  }

  if (!Array.isArray(b.pages) || b.pages.length === 0) {
    return { ok: false, error: "bundle.pages must be a non-empty array." };
  }
  for (const p of b.pages) {
    if (
      typeof p !== "object" ||
      p === null ||
      typeof (p as Record<string, unknown>).path !== "string" ||
      ((p as Record<string, unknown>).path as string).length === 0 ||
      typeof (p as Record<string, unknown>).frontMatter !== "object" ||
      (p as Record<string, unknown>).frontMatter === null ||
      !("mdxAst" in (p as Record<string, unknown>))
    ) {
      return { ok: false, error: "Malformed entry in bundle.pages." };
    }
  }

  if (!Array.isArray(b.images)) {
    return { ok: false, error: "bundle.images must be an array." };
  }
  for (const img of b.images) {
    if (
      typeof img !== "object" ||
      img === null ||
      typeof (img as Record<string, unknown>).manifestKey !== "string" ||
      ((img as Record<string, unknown>).manifestKey as string).length === 0 ||
      !ALLOWED_IMAGE_TYPES.has(
        String((img as Record<string, unknown>).contentType),
      ) ||
      typeof (img as Record<string, unknown>).bytesBase64 !== "string" ||
      ((img as Record<string, unknown>).bytesBase64 as string).length === 0
    ) {
      return { ok: false, error: "Malformed entry in bundle.images." };
    }
  }

  return { ok: true, bundle: b as unknown as SitesIngestRequestBundle };
}

export async function POST(req: Request): Promise<NextResponse> {
  const verified = await verifyGithubActionsOidcToken(
    req.headers.get("authorization"),
  );
  if (!verified.ok) {
    return errorResponse(verified.status, verified.error);
  }

  if (!(await isFlagEnabled("sites.public_render"))) {
    return errorResponse(503, "Site ingest is currently disabled.");
  }

  const org = await resolveOrganizationByRepo(verified.claims.repository);
  if (!org) {
    return errorResponse(404, "No site is provisioned for this repository.");
  }

  // Idempotency (Phase 1 Gap 7): a repeat commit sha short-circuits before
  // any write — blob storage, recordSiteIngest, revalidation, and the audit
  // write are all skipped.
  if (verified.claims.sha === org.lastIngestedCommitSha) {
    return NextResponse.json({
      status: "already_current",
      organizationSlug: org.slug,
      commitSha: verified.claims.sha,
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse(422, "Request body is not valid JSON.");
  }

  const validated = validateBundle(rawBody);
  if (!validated.ok) {
    return errorResponse(422, validated.error);
  }
  const { bundle } = validated;

  const imageKeys: Record<string, string> = {};
  for (const image of bundle.images) {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(image.bytesBase64, "base64");
    } catch {
      return errorResponse(
        422,
        `Image "${image.manifestKey}" is not valid base64.`,
      );
    }
    if (bytes.byteLength === 0) {
      return errorResponse(
        422,
        `Image "${image.manifestKey}" decoded to 0 bytes.`,
      );
    }
    // Sniff magic bytes — never trust the bundle's declared contentType
    // (same discipline as every other upload path in this codebase).
    const sniffed = sniffTicketAttachmentContentType(bytes);
    if (!sniffed || sniffed === "application/pdf") {
      return errorResponse(
        422,
        `Image "${image.manifestKey}" is not a PNG, JPEG, or WEBP.`,
      );
    }
    try {
      const ref = await getBlobStore().store({
        organizationId: org.organizationId,
        bytes,
        contentType: sniffed,
      });
      imageKeys[image.manifestKey] = ref.key;
    } catch (err) {
      if (err instanceof BlobValidationError) {
        return errorResponse(422, `Image "${image.manifestKey}": ${err.message}`);
      }
      throw err;
    }
  }

  const pages: PublishedSiteBundlePage[] = bundle.pages.map((p) => ({
    path: p.path,
    frontMatter: p.frontMatter,
    mdxAst: p.mdxAst,
  }));

  const bundleBytes = Buffer.from(
    JSON.stringify({ schemaVersion: 1, pages, imageKeys }),
    "utf-8",
  );

  let bundleRef;
  try {
    bundleRef = await getBlobStore().store({
      organizationId: org.organizationId,
      bytes: bundleBytes,
      contentType: "application/json",
    });
  } catch (err) {
    if (err instanceof BlobValidationError) {
      return errorResponse(422, err.message);
    }
    throw err;
  }

  await recordSiteIngest(org.organizationId, {
    commitSha: verified.claims.sha,
    contentBundleKey: bundleRef.key,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.SITE_CONTENT_INGESTED,
    actor: null,
    resourceType: "organization",
    resourceId: org.organizationId,
    metadata: {
      repo: verified.claims.repository,
      commitSha: verified.claims.sha,
      pageCount: pages.length,
      imageCount: bundle.images.length,
    },
  });

  // Both a layout-level revalidate and a per-page one — a layout-only
  // revalidate does not guarantee every already-cached leaf segment is torn
  // down under partial prerendering (Phase 3's own step 9 reasoning).
  revalidatePath(`/site/${org.slug}`, "layout");
  for (const page of pages) {
    revalidatePath(`/site/${org.slug}${page.path === "/" ? "" : page.path}`);
  }

  return NextResponse.json({
    status: "ingested",
    organizationSlug: org.slug,
    commitSha: verified.claims.sha,
    pageCount: pages.length,
  });
}
