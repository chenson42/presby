import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CareersEmptyNotice, CareersUnavailableNotice } from "@/components/careers/careers-notice";
import { CareersList } from "@/components/careers/careers-list";
import { CAREERS_PAGE_PATH } from "@/lib/careers/placement";
import { readPublicCareers } from "@/lib/careers/public";
import { resolveSiteOrganization } from "@/lib/sites";
import { renderSitePage, siteBundleHasPage, siteBundleMetadata } from "../render-site-page";
import { redirectIfNeeded, toSearchString } from "../site-redirect";

/**
 * `/site/<key>/careers` (and `/careers` on a church's own domain, which the proxy
 * rewrites here) - the list of open positions. docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 "Routes"; DECISION-264. A PLATFORM-owned route: the static `careers`
 * segment beats the site's `[[...path]]` catch-all, exactly as `give` does, so a
 * congregation with no site editor still has a list whenever it has turned the
 * toggle on.
 *
 * A BUNDLE'S OWN `/careers` PAGE WINS. The ingest validator refuses only pages BELOW
 * `/careers/`, so a site may author `/careers` itself; this route renders it first,
 * through the catch-all's own render path, and serves the platform list only when the
 * bundle has no such page. (The slug-URL shadow of a bundle page is why the check is
 * needed at all.)
 *
 *   state          bundle has /careers   bundle has no /careers
 *   available      the bundle's page     the list (or the empty notice)
 *   failed         the bundle's page     the notice, 200, noindex
 *   unavailable    the bundle's page     notFound()
 *
 * `unavailable` (toggle off, category off, site not serving, unknown slug) is the
 * site's one neutral 404, byte-identical for every cause: a toggle-off church must
 * not publish a "/careers" page that says "unavailable" (Phase 2 G8, D4). A FAILED
 * read is different: it says nothing about the organization, so it must not 404 a
 * real page - it is a `noindex` notice (D4).
 *
 * THE SEGMENT IS A SITE KEY (Track F, DECISION-176). `resolveSiteOrganization(key)`
 * returns the organization's slug AS THE DATABASE RETURNED IT and the `SiteUrls`;
 * every read below uses that slug and nothing the visitor typed. Like `give`, the slug
 * URL of an org whose custom host is serving 307s to the canonical host. DECISION-121's
 * presbytery sign-in fallback is OFF here (`presbyteryFallback: false`).
 *
 * `force-dynamic` (the site layout is too) is what makes an unpublish take effect on
 * the next request - there is no cache between the page and the definer. No
 * `loading.tsx`: the segment may 404 and a Suspense boundary would flush a 200 first
 * (CLAUDE.md, The (org) contract). The page is fully anonymous: no `auth()`, no
 * `getPlatformDb()`, no `dangerouslySetInnerHTML`, no cookie.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: key } = await params;
  const org = await resolveSiteOrganization(key);
  if (org.kind !== "ok") return {};

  if (await siteBundleHasPage(key, CAREERS_PAGE_PATH)) return siteBundleMetadata(key, CAREERS_PAGE_PATH);

  const careers = await readPublicCareers(org.slug);
  if (careers.state === "available") {
    return {
      title: { absolute: `Job openings | ${careers.organizationName}` },
      alternates: { canonical: org.urls.origin + org.urls.careers() },
    };
  }
  if (careers.state === "failed") {
    return { title: { absolute: "Job openings" }, robots: { index: false } };
  }
  return {};
}

export default async function PublicCareersPage({
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

  redirectIfNeeded(org, { path: CAREERS_PAGE_PATH, search: toSearchString(await searchParams) });

  const site = await renderSitePage(key, CAREERS_PAGE_PATH, { presbyteryFallback: false });
  if (site.kind === "page") return site.node;

  const careers = await readPublicCareers(org.slug);
  if (careers.state === "unavailable") notFound();

  if (careers.state === "failed") {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-semibold">Job openings</h1>
        <CareersUnavailableNotice />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <a
        href={org.urls.home()}
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="mr-1 size-4" aria-hidden />
        Back to {careers.organizationName}
      </a>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Job openings</h1>
        <p className="text-base text-muted-foreground [overflow-wrap:anywhere]">{careers.organizationName}</p>
      </header>
      {careers.postings.length === 0 ? (
        <CareersEmptyNotice contactPhone={careers.contactPhone} />
      ) : (
        <CareersList postings={careers.postings} urls={org.urls} />
      )}
    </div>
  );
}
