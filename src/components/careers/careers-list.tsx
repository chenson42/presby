import { useId } from "react";
import type { PublicPostingSummary } from "@/lib/careers/contract";
import type { SiteUrls } from "@/lib/site-urls";
import { PostingMeta } from "./posting-meta";

/**
 * The list of open positions as cards (Copy P4). Shared by the `/careers` page and
 * the `careers` live slot, so a church that places the slot sees the same cards.
 *
 * The heading level is fixed at `h2`: the page owns the `h1` ("Job openings") and
 * the slot sits under its host page's `h1`. Every string is React text - titles,
 * summaries and locations are staff-authored and public, rendered with no HTML, no
 * auto-links and a 300-character unbroken title wraps (`overflow-wrap:anywhere`).
 * The only link on a card is `urls.careersPosting(slug)`; there is no id, no query
 * string, and no other handle on the posting.
 *
 * "View this position" is the same words on every card, so each link is described by
 * its card's title (`aria-describedby`) rather than given a longer name.
 */
export function CareersList({
  postings,
  urls,
}: {
  postings: readonly PublicPostingSummary[];
  urls: Pick<SiteUrls, "careersPosting">;
}) {
  const prefix = useId();
  return (
    <ul className="space-y-4" data-testid="careers-list">
      {postings.map((posting, index) => {
        const titleId = `${prefix}-title-${index}`;
        return (
          <li key={posting.slug} className="space-y-3 rounded-lg border border-border p-4 sm:p-5">
            <h2 id={titleId} className="text-xl font-semibold [overflow-wrap:anywhere]">
              {posting.title}
            </h2>
            <PostingMeta posting={posting} />
            {posting.summary !== "" && <p className="text-base [overflow-wrap:anywhere]">{posting.summary}</p>}
            <a
              href={urls.careersPosting(posting.slug)}
              aria-describedby={titleId}
              className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              View this position
            </a>
          </li>
        );
      })}
    </ul>
  );
}
