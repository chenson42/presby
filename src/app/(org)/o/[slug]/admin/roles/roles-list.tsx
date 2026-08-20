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
import type { GrantListEntry } from "@/lib/role-grants";
import { RevokeDialog } from "./revoke-dialog";

/**
 * "Who holds what, right now" — a `Table`, not cards. This is genuinely
 * wide-column data (role, grantee, granter, since, an action), the opposite
 * of `directory/directory-list.tsx`'s single-column card rationale.
 *
 * FINDING 4, THE ARM-1 CASCADE GAP, IS SURFACED HERE — NOT FIXED. A
 * person-arm grant whose `membershipEnded` is non-null gets a visible
 * `Badge`, not a filtered-out row and not a silently-continuing one. See
 * `src/lib/role-grants.ts`'s module header for the full finding.
 */
export function RolesList({
  grants,
  slug,
}: {
  grants: GrantListEntry[];
  slug: string;
}) {
  if (grants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No roles are granted yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the form below to grant the first one.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Role</TableHead>
          <TableHead>Granted to</TableHead>
          <TableHead>Granted by</TableHead>
          <TableHead>Since</TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {grants.map((grant) => {
          const granteeName =
            grant.grantee.kind === "person"
              ? grant.grantee.displayName
              : grant.grantee.groupName;
          const granteeId =
            grant.grantee.kind === "person"
              ? grant.grantee.personId
              : grant.grantee.groupId;

          return (
            <TableRow key={grant.grantId}>
              <TableCell className="font-medium">{grant.roleName}</TableCell>
              <TableCell>
                <span className="inline-flex flex-wrap items-center gap-2 whitespace-normal">
                  {granteeName}
                  {grant.grantee.kind === "group" && (
                    <span className="text-muted-foreground">(group)</span>
                  )}
                  {grant.grantee.kind === "person" &&
                    grant.grantee.membershipEnded !== null && (
                      <Badge variant="outline" className="font-normal">
                        Membership ended{" "}
                        <FormattedDate
                          value={grant.grantee.membershipEnded}
                          mode="date"
                        />
                      </Badge>
                    )}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {grant.grantedByEmail ?? "—"}
              </TableCell>
              <TableCell>
                <FormattedDate value={grant.startsOn} mode="date" />
              </TableCell>
              <TableCell>
                <RevokeDialog
                  slug={slug}
                  grantId={grant.grantId}
                  roleId={grant.roleId}
                  roleKey={grant.roleKey}
                  roleName={grant.roleName}
                  granteeType={grant.grantee.kind}
                  granteeId={granteeId}
                  granteeName={granteeName}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
