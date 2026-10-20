import { NextResponse } from "next/server";
import { resolveSiteOrganization } from "@/lib/sites";
import { getBlobStore, type ResolvedBlob } from "@/lib/storage/blob-store";

export const dynamic = "force-dynamic"; // stops Next's build-time placeholder-param prerender trial (params.slug = "-") from reaching a live flag/DB read here at all — docs/work-log/2026-09-26-flags-fail-closed.md Phase 2 Ruling 3

/**
 * `GET /site/<key>/assets/[key]` (and `GET /assets/[key]` on a church's own
 * domain, which the proxy rewrites here) — content-image serving for the public
 * render path. See docs/work-log/2026-08-20-public-sites.md Phase 3,
 * "Component / Page Plan".
 *
 * PURELY PUBLIC, CONTENT-ADDRESSED — no session read, matching
 * `presby_published_site()`'s own anonymous, no-org-GUC contract.
 * `resolveSiteOrganization(key)` is the cheaper sibling of `resolveSite()`
 * (skips the blob fetch + JSON.parse the page itself already did), resolves a
 * slug OR a verified host (host mode requires Host === key) and applies the
 * identical enumeration-safe collapse: a
 * never-provisioned, suspended, nonexistent, flag-off, or DB-read-failure
 * slug all 404 identically, same as the page route (both functions fail
 * closed internally as of docs/work-log/2026-09-26-public-render-blip.md).
 * This route's own `getBlobStore().resolve()` call below gets the same
 * treatment at THIS call site — a second, independent read from the one
 * already fixed inside `getPublishedSite()`.
 *
 * `Cache-Control: public, max-age=31536000, immutable` — content-addressed
 * (the `[key]` IS the row's own uuid `blobAssets.id`, per `blob-store.ts`'s
 * own doc comment on why the key is the row id and not the content hash;
 * either way the bytes behind a given key never change), mirrors
 * DECISION-049's logo-asset reasoning.
 *
 * NEVER REDIRECTS (R6): a content-addressed, immutably-cached asset is the same
 * bytes wherever it is fetched from, and a redirect on it would only add a hop
 * to every image on every page of a site whose slug URL is still linked.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; key: string }> },
): Promise<NextResponse> {
  const { slug: siteKey, key } = await params;

  const org = await resolveSiteOrganization(siteKey);
  if (org.kind !== "ok") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const slug = org.slug;

  // getBlobStore().resolve() has no try/catch of its own by design
  // (blob-store.ts's own header: "does not re-authorize; it trusts" — no
  // stated failure-handling contract) — every caller owns its own wrap.
  // This is a SECOND, independent uncaught call from the one already fixed
  // inside getPublishedSite() itself (docs/work-log/
  // 2026-09-26-public-render-blip.md Phase 1 Gap 2). `key` is an opaque
  // blob-row uuid, not a secret and not SQL — safe to log alongside `slug`.
  let blob: ResolvedBlob | null;
  try {
    blob = await getBlobStore().resolve({
      organizationId: org.organizationId,
      key,
    });
  } catch {
    console.error(
      "[site-assets] blob resolve failed; treating as not found",
      { slug, key },
    );
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
