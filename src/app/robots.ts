import type { MetadataRoute } from "next";

/**
 * The platform shell (`(admin)`, `(org)`'s own login-gated pages, `/launch`,
 * `/home`, etc.) stays disallowed — the root layout's own `metadata.robots`
 * (`src/app/layout.tsx`, `{ index: false, follow: false }`) already says as
 * much for the platform's own pages, and this is that same "pre-release"
 * posture expressed at the crawler-directive layer.
 *
 * `/site/` is the one carve-out: a real congregation's public website
 * absolutely should be crawlable regardless of presby-the-platform's own
 * launch status — `Allow: /site/` is more specific than `Disallow: /` (the
 * standard robots.txt most-specific-path-wins rule), so it wins for
 * anything under that prefix without needing to enumerate every other
 * disallowed path individually. The per-page `<meta name="robots">`
 * (`generateMetadata` in `(public)/site/[slug]/[[...path]]/page.tsx`, via
 * presby-site-kit's `buildPageMetadata()`) is the second, page-level half
 * of this — this file is the site-wide crawler entry point, not a
 * duplicate of that logic.
 *
 * No `sitemap` field here: there is no single platform-wide sitemap, only
 * one per organization (`/site/<slug>/sitemap.xml`) — a crawler discovers
 * those by starting from each organization's own public site, not from
 * this file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/site/", disallow: "/" }],
  };
}
