import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/shared/pagination";
import type { DirectoryEntry, DirectoryPagination } from "@/lib/directory";
import type { CommunityBadges } from "@/lib/community";
import type { CommunityView } from "@/lib/community-labels";
import { CommunityBadge, EngagementStatusBadge } from "./community-badge";
import { CommunityEmptyState } from "./community-empty-state";
import { CommunitySearch } from "./community-search";
import { CommunityRowsList } from "./community-rows-list";
import type { CommunityRow } from "@/lib/community";
import type { SignInMarker as Marker } from "@/lib/onboarding/sign-in-types";
import { SignInMarker } from "./sign-in-marker";

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
  markers = {},
  canManage,
  canStaffLink,
  search,
  pagination,
  organization = "",
  selfConnectEnabled = null,
  viewerPersonId = null,
}: {
  slug: string;
  view: CommunityView;
  entries?: DirectoryEntry[];
  rows?: CommunityRow[];
  badges: Record<string, CommunityBadges>;
  /** Sign-in markers by person id; empty unless the viewer holds `people.manage`. */
  markers?: Record<string, Marker>;
  canManage: boolean;
  canStaffLink: boolean;
  search: string;
  pagination?: DirectoryPagination;
  /** The organization's name, for the archive and restore dialogs. */
  organization?: string;
  /** `org_portal.sign_in_connect`; null when the page could not read it. */
  selfConnectEnabled?: boolean | null;
  /** The viewer's own person id, for the admin lists: their own row offers no Archive. */
  viewerPersonId?: string | null;
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
                    badge={badges[entry.personId]?.roll ?? undefined}
                    engagementBadge={badges[entry.personId]?.engagement ?? undefined}
                    marker={markers[entry.personId]}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <CommunityRowsList
              slug={slug}
              view={view as "visitors" | "inactive" | "staff" | "former"}
              rows={rows ?? []}
              markers={markers}
              canStaffLink={canStaffLink}
              organization={organization}
              selfConnectEnabled={selfConnectEnabled}
              viewerPersonId={viewerPersonId}
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
  engagementBadge,
  marker,
}: {
  slug: string;
  entry: DirectoryEntry;
  canEdit: boolean;
  badge?: CommunityBadges["roll"];
  engagementBadge?: CommunityBadges["engagement"];
  marker?: Marker;
}) {
  const displayName = `${entry.preferredName ?? entry.firstName} ${entry.lastName}`;

  return (
    <Card className="py-4">
      {/* Two sibling links, never nested (invalid HTML): the card body links to
       * the existing directory detail page, Edit is its own control alongside
       * it, gated on `people.manage`. */}
      <CardContent className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/o/${slug}/directory/${entry.personId}`}
            className="block space-y-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <h3 className="break-words text-lg font-medium">{displayName}</h3>
            {entry.email && (
              <p className="break-all text-sm text-muted-foreground">{entry.email}</p>
            )}
            {badge || engagementBadge ? (
              <div className="flex flex-wrap gap-1">
                {badge ? <CommunityBadge badge={badge} /> : null}
                {engagementBadge ? <EngagementStatusBadge engagement={engagementBadge} /> : null}
              </div>
            ) : null}
          </Link>
          {/* A sibling of the link, never inside it (a link in a link is invalid). */}
          {canEdit && marker && (
            <SignInMarker marker={marker} slug={slug} personId={entry.personId} personName={displayName} />
          )}
        </div>
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
