import { notFound } from "next/navigation";
import { getPublishedSite, type PublishedSite } from "@/lib/sites";
import { renderSiteBundle, type RenderSiteBundleProfile, type SocialLink } from "presby-site-kit";
import { ContactForm } from "./contact-form";

/**
 * `PublishedSite.profile.social` is a keyed object (one nullable string per
 * named platform, matching `organization_profiles`' own fixed columns —
 * DECISION for the org-profile pipeline, docs/work-log/2026-08-21-public-
 * site-org-profile.md). `presby-site-kit`'s `RenderSiteBundleProfile.
 * socialLinks` wants an array of only the platforms actually set. This is
 * the one shape translation between the two — everything else on
 * `PublishedSite` already matches site-kit's types field-for-field
 * (`serviceTimes`/`officeHours` are `OrgServiceTimeEntry[]` on one side and
 * `ScheduleEntry[]` on the other, structurally identical).
 */
function toRenderProfile(site: PublishedSite): RenderSiteBundleProfile {
  const social = site.profile.social;
  const socialLinks: SocialLink[] = (
    [
      ["facebook", social.facebook],
      ["instagram", social.instagram],
      ["xTwitter", social.xTwitter],
      ["youtube", social.youtube],
      ["other", social.other],
    ] as const
  )
    .filter((entry): entry is [SocialLink["platform"], string] => entry[1] !== null)
    .map(([platform, url]) => ({ platform, url }));

  return {
    address: site.profile.address,
    phone: site.profile.phone,
    socialLinks,
    serviceTimes: site.serviceTimes,
    officeHours: site.officeHours,
  };
}

/**
 * `/site/<slug>` — the public render path. See
 * docs/work-log/2026-08-20-public-sites.md Phase 3, "Component / Page Plan".
 *
 * `getPublishedSite()` ALREADY checks `sites.public_render` internally and
 * collapses the flag being off into the same `{ kind: "not_found" }` as
 * every other miss case — this page does not re-check the flag itself, it
 * simply trusts that result, matching the enumeration-safety property
 * Phase 1 Gap 5 requires (a probe cannot distinguish "flag off" from
 * "never provisioned" from "suspended").
 *
 * v1 SHIPS A SINGLE TOP-LEVEL PAGE PER SLUG (Phase 3's own scoping) —
 * `currentPath` is always `"/"`. A `[...path]` catch-all for real
 * sub-routing (`/site/<slug>/about`, etc.) is a named, deferred follow-on,
 * not built here.
 *
 * `imageUrl` NEVER hands `site-kit` a raw blob key or bytes — it builds a
 * same-origin, content-addressed URL through this route's own asset route
 * (`assets/[key]/route.ts`). `site.imageKeys` is the manifestKey -> blobKey
 * map `recordSiteIngest()` stores (see `src/lib/sites.ts`'s own doc comment
 * on `PublishedSite.imageKeys` for why this field exists beyond Phase 3's
 * literal interface). A manifestKey with no entry in that map falls back to
 * the manifestKey itself, which the asset route then fails to resolve as a
 * blob id — a broken image, never a crash.
 */
export default async function PublicSitePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const result = await getPublishedSite(slug);
  if (result.kind === "not_found") notFound();

  const { site } = result;

  const imageUrl = (manifestKey: string): string =>
    `/site/${slug}/assets/${site.imageKeys[manifestKey] ?? manifestKey}`;

  const rendered = renderSiteBundle({
    pages: site.pages,
    currentPath: "/",
    brand: site.brand,
    profile: toRenderProfile(site),
    imageUrl,
  });

  // renderSiteBundle() returning null means no page in the bundle matches
  // currentPath — the same "nothing here" outcome as every other miss case,
  // not a distinguishable error.
  if (!rendered) notFound();

  // No separate flag re-check here: reaching this point already means
  // getPublishedSite() found the flag on (it's one of the reasons a
  // not_found collapse happens above) — re-checking would be a second,
  // redundant call for a fact already established.
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {rendered}

      <section className="mt-16 border-t border-border pt-10">
        <h2 className="text-xl font-semibold">Contact {site.organizationName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Send a message and someone will follow up.
        </p>
        <div className="mt-4 max-w-md">
          <ContactForm slug={slug} />
        </div>
      </section>
    </div>
  );
}
