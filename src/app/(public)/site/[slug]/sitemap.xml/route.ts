import { NextResponse } from "next/server";
import { getPublishedSite } from "@/lib/sites";
import { buildSitemapEntries } from "presby-site-kit";

/**
 * `GET /site/<slug>/sitemap.xml` — one sitemap per public congregation site,
 * not a single platform-wide sitemap, since each organization's pages only
 * make sense under its own `/site/<slug>` prefix. `buildSitemapEntries()`
 * (presby-site-kit) owns which pages belong in it — every page in the
 * bundle, since there is no draft/unpublished state at this layer;
 * `getPublishedSite()` already gates whether the SITE itself is public
 * before this route is ever reached.
 *
 * Same enumeration-safe collapse as every other public-render path here
 * (`page.tsx`, `assets/[key]/route.ts`): a never-provisioned, suspended,
 * nonexistent, or flag-off slug all 404 identically via `getPublishedSite`
 * returning `{ kind: "not_found" }` — a probe against this route can't
 * distinguish which reason it got.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;

  const result = await getPublishedSite(slug);
  if (result.kind === "not_found") {
    return new NextResponse("Not found", { status: 404 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const pageUrl = (path: string): string => (path === "/" ? `/site/${slug}` : `/site/${slug}${path}`);
  const entries = buildSitemapEntries(result.site.pages, origin, pageUrl);

  const urlset = entries
    .map((entry) => `  <url><loc>${escapeXml(entry.url)}</loc></url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlset}\n</urlset>\n`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

/** `entry.url` is built from `origin` (an env var) + a bundle-relative
 * page path — never content-repo-controlled text — but XML-escaping a URL
 * that will contain `&` (e.g. a query string, however unlikely today) costs
 * nothing and avoids ever emitting invalid XML. */
function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
