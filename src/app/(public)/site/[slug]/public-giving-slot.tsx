import { randomUUID } from "node:crypto";
import { GiveForm } from "@/components/giving/give-form";
import { GivingUnavailableNotice } from "@/components/giving/giving-unavailable-notice";
import { giveHeading } from "@/lib/giving/giving-copy";
import { readPublicGivingConfig } from "@/lib/giving/public-config";
import { createPublicGiveSessionAction } from "./give/actions";

/**
 * The `giving` live slot (docs/work-log/2026-10-15-online-giving.md, G16 and the
 * Component / Page Plan): a content author places
 * `{"type": "liveSlot", "props": {"slot": "giving"}}` on any page and the give
 * form renders right there. The platform-owned `/site/<slug>/give` page exists
 * either way; the slot just lets a congregation's own page hold the form.
 *
 * Same live-slot discipline as the staff and committee directories: a plain
 * async Server Component, the closure in `page.tsx` closes over `slug` ONLY
 * (never a request, header or cookie), and the marker's `filter` is lower-trust,
 * author-typed JSON. The one key honoured is `fund`: a fund id that must be one
 * of THIS organization's active, online funds (read from the same public config
 * the form uses), otherwise it is silently ignored and the first fund is the
 * default. Nothing else in the filter is read.
 *
 * States: `live` -> the form (an `h2`, because the host page owns the `h1`);
 * `unavailable` -> the shared notice (giving off, not connected, or no online
 * fund: the site is live, so the donor reads an honest "not available" rather
 * than a hole where the author placed a form); `absent` -> nothing at all (the
 * organization has no live public site, so there is nothing to say). A page with no marker never reaches this. The idempotency key is
 * minted per render, and the host page is `force-dynamic` via the site layout,
 * so it is never shared between visitors.
 */
export async function PublicGivingSlot({ slug, filter }: { slug: string; filter: Record<string, unknown> }) {
  const config = await readPublicGivingConfig(slug);
  if (config.state === "absent") return null;

  if (config.state === "unavailable") {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <GivingUnavailableNotice
          organizationName={config.organizationName}
          contactPhone={config.contactPhone}
          headingLevel={2}
        />
      </div>
    );
  }

  const requested = typeof filter.fund === "string" ? filter.fund : undefined;
  const defaultFundId = requested && config.funds.some((fund) => fund.id === requested) ? requested : undefined;

  return (
    <section aria-labelledby="giving-slot-heading" className="mx-auto max-w-xl space-y-4 px-4 py-8">
      <h2 id="giving-slot-heading" className="text-xl font-semibold">
        {giveHeading(config.organizationName)}
      </h2>
      <GiveForm
        mode="public"
        idPrefix="slot-give"
        action={createPublicGiveSessionAction.bind(null, slug)}
        initialKey={randomUUID()}
        funds={config.funds}
        defaultFundId={defaultFundId}
        cardEnabled={config.cardEnabled}
        achEnabled={config.achEnabled}
        rates={config.rates}
        minAmountCents={config.minAmountCents}
        maxAmountCents={config.maxAmountCents}
        livemode={config.livemode}
        contactPhone={config.contactPhone}
      />
    </section>
  );
}
