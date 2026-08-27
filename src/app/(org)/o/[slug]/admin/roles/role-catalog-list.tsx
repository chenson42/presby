import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { RoleDefinitionEntry } from "@/lib/role-definitions";

/**
 * "What roles exist at this org, and what do they carry" — the third
 * section of `/o/<slug>/admin/roles`, only rendered when the viewer holds
 * `roles.manage` (docs/work-log/2026-08-26-role-permissions-admin.md, Phase
 * 3 Component Plan). A `Table`, matching `roles-list.tsx`'s own rationale —
 * genuinely wide-column data (name, key, permission count, holder count,
 * status, an action), not single-column card content.
 *
 * "Edit" IS OMITTED FOR `isProtected` ROWS — constitutional roles
 * (`role_admin`, and any future seeded role) are read-only through this UI;
 * their permission bindings are code/migration-managed (DECISION-106 ruling
 * 5). `edit/page.tsx` also re-checks this server-side (`RoleDefinitionProtected`)
 * for anyone who guesses the URL directly — this list omitting the link is a
 * convenience, not the only gate.
 */
export function RoleCatalogList({
  roles,
  slug,
}: {
  roles: RoleDefinitionEntry[];
  slug: string;
}) {
  if (roles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No custom roles yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create one, or adopt a stock template, to get started.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Key</TableHead>
          <TableHead>Permissions</TableHead>
          <TableHead>Holders</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {roles.map((role) => (
          <TableRow key={role.id}>
            <TableCell className="font-medium">{role.name}</TableCell>
            <TableCell className="text-muted-foreground">{role.key}</TableCell>
            <TableCell>{role.permissionKeys.length}</TableCell>
            <TableCell>{role.holderCount}</TableCell>
            <TableCell>
              {role.deactivatedAt ? (
                <Badge variant="outline">
                  Deactivated{" "}
                  <FormattedDate value={role.deactivatedAt} mode="date" />
                </Badge>
              ) : role.isProtected ? (
                <Badge variant="secondary">Constitutional</Badge>
              ) : (
                <Badge variant="outline">Active</Badge>
              )}
            </TableCell>
            <TableCell>
              {!role.isProtected && (
                <Link
                  href={`/o/${slug}/admin/roles/${role.id}/edit`}
                  className="text-sm text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Edit
                </Link>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
