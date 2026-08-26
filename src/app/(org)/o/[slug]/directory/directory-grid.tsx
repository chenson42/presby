import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/shared/pagination";
import type { DirectoryEntry, DirectoryPagination } from "@/lib/directory";
import {
  DIRECTORY_STATUSES,
  type DirectoryStatus,
} from "@/lib/directory-status";
import { resolvePhotoSrc } from "./person-avatar";
import { PersonCard } from "./person-card";

/** Plain-language labels for the `DIRECTORY_STATUSES` filter — never the
 * raw `current_roll` enum value in front of a member. */
const STATUS_LABELS: Record<DirectoryStatus, string> = {
  active: "Active",
  baptized: "Baptized",
  affiliate: "Affiliate",
  other_participant: "Other participant",
};

/**
 * `org_portal.directory_v2`'s ON path: a card grid with a search box, in
 * place of `directory-list.tsx`'s single-column list. A plain, unstyled GET
 * `<form>` — no client component, no debounce timer, no fetch. Typing does
 * nothing until Enter/Search is pressed; the browser's native GET-form
 * behavior does the "RSC round trip" the Phase 2 ruling asked for (stay
 * RSC + `searchParams`, no new API route) with zero client JS. `search`
 * itself is executed entirely inside `getDirectory()`'s SQL — this
 * component only renders what it is handed.
 *
 * AN ASYNC SERVER COMPONENT, not a plain function, so every card's photo
 * can resolve through `resolvePhotoSrc()` (DECISION-030) in one
 * `Promise.all()` before the grid ever renders — see `person-avatar.tsx`'s
 * header for why the resolution step is a plain async function rather than
 * one async component per card. Tested the same way `directory/page.tsx`
 * already is: call `await DirectoryGrid(props)` directly, then hand the
 * resolved element to `render()`.
 *
 * TWO DISTINCT EMPTY STATES, deliberately not collapsed (mirrors
 * `directory-states.tsx`'s own "don't collapse" discipline):
 *   - a brand-new/zero-member directory (no search typed): a product-state
 *     message.
 *   - a search that matched nobody: a search-specific message that names
 *     the query back, so the member knows their search WAS applied, not
 *     silently ignored.
 *
 * `PersonCard` (Increment 3) moved to its own file so the exact same card
 * markup can also render inside a household detail page's member list —
 * see `person-card.tsx`'s own header.
 */
export async function DirectoryGrid({
  entries,
  organizationId,
  search,
  status,
  pagination,
  orgName,
  slug,
}: {
  entries: DirectoryEntry[];
  organizationId: string;
  search: string;
  /** Increment 5. Empty string = "All" (the pre-existing, unfiltered
   * behavior). */
  status: DirectoryStatus | "";
  /** Increment 5. Absent when the caller didn't paginate this call. */
  pagination?: DirectoryPagination;
  orgName: string;
  slug: string;
}) {
  const photoSrcs = await Promise.all(
    entries.map((entry) => resolvePhotoSrc(organizationId, entry.photoKey)),
  );

  const buildHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    params.set("page", String(targetPage));
    return `/o/${slug}/directory?${params.toString()}`;
  };

  return (
    <div className="mt-6 space-y-6">
      <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="directory-search" className="text-sm">
            Search the directory
          </Label>
          <Input
            id="directory-search"
            name="search"
            type="search"
            defaultValue={search}
            placeholder="Name, email, or phone"
            className="mt-1 min-h-11 bg-background"
          />
        </div>
        <div>
          <Label htmlFor="directory-status" className="text-sm">
            Status
          </Label>
          <select
            id="directory-status"
            name="status"
            defaultValue={status}
            className="mt-1 flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs sm:w-auto"
          >
            <option value="">All</option>
            {DIRECTORY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" className="min-h-11 sm:w-auto">
          Search
        </Button>
      </form>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {entries.length} {entries.length === 1 ? "member" : "members"}
        {pagination ? ` of ${pagination.total}` : ""}
      </p>

      {entries.length === 0 ? (
        <EmptyState search={search} status={status} orgName={orgName} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry, i) => (
            <PersonCard
              key={entry.personId}
              entry={entry}
              photoSrc={photoSrcs[i] ?? null}
              slug={slug}
            />
          ))}
        </div>
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
  search,
  status,
  orgName,
}: {
  search: string;
  status: DirectoryStatus | "";
  orgName: string;
}) {
  if (search || status) {
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
    <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
      No one is listed in {orgName}&apos;s directory yet.
    </p>
  );
}
