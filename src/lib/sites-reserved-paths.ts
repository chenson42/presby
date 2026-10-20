/**
 * Paths a site bundle may not claim - pure, dependency-free, safe anywhere.
 *
 * PresbyPortal serves its own giving page at `/site/<slug>/give` and its
 * Checkout return page at `/site/<slug>/give/return` (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 4). Those are STATIC route segments, and a
 * static segment beats the catch-all `[[...path]]` that renders bundle pages, so
 * a bundle page authored at `/give` or anywhere beneath it would be ingested,
 * stored, and then silently never shown. The ingest route refuses such a bundle
 * up front, with a message the site author can act on, instead.
 *
 * `/giving`, `/give-now`, `/forgive` and `/assets-gallery` are NOT reserved: only
 * the exact segments named below (and their descendants) are shadowed.
 *
 * The comparison is deliberately forgiving about SHAPE (a missing leading
 * slash, repeated or trailing slashes, `.` segments, case, a percent-encoded
 * name) so that a path that would be routed to the give page by any reasonable
 * reading is refused, rather than the check being defeated by punctuation.
 */

/**
 * Segment names the platform serves itself under `/site/<slug>/` - and, since
 * Track F, at the root of a church's own domain, where the same routes live at
 * CLEAN paths (`/give`, `/assets/<key>`, `/robots.txt`, `/sitemap.xml`). Each is a
 * static route that beats the bundle catch-all, so a bundle page authored at one
 * would be ingested, stored and never shown (T15).
 *
 * The three added to `give` are exactly the ones that actually shadow a bundle
 * page: `assets` (the blob route), `robots.txt` (host-mode robots) and
 * `sitemap.xml`. Nothing else is reserved: `/api`, `/_next` and `/site` need no
 * entry here - on a custom host they are rewritten into bundle-path space and
 * simply 404, and a bundle page at one of them is just unreachable, not shadowed.
 */
export const RESERVED_SITE_SEGMENTS = ["give", "assets", "robots.txt", "sitemap.xml"] as const;

function decodeOnce(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** True when a bundle page at `path` would be shadowed by a platform-served route. */
export function reservedSitePath(path: string): { reserved: true; segment: string } | { reserved: false } {
  if (typeof path !== "string") return { reserved: false };
  const normalized = decodeOnce(path.trim()).replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/").filter((s) => s !== "" && s !== ".");
  const first = segments[0];
  if (first && (RESERVED_SITE_SEGMENTS as readonly string[]).includes(first)) {
    return { reserved: true, segment: first };
  }
  return { reserved: false };
}
