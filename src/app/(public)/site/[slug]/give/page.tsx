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

/**
 * `/site/<slug>/give` - the page a visitor gives from. docs/work-log/2026-10-15-
 * online-giving.md, Flow 3 and the Component / Page Plan. A PLATFORM-owned route:
 * the static `give` segment beats the site's `[[...path]]` catch-all, so a
 * congregation with no site editor still has a give page whenever giving is
 * live (the ingest validator refuses a bundle page at `/give`).
 *
 * THE (public) CONTRACT (DECISION-041): fully anonymous - no `auth()`, no session
 * or cookie read, no `getPlatformDb()`, no `dangerouslySetInnerHTML`. The one read
 * is `readPublicGivingConfig(slug)`, a SECURITY DEFINER function on the anonymous
 * connection, and it answers exactly one of three things:
 *
 *   live         the form (funds, which methods, the congregation's fee rates);
 *   unavailable  the congregation has a live site but giving is not live: the
 *                notice and its phone, never the form;
 *   absent       an unknown slug, a non-tenant slug and a toggle-off
 *                organization are INDISTINGUISHABLE here, so all three get the
 *                platform's own `notFound()` - byte-identical markup, status and
 *                title.
 *
 * `force-dynamic`: the page mints a fresh single-attempt idempotency key per
 * request, so it must never be served from a shared cache (everyone would
 * share one key and the second donor would be told their gift was already
 * started). No `loading.tsx`: the segment may 404, and a Suspense boundary would
 * flush a 200 first. The enforced CSP applies (next.config.ts): no Stripe.js and
 * no cross-origin image on this page.
 */
export const dynamic = "force-dynamic";

// One read per request, shared by generateMetadata and the page.
const loadConfig = cache((slug: string) => readPublicGivingConfig(slug));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const config = await loadConfig(slug);
  if (config.state === "absent") return {};
  return { title: { absolute: giveHeading(config.organizationName) } };
}

export default async function PublicGivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = await loadConfig(slug);
  if (config.state === "absent") notFound();

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
