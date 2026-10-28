import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { formatLongDate } from "@/lib/calendar/month";
import { employmentTypeLabel, formatPay } from "@/lib/careers/contract";
import { closingDatePassed, isStale } from "@/lib/careers/dates";
import type { PostingRow } from "@/lib/careers/postings";
import { slugSitePath } from "@/lib/site-urls";
import { MovePostingButtons } from "./move-buttons";

/**
 * The staff list (Copy S7): Published, Drafts and Closed, each with its count. A
 * Server Component - the only client islands are the per-row move buttons. A section
 * with no rows is not rendered (the empty state handles "nothing at all").
 *
 * Everything a row says is derived from the row and the organization's own "today"
 * (`orgToday`, from SQL), never from a browser or server clock:
 *   "Never published"       closed and `firstPublishedAt` null: a discarded draft
 *   "Closing date passed"   published and not visible to the public (closing date < today)
 *   the 60-day hint         published, posted 60 or more days ago, no closing date
 * `postedOn`/`closingDate` are bare 'YYYY-MM-DD' keys formatted from static name tables.
 *
 * Titles are staff-authored free text: React text only, wrapped with
 * `overflow-wrap:anywhere` so a 200-character unbroken title stays inside 360px.
 * "View on your website" is a platform-host slug URL (`slugSitePath`), which 307s to the
 * church's own domain while one is serving.
 */

function statusBadge(posting: PostingRow): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } {
  if (posting.status === "draft") return { label: "Draft", variant: "secondary" };
  if (posting.status === "published") {
    return posting.visibleToPublic ? { label: "Published", variant: "default" } : { label: "Closing date passed", variant: "destructive" };
  }
  return posting.firstPublishedAt === null ? { label: "Never published", variant: "outline" } : { label: "Closed", variant: "outline" };
}

/** The status badge of a row (shared with the edit page's header). */
export function PostingStatusBadge({ posting }: { posting: PostingRow }) {
  const badge = statusBadge(posting);
  return <Badge variant={badge.variant}>{badge.label}</Badge>;
}

function PostingItem({
  slug,
  posting,
  orgToday,
  order,
}: {
  slug: string;
  posting: PostingRow;
  orgToday: string;
  order?: { isFirst: boolean; isLast: boolean };
}) {
  const pay = formatPay(posting.payMinCents, posting.payMaxCents, posting.payUnit);
  const passed = posting.status === "published" && closingDatePassed(posting.closingDate, orgToday);
  const stale = posting.status === "published" && isStale(posting.postedOn, posting.closingDate, orgToday);
  const facts = [posting.location, employmentTypeLabel(posting.employmentType)].filter((s) => s !== "").join(" · ");

  return (
    <li className="space-y-2 rounded-lg border border-border p-4" data-testid="posting-row">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/o/${slug}/admin/careers/${posting.id}`}
            className="inline-block min-h-11 py-2 text-base font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [overflow-wrap:anywhere]"
          >
            {posting.title}
          </Link>
          <div>
            <PostingStatusBadge posting={posting} />
          </div>
        </div>
        {order && (
          <MovePostingButtons
            slug={slug}
            postingId={posting.id}
            title={posting.title}
            isFirst={order.isFirst}
            isLast={order.isLast}
          />
        )}
      </div>

      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{facts}</p>
      {pay !== null && <p className="text-sm text-muted-foreground">{pay}</p>}
      {posting.postedOn !== null && (
        <p className="text-sm text-muted-foreground">Posted {formatLongDate(posting.postedOn)}</p>
      )}
      {posting.closingDate !== null && (
        <p className="text-sm text-muted-foreground">Closing date: {formatLongDate(posting.closingDate)}</p>
      )}
      {passed && (
        <p className="text-sm">No longer shown on your website. It will be marked Closed automatically.</p>
      )}
      {stale && posting.postedOn !== null && (
        <p className="text-sm">
          Posted {formatLongDate(posting.postedOn)} with no closing date. Close it if it has been filled.
        </p>
      )}
      {posting.status === "published" && posting.visibleToPublic && (
        <p>
          <Link
            href={slugSitePath(slug, `/careers/${encodeURIComponent(posting.slug)}`)}
            className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            View on your website
          </Link>
        </p>
      )}
    </li>
  );
}

export function PostingsList({
  slug,
  postings,
  orgToday,
}: {
  slug: string;
  postings: readonly PostingRow[];
  orgToday: string;
}) {
  if (postings.length === 0) {
    return (
      <EmptyState
        title="You haven't created any job openings yet."
        action={
          <Button asChild className="min-h-11">
            <Link href={`/o/${slug}/admin/careers/new`}>Create your first job opening</Link>
          </Button>
        }
      />
    );
  }

  const published = postings.filter((p) => p.status === "published");
  const drafts = postings.filter((p) => p.status === "draft");
  const closed = postings.filter((p) => p.status === "closed");

  return (
    <div className="space-y-8">
      {published.length > 0 && (
        <section aria-labelledby="careers-published" className="space-y-3">
          <h2 id="careers-published" className="text-xl font-semibold">
            Published ({published.length})
          </h2>
          <ul className="space-y-3">
            {published.map((posting, index) => (
              <PostingItem
                key={posting.id}
                slug={slug}
                posting={posting}
                orgToday={orgToday}
                order={{ isFirst: index === 0, isLast: index === published.length - 1 }}
              />
            ))}
          </ul>
        </section>
      )}

      {drafts.length > 0 && (
        <section aria-labelledby="careers-drafts" className="space-y-3">
          <h2 id="careers-drafts" className="text-xl font-semibold">
            Drafts ({drafts.length})
          </h2>
          <ul className="space-y-3">
            {drafts.map((posting) => (
              <PostingItem key={posting.id} slug={slug} posting={posting} orgToday={orgToday} />
            ))}
          </ul>
        </section>
      )}

      {closed.length > 0 && (
        <details className="space-y-3" data-testid="careers-closed">
          <summary className="min-h-11 cursor-pointer py-2 text-xl font-semibold">
            Closed ({closed.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {closed.map((posting) => (
              <PostingItem key={posting.id} slug={slug} posting={posting} orgToday={orgToday} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
