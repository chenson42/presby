import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { GiveForm } from "@/components/giving/give-form";
import { GivingUnavailableNotice } from "@/components/giving/giving-unavailable-notice";
import { giveHeading } from "@/lib/giving/giving-copy";
import { readPublicGivingConfig } from "@/lib/giving/public-config";
import { createPublicGiveSessionAction } from "./actions";
import { renderSitePage, siteBundleHasPage, siteBundleMetadata } from "../render-site-page";

const GIVE_PATH = "/give";


/**
 * `/site/<slug>/give` - the page a visitor gives from. docs/work-log/2026-10-15-
 * online-giving.md, Flow 3 and the Component / Page Plan. A PLATFORM-owned route:
 * the static `give` segment beats the site's `[[...path]]` catch-all, so a
 * congregation with no site editor still has a give page whenever giving is
 * live.
 *
 * THAT SAME PRECEDENCE SHADOWS A BUNDLE'S OWN `/give` PAGE (Phase 6, "Phase 1
 * miss: the /give shadow"), and the ingest validator only refuses NEW bundles.
 * So the platform page wins ONLY when giving is `live`; in every other state
 * this route renders the bundle's `/give` page through the catch-all's own
 * render path (`../render-site-page`), exactly as the catch-all would have:
 *
 *   giving state   bundle has /give    bundle has no /give
 *   live           platform form       platform form        (platform wins, by design)
 *   unavailable    the bundle's page   platform notice, noindex
 *   absent         the bundle's page   notFound()           (never the catch-all's presbytery sign-in fallback)
 *
 * Only `/give` itself is shadowed. `/give/return` is a second static segment and is
 * ALWAYS the platform's (a bundle page at exactly `/give/return` stays shadowed; the
 * ingest validator refuses it). Any OTHER `/give/<x>` matches no static route and falls
 * to the catch-all untouched (verified by e2e).
 *
 * THE (public) CONTRACT (DECISION-041): fully anonymous - no `auth()`, no session
 * or cookie read, no `getPlatformDb()` (the shared render path's one brand-mark
 * lookup is its own, unchanged), no `dangerouslySetInnerHTML`. The one giving read
 * is `readPublicGivingConfig(slug)`, a SECURITY DEFINER function on the anonymous
 * connection, and it answers exactly one of three things:
 *
 *   live         the form (funds, which methods, the congregation's fee rates);
 *   unavailable  the congregation has a live site but giving is not live: the
 *                bundle's own `/give` page if it has one, otherwise the notice
 *                and its phone (never the form, and `noindex`);
 *   absent       an unknown slug, a non-tenant slug and a toggle-off
 *                organization. With no bundle `/give` page all three get the
 *                platform's own `notFound()` - the same status and markup. A
 *                bundle that HAS a `/give` page is public at `/site/<slug>`
 *                already, so serving it here discloses nothing new.
 *
 * `force-dynamic`: the page mints a fresh single-attempt idempotency key per
 * request, so it must never be served from a shared cache (everyone would
 * share one key and the second donor would be told their gift was already
 * started). No `loading.tsx`: the segment may 404, and a Suspense boundary would
 * flush a 200 first. No `generateStaticParams`. The enforced CSP applies
 * (next.config.ts) to this path whichever page renders: no Stripe.js and no
 * cross-origin image, which a fall-through bundle page is held to as well.
 */
export const dynamic = "force-dynamic";

// One read per request, shared by generateMetadata and the page.
const loadConfig = cache((slug: string) => readPublicGivingConfig(slug));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const config = await loadConfig(slug);
  if (config.state === "live") return { title: { absolute: giveHeading(config.organizationName) } };

  // Not live: the bundle's own /give page, with its own metadata, when it has one.
  if (await siteBundleHasPage(slug, GIVE_PATH)) return siteBundleMetadata(slug, GIVE_PATH);
  if (config.state === "absent") return {};
  // The platform's "unavailable" state is a dead end for a crawler: keep it out of the index.
  return { title: { absolute: giveHeading(config.organizationName) }, robots: { index: false } };
}

export default async function PublicGivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = await loadConfig(slug);

  if (config.state !== "live") {
    // Only a real bundle page falls through. The catch-all's DECISION-121 presbytery sign-in
    // fallback is deliberately switched off here: `absent` stays the one 404, identical for an
    // unknown slug, a non-tenant (presbytery) slug and a toggle-off org.
    const site = await renderSitePage(slug, GIVE_PATH, { presbyteryFallback: false });
    if (site.kind === "page") return site.node;
    if (config.state === "absent") notFound();
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href={`/site/${slug}`}
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="mr-1 size-4" aria-hidden />
        Back to {config.organizationName}
      </Link>

      {config.state === "unavailable" ? (
        <GivingUnavailableNotice organizationName={config.organizationName} contactPhone={config.contactPhone} />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{giveHeading(config.organizationName)}</h1>
          <GiveForm
            mode="public"
            action={createPublicGiveSessionAction.bind(null, slug)}
            initialKey={randomUUID()}
            funds={config.funds}
            cardEnabled={config.cardEnabled}
            achEnabled={config.achEnabled}
            rates={config.rates}
            minAmountCents={config.minAmountCents}
            maxAmountCents={config.maxAmountCents}
            livemode={config.livemode}
            contactPhone={config.contactPhone}
          />
        </>
      )}
    </div>
  );
}
