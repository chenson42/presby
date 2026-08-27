import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/shared/pagination";
import type { DirectoryEntry, DirectoryPagination } from "@/lib/directory";
import {
  DIRECTORY_STATUSES,
  type DirectoryStatus,
} from "@/lib/directory-status";

/** Plain-language labels for the `DIRECTORY_STATUSES` filter — mirrors
 * `directory-grid.tsx`'s own map; kept local rather than shared since it's
 * two lines and a shared constants file for one string map would be more
 * ceremony than the duplication it avoids. */
const STATUS_LABELS: Record<DirectoryStatus, string> = {
  active: "Active",
  baptized: "Baptized",
  affiliate: "Affiliate",
  other_participant: "Other participant",
};

/**
 * Single-column card list — same shape as
 * `directory/directory-list.tsx`, reused here rather than re-invented,
 * since both read `DirectoryEntry[]`. This list additionally links each
 * card to the person's existing directory detail page rather than
 * duplicating one.
 *
 * Increment 5 (`2026-08-26-members-directory-pagination-search.md`):
 * search + status filter, mirroring `directory-grid.tsx`'s own zero-JS GET
 * `<form>` pattern rather than inventing a second UI shape for the same
 * underlying query. `entries.length === 0` alone can no longer mean "no
 * members yet" — it might just as easily mean "this search/filter matched
 * nobody" — so the two are told apart explicitly, same discipline
 * `directory-grid.tsx`'s own `EmptyState` already established.
 */
export function MembersList({
  slug,
  entries,
  canCreate,
  canEdit,
  search,
  status,
  pagination,
}: {
  slug: string;
  entries: DirectoryEntry[];
  canCreate: boolean;
  canEdit: boolean;
  search: string;
  /** Empty string = "All" (unfiltered). */
  status: DirectoryStatus | "";
  pagination?: DirectoryPagination;
}) {
  const hasActiveFilter = Boolean(search || status);

  const buildHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    params.set("page", String(targetPage));
    return `/o/${slug}/admin/members?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <form
        method="get"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <Label htmlFor="members-search" className="text-sm">
            Search members
          </Label>
          <Input
            id="members-search"
            name="search"
            type="search"
            defaultValue={search}
            placeholder="Name, email, or phone"
            className="mt-1 min-h-11"
          />
        </div>
        <div>
          <Label htmlFor="members-status" className="text-sm">
            Status
          </Label>
          <div className="relative mt-1">
            <select
              id="members-status"
              name="status"
              defaultValue={status}
              className="flex min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base shadow-xs sm:w-auto"
            >
              <option value="">All</option>
              {DIRECTORY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
        <Button type="submit" className="min-h-11 sm:w-auto">
          Search
        </Button>
      </form>

      {entries.length === 0 ? (
        <EmptyState
          hasActiveFilter={hasActiveFilter}
          search={search}
          status={status}
          canCreate={canCreate}
          slug={slug}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {entries.length} {entries.length === 1 ? "member" : "members"}
            {pagination ? ` of ${pagination.total}` : ""}
          </p>
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.personId}>
                <MemberCard slug={slug} entry={entry} canEdit={canEdit} />
              </li>
            ))}
          </ul>
        </>
      )}

      {pagination && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          buildHref={buildHref}
        />
      )}
    </div>
  );
}

function EmptyState({
  hasActiveFilter,
  search,
  status,
  canCreate,
  slug,
}: {
  hasActiveFilter: boolean;
  search: string;
  status: DirectoryStatus | "";
  canCreate: boolean;
  slug: string;
}) {
  if (hasActiveFilter) {
    const statusLabel = status ? STATUS_LABELS[status] : null;
    return (
      <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        {search && statusLabel
          ? `No matches for "${search}" with status "${statusLabel}".`
          : search
            ? `No matches for "${search}". Try a different name, email, or phone number.`
            : `No members with status "${statusLabel}".`}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border py-16 text-center">
      <p className="text-sm font-medium">No members yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Add your first member to get started.
      </p>
      {canCreate && (
        <Button asChild className="mt-4 min-h-11">
          <Link href={`/o/${slug}/admin/members/new`}>Add person</Link>
        </Button>
      )}
    </div>
  );
}

function MemberCard({
  slug,
  entry,
  canEdit,
}: {
  slug: string;
  entry: DirectoryEntry;
  canEdit: boolean;
}) {
  const displayName = `${entry.preferredName ?? entry.firstName} ${entry.lastName}`;

  return (
    <Card className="py-4">
      {/* Two sibling links, never nested (invalid HTML) — the card body
       * links to the existing directory detail page (unchanged), Edit is
       * its own control alongside it, gated on `people.manage` same as the
       * "Add person" CTA above. */}
      <CardContent className="flex items-center justify-between gap-3">
        <Link
          href={`/o/${slug}/directory/${entry.personId}`}
          className="block flex-1 space-y-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <h3 className="text-lg font-medium">{displayName}</h3>
          {entry.email && (
            <p className="text-sm text-muted-foreground">{entry.email}</p>
          )}
        </Link>
        {canEdit && (
          <Button asChild variant="outline" className="min-h-11 shrink-0">
            <Link href={`/o/${slug}/admin/members/${entry.personId}/edit`}>
              Edit
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
