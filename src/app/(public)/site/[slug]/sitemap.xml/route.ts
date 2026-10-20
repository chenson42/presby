import { NextResponse } from "next/server";
import { resolveSite } from "@/lib/sites";
import { redirectResponse } from "../site-redirect";
import { buildSitemapEntries } from "presby-site-kit";

export const dynamic = "force-dynamic"; // stops Next's build-time placeholder-param prerender trial (params.slug = "-") from reaching a live flag/DB read here at all — docs/work-log/2026-09-26-flags-fail-closed.md Phase 2 Ruling 3

/**
 * `GET /site/<key>/sitemap.xml` (and `GET /sitemap.xml` on a church's own
 * domain, which the proxy rewrites here) — one sitemap per public
 * organization site, not a single platform-wide sitemap.
 * `buildSitemapEntries()` (presby-site-kit) owns which pages belong in it —
 * every page in the bundle, since there is no draft/unpublished state at this
 * layer; `resolveSite()` already gates whether the SITE itself is public
 * before this route is ever reached.
 *
 * The entries are built from the resolved site's `SiteUrls` (DECISION-181), so
 * a custom host lists CLEAN URLs on its own canonical host
 * (`https://church.example/about`), and a platform host lists today's
 * `/site/<slug>/...` ones.
 *
 * The slug URL of an org whose custom host is serving, and a non-canonical
 * alias, answer with a 307 to the canonical host's sitemap (`no-store`, R6):
 * a crawler is told where the sitemap really lives. Same enumeration-safe
 * collapse as every other public-render path here: a never-provisioned,
 * suspended, nonexistent, unknown-host, or flag-off key all 404 identically.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: key } = await params;

  const result = await resolveSite(key);
  if (result.kind === "not_found") {
    return new NextResponse("Not found", { status: 404 });
  }

  const redirect = redirectResponse(result, { path: "/sitemap.xml" });
  if (redirect) return redirect;

  const entries = buildSitemapEntries(result.site.pages, result.urls.origin, result.urls.page);

  const urlset = entries
    .map((entry) => `  <url><loc>${escapeXml(entry.url)}</loc></url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlset}\n</urlset>\n`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

/** `entry.url` is built from `origin` (the verified canonical host or the
 * validated platform origin) + a bundle-relative page path — never content-repo-controlled text — but XML-escaping a URL
 * that will contain `&` (e.g. a query string, however unlikely today) costs
 * nothing and avoids ever emitting invalid XML. */
function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
