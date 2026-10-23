import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/shared/pagination";
import type { DirectoryEntry, DirectoryPagination } from "@/lib/directory";
import type { CommunityBadge as Badge } from "@/lib/community";
import type { CommunityView } from "@/lib/community-labels";
import { CommunityBadge } from "./community-badge";
import { CommunityEmptyState } from "./community-empty-state";
import { CommunitySearch } from "./community-search";
import { CommunityRowsList } from "./community-rows-list";
import type { CommunityRow } from "@/lib/community";

/**
 * The Community list body for every view. The Everyone, Members and
 * Participants views are `DirectoryEntry[]` (the privacy-filtered Directory
 * read); Visitors, Staff and Former are `CommunityRow[]` (admin-only,
 * `people.manage`-gated). Exactly one of `entries` / `rows` is passed.
 *
 * Search is a zero-JS GET form that stays inside the current view.
 * `entries.length === 0` alone cannot mean "empty view": it may be a search
 * that matched nobody, and `CommunityEmptyState` tells the two apart.
 */
export function MembersList({
  slug,
  view,
  entries,
  rows,
  badges,
  canManage,
  canStaffLink,
  search,
  pagination,
}: {
  slug: string;
  view: CommunityView;
  entries?: DirectoryEntry[];
  rows?: CommunityRow[];
  badges: Record<string, Badge>;
  canManage: boolean;
  canStaffLink: boolean;
  search: string;
  pagination?: DirectoryPagination;
}) {
  const count = (entries ?? rows ?? []).length;

  const buildHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (view !== "all") params.set("view", view);
    if (search) params.set("search", search);
    params.set("page", String(targetPage));
    return `/o/${slug}/admin/community?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <CommunitySearch view={view} search={search} />

      {count === 0 ? (
        <CommunityEmptyState
          slug={slug}
          view={view}
          search={search}
          canManage={canManage}
          canStaffLink={canStaffLink}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Showing {count} {count === 1 ? "person" : "people"}
            {pagination ? ` of ${pagination.total}` : ""}
          </p>
          {entries ? (
            <ul className="space-y-3">
              {entries.map((entry) => (
                <li key={entry.personId}>
                  <MemberCard
                    slug={slug}
                    entry={entry}
                    canEdit={canManage}
                    badge={badges[entry.personId]}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <CommunityRowsList
              slug={slug}
              view={view as "visitors" | "staff" | "former"}
              rows={rows ?? []}
              canStaffLink={canStaffLink}
            />
          )}
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

function MemberCard({
  slug,
  entry,
  canEdit,
  badge,
}: {
  slug: string;
  entry: DirectoryEntry;
  canEdit: boolean;
  badge?: Badge;
}) {
  const displayName = `${entry.preferredName ?? entry.firstName} ${entry.lastName}`;

  return (
    <Card className="py-4">
      {/* Two sibling links, never nested (invalid HTML): the card body links to
       * the existing directory detail page, Edit is its own control alongside
       * it, gated on `people.manage`. */}
      <CardContent className="flex items-center justify-between gap-3">
        <Link
          href={`/o/${slug}/directory/${entry.personId}`}
          className="block min-w-0 flex-1 space-y-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <h3 className="break-words text-lg font-medium">{displayName}</h3>
          {entry.email && (
            <p className="break-all text-sm text-muted-foreground">{entry.email}</p>
          )}
          {badge && <CommunityBadge badge={badge} />}
        </Link>
        {canEdit && (
          <Button asChild variant="outline" className="min-h-11 shrink-0">
            <Link href={`/o/${slug}/admin/community/${entry.personId}/edit`}>
              Edit
              <span className="sr-only"> {displayName}</span>
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
