import Link from "next/link";
import { auth } from "@/auth";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { listSitesForAdmin } from "@/lib/sites";
import { Badge } from "@/components/ui/badge";
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
 * `/admin/sites` — the cross-org public-site health list. Mirrors
 * `admin/feedback/page.tsx`'s shape exactly (Phase 3's own instruction):
 * `auth()` + `hasFeature(FEATURES.ADMIN_ORGANIZATIONS)`, one query, a
 * `<Table>`, the same dashed-border empty state. Reuses
 * `FEATURES.ADMIN_ORGANIZATIONS` — no new `FEATURES.*` key (Phase 2's
 * ruling).
 *
 * Not gated by `sites.public_render` — an operator can provision and
 * monitor sites while the public render path stays off (Phase 3's own
 * "Permissions & Flags").
 */

const STATUS_BADGE: Record<string, string> = {
  provisioning:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200",
  live: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200",
  suspended: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export default async function AdminSitesPage() {
  const session = await auth();
  if (!hasFeature(session?.user?.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Sites</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You don&apos;t have permission to view organization sites.
        </p>
      </div>
    );
  }

  const rows = await listSitesForAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sites</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} organization{rows.length !== 1 ? "s" : ""} with a
          public site provisioned.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium">No sites provisioned yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Provision a site from an organization&apos;s detail page to see
            it here.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last ingested</TableHead>
              <TableHead>Provisioned since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.organizationId}>
                <TableCell>
                  <Link
                    href={`/admin/organizations/${row.organizationId}`}
                    className="underline underline-offset-4 hover:no-underline"
                  >
                    {row.organizationName}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{row.repo}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      STATUS_BADGE[row.status] ?? "bg-muted text-muted-foreground"
                    }
                  >
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.lastIngestedAt ? (
                    <FormattedDate value={row.lastIngestedAt} mode="datetime" />
                  ) : (
                    "Never"
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <FormattedDate value={row.createdAt} mode="date" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
