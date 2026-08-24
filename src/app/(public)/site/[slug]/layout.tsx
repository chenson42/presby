import { BrandTokens } from "@/components/brand/brand-tokens";
import { getPublishedSite } from "@/lib/sites";
import { cn } from "@/lib/utils";
import "presby-site-kit/styles.css";

/**
 * `/site/<slug>` — the second (previously dormant) `<BrandTokens>` emitter
 * (DECISION-047/052, `scripts/check-brand-scope.mjs`'s `EMITTERS[1]`, flipped
 * to `required: true` in this commit). See
 * docs/work-log/2026-08-20-public-sites.md Phase 3 "Component / Page Plan".
 *
 * FULLY ANONYMOUS BY CONSTRUCTION. No `auth()`, no session read, no
 * `getPlatformDb()` — this is the one route family in the tree that never
 * asks "who is this," only "is this org's site live." `getPublishedSite()`
 * itself collapses every non-live reason (never provisioned, suspended,
 * nonexistent slug, org inactive, the render flag off, a corrupt bundle)
 * into the same `{ kind: "not_found" }`; this layout never branches on which
 * one it got, only on whether a `brand` came back at all — Phase 1 Gap 5's
 * enumeration-safety property, upheld here by never asking the question.
 *
 * CALLS `getPublishedSite(slug)` A SECOND TIME, independently of
 * `page.tsx`'s own call — an accepted redundancy for v1, matching
 * `(org)/o/[slug]/layout.tsx`'s own precedent of an independent brand read
 * next to `page.tsx`'s independent gate. Unlike `getOrgBrandForLayout`, this
 * function is not `cache()`-wrapped (no personId/organizationId pair to key
 * on that would be cheaper than the slug itself), so this is a second real
 * query, not a free second call within one render pass. Accepted per Phase 3
 * ("a cheaper brand-only variant... accepted redundancy for v1") — the whole
 * page is one blob resolve plus a JSON parse, not a hot path.
 *
 * NULL RENDERS NULL, same discipline as `<BrandTokens>` itself: a site with
 * no brand row, `ui.brand_theming` off, or a not-found site all leave
 * `brand` at `null`, and `<BrandTokens brand={null} />` emits nothing — the
 * page falls back to the platform palette rather than crashing or
 * redirecting. `page.tsx` is what actually 404s a not-found slug; this
 * layout never gates on it.
 *
 * No `<html>`/`<body>` — nests under the root layout exactly as
 * `(org)/o/[slug]/layout.tsx` does. No `loading.tsx` on this segment or
 * `page.tsx` (CLAUDE.md → the (org) contract: a segment whose job may be to
 * 404 must not open a Suspense boundary, or Next flushes a 200 before the
 * page resolves).
 */
export default async function PublicSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const result = await getPublishedSite(slug);
  const brand = result.kind === "ok" ? result.site.brand : null;

  return (
    <>
      <BrandTokens brand={brand?.tokens ?? null} />
      <main className={cn("min-h-screen", brand?.fontPairing.bodyClassName)}>
        {children}
      </main>
    </>
  );
}
