import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedSite, type PublishedSite } from "@/lib/sites";
import { publicOrgSummary } from "@/lib/authz";
import {
  buildPageMetadata,
  renderSiteBundle,
  type RenderSiteBundleProfile,
  type SocialLink,
} from "presby-site-kit";
import { ContactForm } from "../contact-form";
import { PresbyteryFallback } from "../presbytery-fallback";
import { PublicStaffDirectory } from "../staff-directory";
import { PublicCommitteeDirectory } from "../committee-directory";

/**
 * DECISION-121 — org types that get the minimal sign-in fallback instead of
 * the untouched `notFound()` collapse, on `getPublishedSite()`'s `not_found`
 * branch only (never on `renderSiteBundle()` returning null — that means a
 * site DOES exist but this particular sub-path doesn't, a real 404
 * regardless of org type). A congregation is never in this list: its
 * `platformStatus` is the fact DECISION-040's enumeration-safe collapse
 * protects, and `publicOrgSummary()` deliberately cannot see it — but
 * organizationType alone leaks nothing a congregation's own miss response
 * doesn't already leak identically to every other congregation.
 */
const FALLBACK_ORG_TYPES = new Set(["presbytery", "synod", "general_assembly"]);

/**
 * Origin only (scheme + host, no trailing slash) — the same
 * `NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"` pattern already
 * established for email links (`src/lib/email/send.ts`) and password-reset/
 * account links, reused here for `presby-site-kit`'s `origin` input
 * (`buildPageMetadata`/the JSON-LD `buildOrganizationJsonLd` it composes
 * both need an absolute URL, which nothing else on this route otherwise
 * needs).
 */
function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * A member area reached the same way any other page is, from inside a nav
 * group, is the real pattern presby's own recreation of a real congregation
 * site (First Presbyterian Church of Westerville) found: its "Connect" nav
 * group's own "Our Directory" entry is what points to a member-only area,
 * not a separate standalone login link. Applied unconditionally (every
 * organization gets this, not just the one it was found on) as a
 * deliberate, named simplification — a "Connect"-style group is a
 * reasonable default shape for a congregation site in general, and an org
 * with no existing "Connect" group just gets one created with this single
 * entry, which degrades gracefully rather than breaking. True per-org
 * configurability (which group, whether to group at all, a custom label)
 * is real future work — see docs/TODO.md.
 */
const PORTAL_NAV_GROUP = "Connect";
const PORTAL_LABEL = "Our Directory";
/** Slots the portal entry into the content's own navOrder sequence — fpcw's
 * real menu places "Our Directory" mid-group (between "Our Newsletter" at
 * 22 and "Upcoming Events" at 24), not trailing the group. Same
 * named-simplification status as PORTAL_NAV_GROUP above: one platform-wide
 * value for now, per-org configurability is the tracked follow-up. */
const PORTAL_NAV_ORDER = 23;

/**
 * Resolves the organization's brand mark to a same-origin, content-
 * addressed URL through the existing `/site/<slug>/assets/[key]` route —
 * that route is generic (resolves any blob key for the org, not scoped to
 * the content bundle's own `imageKeys` map), so no new asset route is
 * needed. `organizationBrands` has no public grant of its own, but
 * `markAssetKey` itself carries no sensitive information (the same
 * platform-set mark already renders on `(org)`'s own admin-facing pages)
 * — reading it via `getPlatformDb()` here is a narrow, read-only lookup of
 * one non-sensitive column, not a bypass of anything RLS protects. A
 * missing key or brand row degrades to `null` — same discipline as every
 * other org-supplied piece of this page (`brand`, `profile`).
 *
 * Dynamically imported, deliberately not a static top-level import — the
 * same reasoning `src/lib/sites.ts`'s own `getPublishedSite()` documents
 * for `resolveTypePairing()`: `@/lib/db`'s module-scope pool construction
 * runs at import time, which crashes any test file that doesn't mock it
 * (confirmed: `page.test.tsx` mocks `@/lib/sites` and `presby-site-kit`
 * but never had reason to mock `@/lib/db` before this page had no direct
 * dependency on it). Deferred to exactly the one call site that needs it.
 */
async function resolveLogoUrl(organizationId: string, slug: string): Promise<string | null> {
  const { getPlatformDb } = await import("@/lib/db");
  const { organizationBrands } = await import("@/lib/db/domain/org");
  const { eq } = await import("drizzle-orm");
  const platformDb = getPlatformDb();
  const [brand] = await platformDb
    .select({ markAssetKey: organizationBrands.markAssetKey })
    .from(organizationBrands)
    .where(eq(organizationBrands.organizationId, organizationId))
    .limit(1);
  if (!brand?.markAssetKey) return null;
  return `/site/${slug}/assets/${brand.markAssetKey}`;
}

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
 * `/site/<slug>` and `/site/<slug>/<...path>` — the public render path. See
 * docs/work-log/2026-08-20-public-sites.md Phase 3, "Component / Page Plan",
 * and docs/work-log/2026-08-21-public-site-org-profile.md for the follow-on
 * that added real sub-routing (this file's own optional catch-all segment,
 * `[[...path]]`) — Phase 3 originally scoped this to a single top-level page
 * per slug and named the catch-all as a deferred follow-on; this is it.
 *
 * `getPublishedSite()` ALREADY checks `sites.public_render` internally and
 * collapses the flag being off into the same `{ kind: "not_found" }` as
 * every other miss case — this page does not re-check the flag itself, it
 * simply trusts that result, matching the enumeration-safety property
 * Phase 1 Gap 5 requires (a probe cannot distinguish "flag off" from
 * "never provisioned" from "suspended"). `renderSiteBundle()` returning
 * `null` (no bundle page matches `currentPath`) is the SAME `notFound()` —
 * a congregation that never authored `/about` 404s there exactly like a
 * nonexistent slug does, not a distinguishable error.
 *
 * `imageUrl` NEVER hands `site-kit` a raw blob key or bytes — it builds a
 * same-origin, content-addressed URL through this route's own asset route
 * (`assets/[key]/route.ts`). `site.imageKeys` is the manifestKey -> blobKey
 * map `recordSiteIngest()` stores (see `src/lib/sites.ts`'s own doc comment
 * on `PublishedSite.imageKeys` for why this field exists beyond Phase 3's
 * literal interface). A manifestKey with no entry in that map falls back to
 * the manifestKey itself, which the asset route then fails to resolve as a
 * blob id — a broken image, never a crash.
 *
 * `pageUrl` is the same closure discipline as `imageUrl` — `site-kit`'s
 * `Nav` never assumes a `/site/<slug>` prefix, this route is the one place
 * that knows it. `portalUrl` points at `/o/<slug>` — the `(org)` route
 * group's own Edge gate (`src/proxy.ts`) already redirects an
 * unauthenticated visit there to `/signin` with the right `callbackUrl`, so
 * this route needs no auth-awareness of its own to wire the link correctly
 * either way. `portalNavGroup`/`portalLabel` (see the constants above) fold
 * that link into an existing content-authored nav group instead of
 * rendering it as `Nav`'s own separate flat link.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}): Promise<Metadata> {
  const { slug, path } = await params;
  const currentPath = path && path.length > 0 ? `/${path.join("/")}` : "/";
  const result = await getPublishedSite(slug);
  if (result.kind === "not_found") return {};

  const { site } = result;
  const pageUrl = (bundlePath: string): string =>
    bundlePath === "/" ? `/site/${slug}` : `/site/${slug}${bundlePath}`;
  const logoUrl = await resolveLogoUrl(site.organizationId, slug);

  const meta = buildPageMetadata({
    pages: site.pages,
    currentPath,
    organizationName: site.organizationName,
    origin: siteOrigin(),
    pageUrl,
    logoUrl,
  });

  // `title: { absolute: ... }` bypasses the root layout's own
  // `"%s · presby"` template (src/app/layout.tsx) — a congregation's own
  // public page title should never carry platform branding.
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: meta.canonicalUrl },
    openGraph: meta.openGraph,
    twitter: meta.twitter,
    robots: meta.robots,
  };
}

export default async function PublicSitePage({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}) {
  const { slug, path } = await params;
  const currentPath = path && path.length > 0 ? `/${path.join("/")}` : "/";

  const result = await getPublishedSite(slug);
  if (result.kind === "not_found") {
    // DECISION-121: one extra narrow, public read on the miss path only —
    // never on the ok path above, and never able to distinguish a
    // congregation's "never provisioned" from "suspended" from "nonexistent
    // slug" (publicOrgSummary() cannot see platformStatus at all, so this
    // adds no new leak surface beyond org type, which the public org tree
    // already discloses).
    const summary = await publicOrgSummary(slug);
    if (summary && FALLBACK_ORG_TYPES.has(summary.organizationType)) {
      return <PresbyteryFallback name={summary.name} slug={slug} />;
    }
    notFound();
  }

  const { site } = result;

  const imageUrl = (manifestKey: string): string =>
    `/site/${slug}/assets/${site.imageKeys[manifestKey] ?? manifestKey}`;

  const pageUrl = (bundlePath: string): string =>
    bundlePath === "/" ? `/site/${slug}` : `/site/${slug}${bundlePath}`;

  const logoUrl = await resolveLogoUrl(site.organizationId, slug);

  // The contact form is no longer bolted onto every page below the
  // rendered bundle (the original shape here — it appeared after the
  // Footer on every single page, which matched no real site's structure
  // and let no content author control placement). It now rides site-kit's
  // `contactForm` block: this page passes the interactive element once,
  // and whichever content page authors a `{"type": "contactForm"}` block
  // renders it exactly there. Content with no such block gets no form.
  //
  // `liveSlots` (docs/work-log/2026-08-27-public-staff-directory.md) is
  // site-kit's generic named-slot mechanism — unlike `contactForm`'s own
  // bespoke prop, ANY content page can pick up ANY named live element by
  // placing a `{"type": "liveSlot", "props": {"slot": "<name>"}}` marker
  // block. A page with no such marker renders nothing extra — same
  // "content author controls placement, absence is not an error"
  // discipline as `contactForm`.
  //
  // presby-site-kit v4.0.0 (docs/work-log/2026-08-28-public-directory-
  // primitives.md, DECISION-132) made `liveSlots` VALUES RESOLVER FUNCTIONS
  // — `(filter) => ReactElement | null` — instead of pre-rendered elements,
  // so the SAME slot name can render a different filtered subset per marker
  // instance (a hand-curated "leadership" block and a per-committee page
  // both use `staffDirectory`/`committeeDirectory`, each with its own
  // `filter`). Each closure below MAY ONLY CLOSE OVER `slug` (or another
  // URL-path-derived value already in scope on this page) — NEVER `request`,
  // `headers()`, or `cookies()` (Phase 2's enumeration-safety redline). A
  // marker with no `filter` key resolves to `{}`, reproducing today's exact
  // unfiltered behavior for any content already using `staffDirectory` with
  // no filter.
  const rendered = renderSiteBundle({
    organizationName: site.organizationName,
    origin: siteOrigin(),
    pages: site.pages,
    currentPath,
    brand: site.brand,
    profile: toRenderProfile(site),
    imageUrl,
    pageUrl,
    logoUrl,
    portalUrl: `/o/${slug}`,
    portalNavGroup: PORTAL_NAV_GROUP,
    portalLabel: PORTAL_LABEL,
    portalNavOrder: PORTAL_NAV_ORDER,
    contactForm: <ContactForm slug={slug} />,
    liveSlots: {
      staffDirectory: (filter) => (
        <PublicStaffDirectory slug={slug} filter={filter} />
      ),
      committeeDirectory: (filter) => (
        <PublicCommitteeDirectory slug={slug} filter={filter} />
      ),
    },
  });

  // renderSiteBundle() returning null means no page in the bundle matches
  // currentPath — the same "nothing here" outcome as every other miss case,
  // not a distinguishable error.
  if (!rendered) notFound();

  // No separate flag re-check here: reaching this point already means
  // getPublishedSite() found the flag on (it's one of the reasons a
  // not_found collapse happens above) — re-checking would be a second,
  // redundant call for a fact already established.
  // No wrapping max-width either: `{rendered}` is presby-site-kit's own
  // bundle, which governs its own layout (most blocks cap at site-kit's
  // --site-max-width and center themselves; Nav/Hero/Callout/Footer are
  // deliberately full-bleed bands). A `max-w-3xl` wrapper around the whole
  // page — the original shape here — silently capped EVERY block to a
  // 768px reading column regardless of what site-kit's own CSS said.
  return rendered;
}
