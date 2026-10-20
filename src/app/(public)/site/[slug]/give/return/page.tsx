import type { Metadata } from "next";
import { GiveReturnPanel } from "@/components/giving/give-return-panel";
import { readReturnState, type ReturnState } from "@/lib/giving/public-config";

/**
 * `/site/<slug>/give/return?session_id=cs_...` - where Stripe sends a donor back.
 * docs/work-log/2026-10-15-online-giving.md, Flow 3 step 4 and the adversarial
 * row "State-machine shortcuts".
 *
 * The panel comes from presby's own rows, read by the Checkout session id; the
 * query string never marks anything paid. `readReturnState` answers `unknown`
 * identically for an absent, malformed or another congregation's id (and never
 * touches the database for a malformed one), so this page cannot be used to
 * probe for sessions or for which slugs are tenants. It prints an amount and a
 * fund and nothing else: no name, no email, no id. This page does not look the
 * organization up at all, so its markup does not depend on which slug it is.
 *
 * `noindex, nofollow` and `referrer: no-referrer` (the session id is in the URL
 * and must not leak onward). `force-dynamic`; no `loading.tsx` (the confirming
 * panel is its own loading state, with a bounded poller).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Your gift" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicGiveReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { session_id: sessionId } = await searchParams;

  const state: ReturnState =
    typeof sessionId === "string" ? await readReturnState(slug, sessionId) : { state: "unknown" };

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <GiveReturnPanel
        state={state}
        giveHref={`/site/${slug}/give`}
        homeHref={`/site/${slug}`}
        homeLabel="Back to the church's website"
        retryHref={typeof sessionId === "string" ? `/site/${slug}/give/return?session_id=${encodeURIComponent(sessionId)}` : undefined}
      />
    </div>
  );
}
