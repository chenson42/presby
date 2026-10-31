import { CareersEmptyNotice, CareersUnavailableNotice } from "@/components/careers/careers-notice";
import { CareersList } from "@/components/careers/careers-list";
import { readPublicCareers } from "@/lib/careers/public";
import type { SiteUrls } from "@/lib/site-urls";

/**
 * The `careers` live slot (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Slot
 * wiring"; DECISION-264): a content author places
 * `{"type": "liveSlot", "props": {"slot": "careers"}}` on any page - an
 * "Employment" page, say - and the open positions render right there, inside the
 * site's own menu and footer.
 *
 * Same live-slot discipline as the calendar and the giving form: a plain async
 * Server Component, and the closure in `render-site-page.tsx` closes over the
 * DATABASE-RETURNED `slug` and `urls` ONLY - never the site key, a request, a
 * header or a cookie (DECISION-132). The marker's `filter` is read for nothing in
 * v1.
 *
 * STATES. `unavailable` (the toggle or category is off, the site is not serving) and
 * `failed` (the read itself did not complete) get ONE notice, Copy P1: the slot sits
 * on a page an author deliberately placed, and it cannot tell the two causes apart
 * and must not claim to (DECISION-154). `available` with no postings is Copy P2, a
 * SUCCESSFUL read only. Otherwise the cards. The host page owns the `h1`.
 */
export async function PublicCareersSlot({ slug, urls }: { slug: string; urls: SiteUrls }) {
  const careers = await readPublicCareers(slug);

  if (careers.state !== "available") {
    return (
      <section aria-label="Job openings" className="mx-auto max-w-5xl px-4 py-8">
        <CareersUnavailableNotice />
      </section>
    );
  }

  return (
    <section aria-label="Job openings" className="mx-auto max-w-5xl px-4 py-8">
      {careers.postings.length === 0 ? (
        <CareersEmptyNotice contactPhone={careers.contactPhone} />
      ) : (
        <CareersList postings={careers.postings} urls={urls} />
      )}
    </section>
  );
}
