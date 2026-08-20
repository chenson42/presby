import { NextResponse } from "next/server";
import { resolvePublishedOrganization } from "@/lib/sites";
import { getBlobStore } from "@/lib/storage/blob-store";

/**
 * `GET /site/<slug>/assets/[key]` — content-image serving for the public
 * render path. See docs/work-log/2026-08-20-public-sites.md Phase 3,
 * "Component / Page Plan".
 *
 * PURELY PUBLIC, CONTENT-ADDRESSED — no session read, matching
 * `presby_published_site()`'s own anonymous, no-org-GUC contract.
 * `resolvePublishedOrganization(slug)` is the cheaper sibling of
 * `getPublishedSite()` (skips the blob fetch + JSON.parse the page itself
 * already did) and applies the identical enumeration-safe collapse: a
 * never-provisioned, suspended, nonexistent, or flag-off slug all 404
 * identically, same as the page route.
 *
 * `Cache-Control: public, max-age=31536000, immutable` — content-addressed
 * (the `[key]` IS the row's own uuid `blobAssets.id`, per `blob-store.ts`'s
 * own doc comment on why the key is the row id and not the content hash;
 * either way the bytes behind a given key never change), mirrors
 * DECISION-049's logo-asset reasoning.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; key: string }> },
): Promise<NextResponse> {
  const { slug, key } = await params;

  const org = await resolvePublishedOrganization(slug);
  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const blob = await getBlobStore().resolve({
    organizationId: org.organizationId,
    key,
  });
  if (!blob) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(blob.bytes), {
    headers: {
      "Content-Type": blob.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
