import Link from "next/link";
import { COPY } from "@/lib/reimbursement/copy";
import { TREASURER_TABS, type QueueQuery } from "@/lib/reimbursement/queue-query";
import type { RequestCounts } from "@/lib/reimbursement/reads";
import { queueHref, tabCount } from "./queue-model";

/**
 * The five queue tabs (Copy C7), each with its count where the definer has one.
 * Plain links, so a tab is a URL (shareable, back-button safe, no JavaScript to
 * hydrate): a `<nav>` of links with `aria-current="page"` on the open one, not
 * an ARIA tablist, which promises arrow-key behaviour a link does not have.
 * A tab keeps the group and date filters and starts at page 1. They wrap onto
 * more than one line on a phone rather than scroll sideways; each is 44 px tall.
 * Server component.
 */
export function QueueTabs({ slug, query, counts }: { slug: string; query: QueueQuery; counts: RequestCounts }) {
  return (
    <nav aria-label={COPY.queue.heading} data-testid="queue-tabs">
      <ul className="flex flex-wrap gap-2">
        {TREASURER_TABS.map((tab) => {
          const current = tab === query.tab;
          const count = tabCount(tab, counts);
          return (
            <li key={tab}>
              <Link
                href={queueHref(slug, query, { tab, page: 1 })}
                aria-current={current ? "page" : undefined}
                data-testid={`queue-tab-${tab}`}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  current
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-card-foreground hover:bg-muted"
                }`}
              >
                {COPY.queue.tabs[tab]}
                {count !== null && <span className="ml-1 tabular-nums">({count})</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      {query.tab === "override" && (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="override-tab-note">
          {COPY.queue.overrideTabNote}
        </p>
      )}
    </nav>
  );
}
