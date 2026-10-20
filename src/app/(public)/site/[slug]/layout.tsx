import type { Metadata } from "next";
import { BrandTokens } from "@/components/brand/brand-tokens";
import { resolveSite } from "@/lib/sites";
import { cn } from "@/lib/utils";
import { NEUTRAL_404_METADATA } from "./neutral-metadata";
import "presby-site-kit/styles.css";

export const dynamic = "force-dynamic"; // stops Next's build-time placeholder-param prerender trial (params.slug = "-") from reaching a live flag/DB read here at all — docs/work-log/2026-09-26-flags-fail-closed.md Phase 2 Ruling 3

/**
 * A HOST key that does not resolve (an unclaimed domain, a pending or lapsed or paused one, a
 * toggle that is off, a suspended site) renders the neutral 404 - and its document title must name
 * no product. `not-found.tsx` sets that for the HTML the server sends, but the browser re-applies the
 * matched tree's streamed metadata on hydration and would flip the title to the root layout's
 * "PresbyPortal"; returning the same neutral metadata here, from the layout, puts it in that tree
 * (see `neutral-metadata.ts`). Slug mode is untouched: a miss there can be DECISION-121's presbytery
 * sign-in page, a real 200 that keeps the platform's title. A resolved site returns `{}` and each
 * page sets its own.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: key } = await params;
  const result = await resolveSite(key);
  if (result.kind === "not_found" && result.mode !== "slug") return NEUTRAL_404_METADATA;
  return {};
}

/**
 * `/site/<key>` — the second (previously dormant) `<BrandTokens>` emitter
 * (DECISION-047/052, `scripts/check-brand-scope.mjs`'s `EMITTERS[1]`, flipped
 * to `required: true` in this commit). See
 * docs/work-log/2026-08-20-public-sites.md Phase 3 "Component / Page Plan".
 *
 * A CUSTOM HOST RENDERS HERE TOO (Track F, DECISION-176): `src/proxy.ts`
 * rewrites a church's own domain to `/site/<host>/...`, so this layout, its
 * `<BrandTokens>` emitter and `check-brand-scope.mjs` are unchanged — there is
 * no third brandable group.
 *
 * FULLY ANONYMOUS BY CONSTRUCTION. No `auth()`, no session read, no
 * `getPlatformDb()` — this is the one route family in the tree that never
 * asks "who is this," only "is this org's site live." `resolveSite()`
 * itself collapses every non-live reason (never provisioned, suspended,
 * nonexistent slug, org inactive, the render flag off, a corrupt bundle)
 * into the same `{ kind: "not_found" }`; this layout never branches on which
 * one it got, only on whether a `brand` came back at all — Phase 1 Gap 5's
 * enumeration-safety property, upheld here by never asking the question.
 *
 * CALLS `resolveSite(key)`, which is `cache()`-wrapped: the page, the metadata
 * and the live slots share this one read per request (one definer read plus one
 * blob resolve and JSON parse), so the layout's brand read is free.
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
  // The segment is a SITE KEY (DECISION-176): a slug on a platform host, or a
  // verified host reached only through the proxy's custom-host rewrite.
  const { slug: key } = await params;

  const result = await resolveSite(key);
  const brand = result.kind === "ok" ? result.site.brand : null;

  return (
    <>
      <BrandTokens brand={brand?.tokens ?? null} lightOnly={brand?.lightOnly ?? false} />
      <main
        className={cn(
          "min-h-screen",
          brand?.fontPairing.bodyClassName,
          brand?.fontPairing.pairingClassName,
          brand?.fontPairing.headingVariableClassName,
          brand?.fontPairing.bodyVariableClassName,
        )}
      >
        {children}
      </main>
    </>
  );
}
