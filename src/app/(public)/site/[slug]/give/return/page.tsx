import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GiveReturnPanel } from "@/components/giving/give-return-panel";
import { readReturnState, type ReturnState } from "@/lib/giving/public-config";
import { resolveGiveSite } from "@/lib/sites";

/**
 * `/site/<key>/give/return?session_id=cs_...` (and `/give/return?...` on a church's
 * own domain) - where Stripe sends a donor back.
 * docs/work-log/2026-10-15-online-giving.md, Flow 3 step 4 and the adversarial
 * row "State-machine shortcuts".
 *
 * The panel comes from presby's own rows, read by the Checkout session id; the
 * query string never marks anything paid. `readReturnState` answers `unknown`
 * identically for an absent, malformed or another congregation's id (and never
 * touches the database for a malformed one), so this page cannot be used to
 * probe for sessions or for which slugs are tenants. It prints an amount and a
 * fund and nothing else: no name, no email, no id. The only organization lookup is
 * the site-key resolution below, and its markup does not depend on which
 * organization it found.
 *
 * NEVER REDIRECTS (R6, Track F): Stripe's `success_url` was fixed when the Checkout
 * session was created, so a donor who started on one host returns to that host even
 * if the canonical host changed meanwhile. The links on the panel come from the
 * resolved `SiteUrls`, so they stay on the host the donor is on. A key that does not
 * resolve is the neutral 404.
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
  const { slug: key } = await params;
  const { session_id: sessionId } = await searchParams;

  // The DB-returned slug (host mode) for the read, and the url builder for the links. A key
  // that does not resolve - an unknown, pending, lapsed or paused host, or a string that is
  // neither slug nor host - is the one neutral 404, like every other non-serving state.
  const target = await resolveGiveSite(key);
  if (target === null) notFound();

  const state: ReturnState =
    typeof sessionId === "string" ? await readReturnState(target.slug, sessionId) : { state: "unknown" };

  const { urls } = target;
  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <GiveReturnPanel
        state={state}
        giveHref={urls.give()}
        homeHref={urls.home()}
        homeLabel="Back to the church's website"
        retryHref={typeof sessionId === "string" ? urls.giveReturn(sessionId) : undefined}
      />
    </div>
  );
}
