import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { renderSitePage, siteBundleMetadata } from "../render-site-page";

/**
 * `/site/<slug>` and `/site/<slug>/<...path>` - the public render path. The work
 * lives in `../render-site-page.tsx` (extracted so `/site/<slug>/give` can fall
 * through to a bundle's own `/give` page through the SAME code); see its header
 * for the full description, DECISION-121's presbytery fallback, and the
 * enumeration-safety notes (docs/work-log/2026-08-20-public-sites.md,
 * 2026-08-21-public-site-org-profile.md, 2026-09-26-public-render-blip.md).
 *
 * This file is only the route adapter: it turns the optional catch-all `path`
 * into the bundle's own `currentPath`, and turns a `miss` into Next's real
 * `notFound()` - the one collapse for "no site", "suspended", "flag off" and "no
 * page at this path".
 */
function toCurrentPath(path: string[] | undefined): string {
  return path && path.length > 0 ? `/${path.join("/")}` : "/";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}): Promise<Metadata> {
  const { slug, path } = await params;
  return siteBundleMetadata(slug, toCurrentPath(path));
}

export default async function PublicSitePage({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}) {
  const { slug, path } = await params;
  const result = await renderSitePage(slug, toCurrentPath(path));
  if (result.kind === "miss") notFound();
  return result.node;
}
