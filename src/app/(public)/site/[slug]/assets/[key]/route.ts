import { NextResponse } from "next/server";
import { resolveSiteOrganization } from "@/lib/sites";
import { getBlobStore, type PublicAsset } from "@/lib/storage/blob-store";
import { parseBlobKey } from "@/lib/storage/blob-key";

export const dynamic = "force-dynamic"; // stops Next's build-time placeholder-param prerender trial (params.slug = "-") from reaching a live flag/DB read here at all — docs/work-log/2026-09-26-flags-fail-closed.md Phase 2 Ruling 3

/**
 * `GET /site/<key>/assets/[key]` (and `GET /assets/[key]` on a church's own
 * domain, which the proxy rewrites here) — image serving for the public render
 * path. See docs/work-log/2026-08-20-public-sites.md Phase 3, "Component /
 * Page Plan", and docs/work-log/2026-10-25-public-asset-allowlist.md
 * (F289, DECISION-277) for the allowlist this route now enforces.
 *
 * WHAT IT SERVES, AND WHAT IT NEVER DOES. This route is NOT a generic
 * "resolve any blob key for the org" door (it was, until F289: a statement
 * PDF, a ticket screenshot, the content bundle or an unlisted person's photo
 * was fetchable by anyone holding the uuid, cached for a year). It asks ONE
 * question of ONE database function, `getBlobStore().resolvePublic()` ->
 * `presby_public_site_asset(org, key)`, which serves:
 *   - a `public_site` image (a published page image or the brand mark), or
 *   - the photo of a person a public roster function currently lists
 *     (class `roster`, never `site`),
 * as png/jpeg/webp only, and returns nothing else. The route holds no
 * predicate of its own; the database decides.
 *
 * PURELY PUBLIC — no session read, matching `presby_published_site()`'s own
 * anonymous, no-org-GUC contract. `resolveSiteOrganization(key)` is the
 * cheaper sibling of `resolveSite()` (skips the blob fetch + JSON.parse the
 * page itself already did), resolves a slug OR a verified host (host mode
 * requires Host === key) and applies the identical enumeration-safe collapse:
 * a never-provisioned, suspended, nonexistent, flag-off, or DB-read-failure
 * slug all 404 identically, same as the page route (both functions fail
 * closed internally as of docs/work-log/2026-09-26-public-render-blip.md).
 * The org id the asset door is asked about is the one that resolver returned,
 * never the request's host or slug, so slug mode and host mode cannot diverge.
 *
 * ORDER (R7): validate the key (a hyphenated uuid, case-insensitive,
 * lowercased: anything else is the neutral 404 with NO read and NO
 * `console.error`), then the site, then the asset.
 *
 * ONE NEUTRAL 404 (DECISION-040). Every miss — a malformed key, a site that
 * does not resolve, a flag that is off, a database error, a key that is not
 * public, one that does not exist, another org's — is the SAME response: status,
 * body bytes and header set, `Cache-Control: no-store` (a shared cache must
 * never hold a 404 against a key that later becomes public). Which keys exist,
 * and why one is not served, is not observable.
 *
 * CACHING, BY CLASS. `site`: `public, max-age=31536000, immutable` — the key is
 * the row's own uuid, the bytes behind it never change, and the content was
 * published by design (a brand mark, a page image; mirrors DECISION-049's
 * logo-asset reasoning). Tier 1 has no takedown: a `public_site` image stays
 * fetchable by its uuid after it drops out of a bundle (a tracked follow-up).
 * `roster`: `private, max-age=86400` — a person's photo is personal data tied to
 * a revocable opt-in (listing, `hide_photo`), so a day, and `private` so a
 * shared cache does not keep it after they are un-listed. Copies already in a
 * browser, search engine or archive cannot be recalled.
 *
 * NEVER REDIRECTS (R6): a content-addressed, cached asset is the same bytes
 * wherever it is fetched from, and a redirect on it would only add a hop to
 * every image on every page of a site whose slug URL is still linked.
 */

/** The one miss. A fresh response each time (a Response body can be read once). */
function notFound(): NextResponse {
  return new NextResponse(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const CACHE_CONTROL: Record<PublicAsset["cacheClass"], string> = {
  site: "public, max-age=31536000, immutable",
  roster: "private, max-age=86400",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; key: string }> },
): Promise<NextResponse> {
  const { slug: siteKey, key: rawKey } = await params;

  // 1. The key, before any read of any kind.
  const key = parseBlobKey(rawKey);
  if (key === null) return notFound();

  // 2. The site.
  const org = await resolveSiteOrganization(siteKey);
  if (org.kind !== "ok") return notFound();
  const { mode, slug } = org;

  // 3. The asset. `resolvePublic()` has no try/catch of its own by design
  // (blob-store.ts: every caller owns its own wrap). `key` is an opaque
  // blob-row uuid, not a secret and not SQL — safe to log alongside the mode
  // and slug; the caught error and its message are NEVER logged (Neon/Drizzle's
  // message embeds the failed SQL text and bound params).
  let asset: PublicAsset | null;
  try {
    asset = await getBlobStore().resolvePublic({
      organizationId: org.organizationId,
      key,
    });
  } catch {
    console.error(
      "[site-assets] public asset read failed; treating as not found",
      { mode, slug, key },
    );
    return notFound();
  }
  if (!asset) return notFound();

  return new NextResponse(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": CACHE_CONTROL[asset.cacheClass],
      "X-Content-Type-Options": "nosniff",
    },
  });
}
