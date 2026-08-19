import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { organizations, organizationBrands } from "@/lib/db/domain/org";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";

/**
 * Organizations — the platform operator's minimal `(admin)` brand surface
 * (S18, P0.5 slice c, commit `c3`). Sets a congregation's brand at
 * onboarding and is where the abuse-neutralization action lives (detail
 * page).
 *
 * getPlatformDb() throughout — no membership exists for a platform operator
 * (see `[id]/actions.ts`'s header comment). The gate is rendered INLINE, not
 * a redirect(), matching `/admin/2fa`'s pattern exactly rather than the
 * redirect()-to-/access-pending shape some other admin pages use.
 *
 * THIS PAGE IS ALSO OQ4'S REPORT ("congregations still on the default
 * palette"). Mechanism: fetch every organization once with a LEFT JOIN
 * against `organization_brands`, then a `?filter=unbranded` query param
 * toggles which subset is DISPLAYED from that same result set — one page,
 * one query, a filter rather than a second surface, matching the
 * Phase 3 design's "a checkbox or toggle on the same list, not a second
 * page."
 */

type OrgRow = {
  id: string;
  name: string;
  organizationType: string;
  platformStatus: string;
  hasBrand: boolean;
  brandUpdatedAt: Date | null;
};

export default async function OrganizationsListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await auth();
  if (!hasFeature(session?.user?.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You don&apos;t have permission to manage organization branding.
        </p>
      </div>
    );
  }

  const sp = await searchParams;
  const onlyUnbranded = sp.filter === "unbranded";

  const platformDb = getPlatformDb();

  const rawRows = await platformDb
    .select({
      id: organizations.id,
      name: organizations.name,
      organizationType: organizations.organizationType,
      platformStatus: organizations.platformStatus,
      brandUpdatedAt: organizationBrands.updatedAt,
      brandOrgId: organizationBrands.organizationId,
    })
    .from(organizations)
    .leftJoin(
      organizationBrands,
      eq(organizationBrands.organizationId, organizations.id),
    )
    .orderBy(organizations.organizationType, organizations.name);

  const allRows: OrgRow[] = rawRows.map((r) => ({
    id: r.id,
    name: r.name,
    organizationType: r.organizationType,
    platformStatus: r.platformStatus,
    hasBrand: r.brandOrgId !== null,
    brandUpdatedAt: r.brandUpdatedAt,
  }));

  const unbrandedCount = allRows.filter((r) => !r.hasBrand).length;
  const rows = onlyUnbranded ? allRows.filter((r) => !r.hasBrand) : allRows;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Organizations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set a congregation&apos;s brand colour, logo and type pairing —
        typically done once, on the onboarding call. This is also where an
        abusive tenant&apos;s brand is neutralised.
      </p>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-border pb-3">
        <Button asChild variant={!onlyUnbranded ? "default" : "ghost"} size="sm">
          <Link href="/admin/organizations">All ({allRows.length})</Link>
        </Button>
        <Button
          asChild
          variant={onlyUnbranded ? "default" : "ghost"}
          size="sm"
        >
          <Link href="/admin/organizations?filter=unbranded">
            Still on default palette ({unbrandedCount})
          </Link>
        </Button>
      </div>

      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Platform status</TableHead>
            <TableHead>Branding</TableHead>
            <TableHead>Last updated</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-muted-foreground">
                {onlyUnbranded
                  ? "Every organization has a brand set."
                  : "No organizations yet."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {o.organizationType.replace(/_/g, " ")}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground capitalize">
                  {o.platformStatus}
                </TableCell>
                <TableCell>
                  {o.hasBrand ? (
                    <Badge
                      variant="outline"
                      className="bg-green-500/15 text-green-700 dark:text-green-300"
                    >
                      Branded
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Default palette</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {o.brandUpdatedAt ? (
                    <FormattedDate value={o.brandUpdatedAt} mode="date" />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/admin/organizations/${o.id}`}
                    className="text-xs underline"
                  >
                    Manage
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
