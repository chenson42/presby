import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CareersUnavailableNotice } from "@/components/careers/careers-notice";
import type { PlacementInput } from "@/lib/careers/placement";
import { careersBackTarget } from "@/lib/careers/placement";
import { readPublicPosting } from "@/lib/careers/public";
import type { SiteUrls } from "@/lib/site-urls";
import { resolveSite, resolveSiteOrganization } from "@/lib/sites";
import { redirectIfNeeded, toSearchString } from "../../site-redirect";
import { ClosedPostingView, OpenPostingView } from "../posting-view";

/**
 * `/site/<key>/careers/<posting>` (and `/careers/<posting>` on a church's own
 * domain) - one opening. docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Routes";
 * DECISION-264. `[posting]` is a segment name only: the site key is the parent
 * `[slug]`. Everything in `../page.tsx`'s header applies (site key, DB-returned slug,
 * 307 hand-off, `force-dynamic`, no `loading.tsx`, fully anonymous).
 *
 *   read          page
 *   open          the opening: description, "How to apply"
 *   closed        the title and "no longer accepting applications"; `noindex`
 *   failed        the notice, 200, `noindex`
 *   unavailable   notFound()  } the site's one neutral 404, byte-identical: a draft,
 *   not_found     notFound()  } a discarded draft, a malformed, unknown or foreign slug
 *
 * There is NO fall-through to a bundle page: the ingest validator refuses a bundle page
 * below `/careers/`, and the pre-deploy check looks for any that already exist.
 *
 * The "All job openings" link comes from `careersBackTarget` over the published bundle
 * (the first page carrying the slot, else the platform list, else the site home). The
 * bundle is read with the SITE KEY (`resolveSite` is `cache()`d, so this is the
 * layout's own read), which works on both host modes; an unreadable bundle falls back
 * to the platform list.
 */
export const dynamic = "force-dynamic";

async function backTargetFor(key: string, urls: SiteUrls): Promise<string> {
  let input: PlacementInput = { kind: "unknown" };
  try {
    const resolved = await resolveSite(key);
    if (resolved.kind === "ok") {
      input = {
        kind: "known",
        pages: resolved.site.pages.map((page) => ({ path: page.path, mdxAst: page.mdxAst })),
      };
    }
  } catch {
    // Unreadable bundle: fall back to the platform list. Nothing about the error is logged here.
  }
  return careersBackTarget(input, urls);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; posting: string }>;
}): Promise<Metadata> {
  const { slug: key, posting } = await params;
  const org = await resolveSiteOrganization(key);
  if (org.kind !== "ok") return {};

  const read = await readPublicPosting(org.slug, posting);
  if (read.state === "open") {
    return {
      title: { absolute: `${read.posting.title} | ${read.organizationName}` },
      description: read.posting.summary || undefined,
      alternates: { canonical: org.urls.origin + org.urls.careersPosting(read.posting.slug) },
    };
  }
  if (read.state === "closed") {
    return {
      title: { absolute: `${read.title} | ${read.organizationName}` },
      robots: { index: false },
    };
  }
  if (read.state === "failed") {
    return { title: { absolute: "Job openings" }, robots: { index: false } };
  }
  return {};
}

export default async function PublicPostingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; posting: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug: key, posting } = await params;
  const org = await resolveSiteOrganization(key);
  if (org.kind !== "ok") notFound();

  redirectIfNeeded(org, { path: `/careers/${posting}`, search: toSearchString(await searchParams) });

  const read = await readPublicPosting(org.slug, posting);
  if (read.state === "unavailable" || read.state === "not_found") notFound();

  if (read.state === "failed") {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-semibold">Job openings</h1>
        <CareersUnavailableNotice />
      </div>
    );
  }

  const backHref = await backTargetFor(key, org.urls);

  if (read.state === "closed") {
    return (
      <ClosedPostingView
        organizationName={read.organizationName}
        title={read.title}
        urls={org.urls}
        backHref={backHref}
      />
    );
  }

  return (
    <OpenPostingView
      organizationName={read.organizationName}
      contactPhone={read.contactPhone}
      posting={read.posting}
      urls={org.urls}
      backHref={backHref}
    />
  );
}
