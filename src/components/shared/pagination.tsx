import Link from "next/link";
import { cn } from "@/lib/utils";

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Builds the href for a given target page — the caller decides which
   * other query params (search, status) survive alongside it. Kept a plain
   * closure rather than this component reading `searchParams` itself, so
   * it stays a dumb, reusable presentational piece with no knowledge of
   * what a given list page's own filters are. */
  buildHref: (targetPage: number) => string;
}

const LINK_CLASSES =
  "flex min-h-11 min-w-11 items-center justify-center rounded-md px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const DISABLED_CLASSES =
  "flex min-h-11 min-w-11 items-center justify-center rounded-md px-4 text-sm font-medium text-muted-foreground/50";

/**
 * Server-rendered, zero-client-JS pager — plain `<Link>`s with an updated
 * `?page=`, matching the same RSC + `searchParams` model the directory's
 * own search box already established rather than introducing a client
 * component and a second UX pattern for the same list. `min-h-11`/
 * `min-w-11` throughout, matching every other control on this elderly/
 * mobile-first surface (member-management's own established precedent).
 * Renders nothing at all when there's only one page — a pager with
 * disabled arrows on both ends is noise, not a control.
 */
export function Pagination({ page, totalPages, buildHref }: PaginationProps) {
  if (totalPages <= 1) return null;

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 pt-2"
    >
      {hasPrevious ? (
        <Link href={buildHref(page - 1)} className={LINK_CLASSES}>
          Previous
        </Link>
      ) : (
        <span className={cn(DISABLED_CLASSES)} aria-hidden="true">
          Previous
        </span>
      )}

      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>

      {hasNext ? (
        <Link href={buildHref(page + 1)} className={LINK_CLASSES}>
          Next
        </Link>
      ) : (
        <span className={cn(DISABLED_CLASSES)} aria-hidden="true">
          Next
        </span>
      )}
    </nav>
  );
}
