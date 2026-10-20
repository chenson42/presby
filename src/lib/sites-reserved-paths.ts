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
 * `/giving`, `/give-now` and `/forgive` are NOT reserved: only the exact
 * segment `give` (and its descendants) is shadowed.
 *
 * The comparison is deliberately forgiving about SHAPE (a missing leading
 * slash, repeated or trailing slashes, `.` segments, case, a percent-encoded
 * name) so that a path that would be routed to the give page by any reasonable
 * reading is refused, rather than the check being defeated by punctuation.
 */

/** Segment names the platform serves itself under `/site/<slug>/`. */
export const RESERVED_SITE_SEGMENTS = ["give"] as const;

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
