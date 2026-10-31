import { AdminForbidden } from "@/components/admin-portal/admin-forbidden";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { organizations, organizationBrands } from "@/lib/db/domain/org";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import {
  DEFAULT_ROW_CAP,
  MAX_Q_LENGTH,
  ORG_TYPES,
  PLATFORM_STATUSES,
  buildOrgTree,
  hasActiveFilters,
  orgFiltersToQuery,
  parseOrgFilters,
  type OrgNode,
} from "./org-tree";

/**
 * Organizations — the platform operator's `(admin)` brand surface (S18, P0.5
 * slice c, commit `c3`), now shown as the council tree (synod, presbytery,
 * congregation) and filterable (docs/work-log/2026-10-21-review-polish.md,
 * Batch C; R14/R15). Sets a congregation's brand at onboarding and is where
 * the abuse-neutralization action lives (detail page).
 *
 * getPlatformDb() throughout — no membership exists for a platform operator
 * (see `[id]/actions.ts`'s header comment). The gate is rendered INLINE, not
 * a redirect(), matching `/admin/2fa`'s pattern exactly rather than the
 * redirect()-to-/access-pending shape some other admin pages use.
 *
 * THE TREE IS DISPLAY ONLY (R14). It nests by `parent_id`, the derived cache
 * of the affiliation history; `path` is never read, nothing is written, and
 * no link or action is chosen by a row's position. The one row action is the
 * existing "Manage" link, and it appears only on rows that match the filters
 * (an ancestor kept for context is dimmed and carries none).
 *
 * THIS PAGE IS ALSO OQ4'S REPORT ("congregations still on the default
 * palette"). One query, one page: `?filter=unbranded` is one of the filters
 * on the same list, not a second surface. Filters are a plain GET form, so a
 * filtered URL is shareable and bookmarkable and needs no JavaScript.
 *
 * No `error.tsx` for the admin area in this pipeline (R15): the read is
 * caught here and renders an inline retry state.
 */

// Static class map so Tailwind sees every literal. Capped at four steps so a
// deep chain can never push the name off a 360px screen.
const INDENT = ["pl-2", "pl-6", "pl-10", "pl-14", "pl-16"] as const;

const SELECT_CLASS =
  "min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none dark:bg-input/30";

function label(s: string): string {
  return s.replace(/_/g, " ");
}

function lifecycleVariant(status: string): "destructive" | "secondary" {
  return status === "dissolved" || status === "dismissed"
    ? "destructive"
    : "secondary";
}

export default async function OrganizationsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!hasFeature(session?.user?.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return <AdminForbidden title="Organizations" area="managing organizations" />;
  }

  const filters = parseOrgFilters(await searchParams);
  const query = orgFiltersToQuery(filters);

  let allRows: OrgNode[];
  try {
    const rawRows = await getPlatformDb()
      .select({
        id: organizations.id,
        name: organizations.name,
        organizationType: organizations.organizationType,
        platformStatus: organizations.platformStatus,
        lifecycleStatus: organizations.lifecycleStatus,
        parentId: organizations.parentId,
        brandUpdatedAt: organizationBrands.updatedAt,
        brandOrgId: organizationBrands.organizationId,
      })
      .from(organizations)
      .leftJoin(
        organizationBrands,
        eq(organizationBrands.organizationId, organizations.id),
      );
    allRows = rawRows.map((r) => ({
      id: r.id,
      name: r.name,
      organizationType: r.organizationType,
      platformStatus: r.platformStatus,
      lifecycleStatus: r.lifecycleStatus,
      parentId: r.parentId,
      hasBrand: r.brandOrgId !== null,
      brandUpdatedAt: r.brandUpdatedAt,
    }));
  } catch {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <div
          role="alert"
          className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center"
        >
          <p className="text-base font-medium">
            We couldn&apos;t load the organization list.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This is usually a brief database hiccup. Trying again normally
            works.
          </p>
          <Button asChild className="mt-4 min-h-11">
            <Link href={`/admin/organizations${query}`}>Try again</Link>
          </Button>
        </div>
      </div>
    );
  }

  const tree = buildOrgTree(allRows, filters);
  const filtered = hasActiveFilters(filters);
  const unbrandedOnly = filters.unbranded;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Organizations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Find an organization, see how it is set up, and open it to manage its
        administrators, brand, public site and domains.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            variant={!unbrandedOnly ? "default" : "ghost"}
            size="sm"
            className="min-h-11"
          >
            <Link
              href={`/admin/organizations${orgFiltersToQuery({ ...filters, unbranded: false })}`}
            >
              All ({tree.totalCount})
            </Link>
          </Button>
          <Button
            asChild
            variant={unbrandedOnly ? "default" : "ghost"}
            size="sm"
            className="min-h-11"
          >
            <Link
              href={`/admin/organizations${orgFiltersToQuery({ ...filters, unbranded: true })}`}
            >
              Still on default palette ({tree.unbrandedCount})
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href="/admin/organizations/domains">Domains</Link>
          </Button>
          <Button asChild size="sm" className="min-h-11">
            <Link href="/admin/organizations/new">New organization</Link>
          </Button>
        </div>
      </div>

      <form
        method="get"
        action="/admin/organizations"
        role="search"
        aria-label="Filter the organization list"
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
      >
        {unbrandedOnly && <input type="hidden" name="filter" value="unbranded" />}
        <div className="space-y-1">
          <Label htmlFor="org-filter-q">Name</Label>
          <Input
            id="org-filter-q"
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={MAX_Q_LENGTH}
            autoComplete="off"
            placeholder="Part of a name"
            className="min-h-11"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="org-filter-type">Type</Label>
          <div className="relative">
            <select
              id="org-filter-type"
              name="type"
              defaultValue={filters.type ?? ""}
              className={SELECT_CLASS}
            >
              <option value="">All types</option>
              {ORG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="org-filter-status">Platform status</Label>
          <div className="relative">
            <select
              id="org-filter-status"
              name="status"
              defaultValue={filters.status ?? ""}
              className={SELECT_CLASS}
            >
              <option value="">All statuses</option>
              {PLATFORM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" className="min-h-11">
            Apply
          </Button>
          {filtered && (
            <Button asChild variant="ghost" className="min-h-11">
              <Link href="/admin/organizations">Clear filters</Link>
            </Button>
          )}
        </div>
      </form>

      {filtered && tree.matchCount > 0 && (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {tree.matchCount} of {tree.totalCount} organizations match. Greyed
          rows are shown only for context.
        </p>
      )}
      {tree.truncated && (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Showing the first {DEFAULT_ROW_CAP} of {tree.matchCount} matching
          organizations. Narrow the list with the filters.
        </p>
      )}

      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead className="hidden sm:table-cell">Type</TableHead>
            <TableHead className="hidden sm:table-cell">Platform status</TableHead>
            <TableHead className="hidden sm:table-cell">Branding</TableHead>
            <TableHead className="hidden md:table-cell">Last updated</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tree.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center">
                {allRows.length === 0 ? (
                  <>
                    <p className="text-base font-medium">No organizations yet.</p>
                    <Button asChild className="mt-4 min-h-11">
                      <Link href="/admin/organizations/new">New organization</Link>
                    </Button>
                  </>
                ) : unbrandedOnly && !filters.q && !filters.type && !filters.status ? (
                  <p className="text-muted-foreground">
                    Every organization has a brand set.
                  </p>
                ) : (
                  <>
                    <p className="text-base font-medium">
                      Nothing matches these filters.
                    </p>
                    <Button asChild variant="outline" className="mt-4 min-h-11">
                      <Link href="/admin/organizations">Clear filters</Link>
                    </Button>
                  </>
                )}
              </TableCell>
            </TableRow>
          ) : (
            tree.rows.map(({ org: o, depth, isMatch, childSummary }) => (
              <TableRow
                key={o.id}
                data-depth={depth}
                data-match={isMatch ? "true" : "false"}
              >
                <TableCell className={`${INDENT[Math.min(depth, 4)]} whitespace-normal`}>
                  <div
                    className={
                      depth > 0 ? "border-l-2 border-border pl-3" : undefined
                    }
                  >
                    <span className="sr-only">Level {depth + 1}: </span>
                    <span
                      className={
                        isMatch
                          ? "font-medium"
                          : "font-medium text-muted-foreground"
                      }
                    >
                      {o.name}
                    </span>
                    {o.lifecycleStatus !== "active" && (
                      <Badge
                        variant={lifecycleVariant(o.lifecycleStatus)}
                        className="ml-2 capitalize"
                      >
                        {o.lifecycleStatus}
                      </Badge>
                    )}
                    {!isMatch && (
                      <span className="sr-only"> (shown for context)</span>
                    )}
                    {childSummary && (
                      <div className="text-sm text-muted-foreground">
                        {childSummary}
                      </div>
                    )}
                    <div className="text-sm text-muted-foreground capitalize sm:hidden">
                      {label(o.organizationType)} · {o.platformStatus} ·{" "}
                      {o.hasBrand ? "branded" : "default palette"}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground capitalize sm:table-cell">
                  {label(o.organizationType)}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground capitalize sm:table-cell">
                  {o.platformStatus}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {o.hasBrand ? (
                    <Badge variant="outline">Branded</Badge>
                  ) : (
                    <Badge variant="secondary">Default palette</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {o.brandUpdatedAt ? (
                    <FormattedDate value={o.brandUpdatedAt} mode="date" />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="px-1 text-right">
                  {isMatch && (
                    <Link
                      href={`/admin/organizations/${o.id}`}
                      aria-label={`Manage ${o.name}`}
                      className="inline-flex min-h-11 items-center px-2 text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      Manage
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
