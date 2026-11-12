import { SpotTheScamFrame } from "@/components/learn/spot-the-scam-frame";
import { SpotTheScamUnavailableNotice } from "@/components/learn/learn-notices";
import { SPOT_THE_SCAM_FEATURE_KEY } from "@/lib/learn/contract";
import { readPublicLearn } from "@/lib/learn/public";
import { NAME } from "@/lib/learn/spot-the-scam/copy";
import type { SiteUrls } from "@/lib/site-urls";

/**
 * The `spotTheScam` live slot (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "Slot";
 * DECISION-332): a content author places `{"type": "liveSlot", "props": {"slot":
 * "spotTheScam"}}` on any page - a "Learn" page, say - and the practice renders right
 * there, inside the site's own menu and footer.
 *
 * Same live-slot discipline as the calendar, giving and careers slots: a plain async
 * Server Component, and the closure in `render-site-page.tsx` closes over the
 * DATABASE-RETURNED `slug` and `urls` ONLY - never the site key, a request, a header or a
 * cookie (DECISION-132). The marker's `filter` is read for nothing. The slot renders no
 * link, so it uses only the slug; `urls` is part of the contract (and of the T10 test)
 * so a later "where does it appear" walker has it.
 *
 * STATES. `unavailable` (the toggle or category is off, the site is not serving) and
 * `failed` (the read itself did not complete) get ONE notice, Copy G4: the slot sits on a
 * page an author deliberately placed, and it cannot tell the two causes apart and must not
 * claim to (DECISION-154). `available` renders the frame without an h1: the host page owns
 * it. The slot cannot set page metadata (the bundle owns it), so an iOS data detector may
 * auto-link an email-shaped sender address inside it: accepted residual, F439.
 */
export async function PublicSpotTheScamSlot({ slug }: { slug: string; urls: SiteUrls }) {
  const learn = await readPublicLearn(slug, SPOT_THE_SCAM_FEATURE_KEY);

  if (learn.state !== "available") {
    return (
      <section aria-label={NAME} className="mx-auto max-w-3xl px-4 py-8">
        <SpotTheScamUnavailableNotice />
      </section>
    );
  }

  return (
    <section aria-label={NAME} className="mx-auto max-w-3xl px-4 py-8">
      <SpotTheScamFrame />
    </section>
  );
}
