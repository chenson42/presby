import { NextResponse } from "next/server";
import { resolveSiteOrganization } from "@/lib/sites";
import { redirectResponse } from "../site-redirect";

export const dynamic = "force-dynamic"; // see sitemap.xml/route.ts: no build-time prerender of a live flag/DB read

/**
 * `GET /robots.txt` ON A CHURCH'S OWN DOMAIN (the proxy rewrites it to
 * `/site/<host>/robots.txt`). Phase 2 R6, G8, DECISION-178.
 *
 * WHY A NEW ROUTE. `src/app/robots.ts` says `Allow: /site/` and `Disallow: /`,
 * which is right for the platform (everything but the public sites stays out of
 * search) and exactly wrong for a church's domain, where the site lives at the
 * clean paths `/about`, `/give`, ... and `Disallow: /` would de-index it. So
 * the platform file is UNCHANGED, and this route answers instead, in HOST MODE
 * ONLY:
 *
 *   canonical host  `User-agent: *` / `Allow: /` / `Sitemap: https://<host>/sitemap.xml`
 *   alias host      307 (`no-store`) to the canonical host's robots.txt
 *   slug mode       404 - on a platform host `/site/<slug>/robots.txt` is not a thing; the
 *                   platform's own robots.ts is the one robots file there
 *   anything else   the same neutral 404 as every other non-serving state
 *
 * The sitemap line names the canonical host from the database row (`SiteUrls`),
 * never the request Host (R3). It is the light resolver: no bundle fetch.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: key } = await params;

  const org = await resolveSiteOrganization(key);
  if (org.kind !== "ok" || org.mode !== "host") {
    return new NextResponse("Not found", { status: 404 });
  }

  const redirect = redirectResponse(org, { path: "/robots.txt" });
  if (redirect) return redirect;

  const body = `User-agent: *\nAllow: /\n\nSitemap: ${org.urls.origin}${org.urls.sitemap()}\n`;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
