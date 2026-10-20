import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveSite } from "@/lib/sites";
import { renderSitePage, siteBundleMetadata } from "../render-site-page";
import { redirectIfNeeded, toSearchString } from "../site-redirect";

/**
 * `/site/<key>` and `/site/<key>/<...path>` - the public render path. The work
 * lives in `../render-site-page.tsx` (extracted so `/site/<key>/give` can fall
 * through to a bundle's own `/give` page through the SAME code); see its header
 * for the full description, DECISION-121's presbytery fallback, and the
 * enumeration-safety notes (docs/work-log/2026-08-20-public-sites.md,
 * 2026-08-21-public-site-org-profile.md, 2026-09-26-public-render-blip.md).
 *
 * THE `[slug]` SEGMENT IS A SITE KEY (Track F, DECISION-176): a slug on a
 * platform host, or a verified custom host reached only through the proxy's
 * rewrite (`/about` on a church's domain arrives here as
 * `/site/<host>/about`). `resolveSite()` classifies it, checks it against the
 * request Host, and does the one database read.
 *
 * This file is only the route adapter: it turns the optional catch-all `path`
 * into the bundle's own `currentPath`, hands off with a 307 when the resolver
 * says this URL is not the canonical one (the slug URL of an org whose custom
 * host is serving; a non-canonical alias - DECISION-178), and turns a `miss`
 * into Next's real `notFound()` - the one collapse for "no site", "suspended",
 * "flag off", "unknown host" and "no page at this path".
 */
function toCurrentPath(path: string[] | undefined): string {
  return path && path.length > 0 ? `/${path.join("/")}` : "/";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}): Promise<Metadata> {
  const { slug: key, path } = await params;
  return siteBundleMetadata(key, toCurrentPath(path));
}

export default async function PublicSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug: key, path } = await params;
  const currentPath = toCurrentPath(path);

  // 307 (never 301/308) to the canonical host, keeping path and query. Resolved
  // before rendering anything; `resolveSite` is cache()d, so this is not a
  // second read. A miss has no redirect target and falls through to notFound().
  const resolved = await resolveSite(key);
  if (resolved.kind === "ok") {
    redirectIfNeeded(resolved, { path: currentPath, search: toSearchString(await searchParams) });
  }

  const result = await renderSitePage(key, currentPath);
  if (result.kind === "miss") notFound();
  return result.node;
}
