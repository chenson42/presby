import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SpotTheScamFrame } from "@/components/learn/spot-the-scam-frame";
import { SpotTheScamUnavailableNotice } from "@/components/learn/learn-notices";
import { SPOT_THE_SCAM_FEATURE_KEY, SPOT_THE_SCAM_PAGE_PATH } from "@/lib/learn/contract";
import { readPublicLearn } from "@/lib/learn/public";
import { FRAME } from "@/lib/learn/spot-the-scam/copy";
import { resolveSiteOrganization } from "@/lib/sites";
import { renderSitePage, siteBundleHasPage, siteBundleMetadata } from "../../render-site-page";
import { redirectIfNeeded, toSearchString } from "../../site-redirect";

/**
 * `/site/<key>/learn/spot-the-scam` (and `/learn/spot-the-scam` on a church's own domain,
 * which the proxy rewrites here) - the Spot the scam practice. docs/work-log/
 * 2026-11-10-learn-inc1a.md, Phase 3 "API Contract"; DECISION-332. A PLATFORM-owned
 * route: the static `learn/spot-the-scam` segments beat the site's `[[...path]]`
 * catch-all, exactly as `careers` does, so an organization with no site editor still has
 * the page whenever it has turned the toggle on. This is the careers route line for line.
 *
 * ONLY `/learn/spot-the-scam` IS PLATFORM TERRITORY. `/learn` and every other `/learn/...`
 * path stay the bundle's (no ingest reservation, no `learn/page.tsx`, no `[param]`): a
 * synod-site recreation authors them. `boundaries.test.ts` pins the directory shape.
 *
 * A BUNDLE'S OWN PAGE AT EXACTLY THIS PATH WINS. This route renders it first, through the
 * catch-all's own render path, and serves the platform page only when the bundle has none.
 *
 *   state          bundle has the path    bundle has no such page
 *   available      the bundle's page      the practice
 *   failed         the bundle's page      the notice, 200, noindex
 *   unavailable    the bundle's page      notFound()
 *
 * `unavailable` (toggle off, category off, site not serving, unknown slug) is the site's
 * one neutral 404, byte-identical for every cause (DECISION-040, DECISION-154). A FAILED
 * read says nothing about the organization, so it must not 404 a real page: it is a
 * `noindex` notice. The AVAILABLE page IS indexed (operator ruling 2026-11-11: harmless
 * public teaching a council wants found); the `failed` notice and the (org) page are not.
 *
 * THE SEGMENT IS A SITE KEY (Track F, DECISION-176). `resolveSiteOrganization(key)` returns
 * the organization's slug AS THE DATABASE RETURNED IT and the `SiteUrls`; every read and
 * every URL below uses those and nothing the visitor typed. Like `give`, the slug URL of an
 * org whose custom host is serving 307s to the canonical host. DECISION-121's presbytery
 * sign-in fallback is OFF here. `force-dynamic` (the site layout is too) is what makes a
 * toggle change take effect on the next request. No `loading.tsx`: the segment may 404 and a
 * Suspense boundary would flush a 200 first. Fully anonymous: no `auth()`, no
 * `getPlatformDb()`, no cookie, no `next`/`callbackUrl`/`redirect` parameter.
 */
export const dynamic = "force-dynamic";

// F439: iOS auto-links phone-, date-, address- and email-shaped text. The practice has no
// phone number or date (content.test.ts), but the sender addresses are email-shaped.
const NO_DETECTION: Metadata["formatDetection"] = { telephone: false, date: false, address: false, email: false };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: key } = await params;
  const org = await resolveSiteOrganization(key);
  if (org.kind !== "ok") return {};

  if (await siteBundleHasPage(key, SPOT_THE_SCAM_PAGE_PATH)) return siteBundleMetadata(key, SPOT_THE_SCAM_PAGE_PATH);

  const learn = await readPublicLearn(org.slug, SPOT_THE_SCAM_FEATURE_KEY);
  if (learn.state === "available") {
    return {
      title: { absolute: FRAME.title(org.row.organization_name) },
      alternates: { canonical: org.urls.origin + org.urls.spotTheScam() },
      robots: { index: true, follow: true },
      formatDetection: NO_DETECTION,
    };
  }
  if (learn.state === "failed") {
    return { title: { absolute: FRAME.heading }, robots: { index: false } };
  }
  return {};
}

export default async function PublicSpotTheScamPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug: key } = await params;
  const org = await resolveSiteOrganization(key);
  // Anything but `ok` (no site, not live, flag off, unknown host) is the one neutral 404.
  if (org.kind !== "ok") notFound();

  redirectIfNeeded(org, { path: SPOT_THE_SCAM_PAGE_PATH, search: toSearchString(await searchParams) });

  const site = await renderSitePage(key, SPOT_THE_SCAM_PAGE_PATH, { presbyteryFallback: false });
  if (site.kind === "page") return site.node;

  const learn = await readPublicLearn(org.slug, SPOT_THE_SCAM_FEATURE_KEY);
  if (learn.state === "unavailable") notFound();

  if (learn.state === "failed") {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-semibold">{FRAME.heading}</h1>
        <SpotTheScamUnavailableNotice />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <a
        href={org.urls.home()}
        className="inline-flex min-h-11 items-center text-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background print:hidden [overflow-wrap:anywhere]"
      >
        <ArrowLeft className="mr-1 size-5 shrink-0" aria-hidden />
        {FRAME.backTo(org.row.organization_name)}
      </a>
      <h1 className="text-3xl font-semibold">{FRAME.heading}</h1>
      <SpotTheScamFrame />
    </div>
  );
}
