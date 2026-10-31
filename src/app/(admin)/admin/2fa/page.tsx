import Link from "next/link";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { listStranded } from "@/lib/admin/two-factor-stranded";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TwoFactorPolicyToggle } from "./policy-toggle";

/**
 * Two-factor policy.
 *
 * This route used to be a second copy of /account/2fa — enrol yourself,
 * regenerate your own recovery codes — sitting in the admin section under the
 * label "Your 2FA". Self-enrolment now lives in exactly one place, and this
 * route answers the question an administrator actually has: which congregations
 * require two-factor, and who has not enrolled yet.
 *
 * Reads go through getPlatformDb() because listing every organization on the
 * RLS-enforced connection returns zero rows — there is no org context on an
 * admin page, which is precisely what the second connection is for.
 */

type OrgRow = {
  id: string;
  name: string;
  organization_type: string;
  require_two_factor: boolean;
  member_count: number;
};

const STRANDED_LIMIT = 50;

// The module returns tokens (src/lib/admin/two-factor-stranded.ts, first reason
// found); the page owns the words. An unknown value shows as is.
const SOURCE_LABEL: Record<string, string> = {
  "this user": "Own setting",
  congregation: "Congregation policy",
  role: "A role",
};

export default async function TwoFactorPolicyPage() {
  const session = await auth();
  if (!hasFeature(session?.user?.features, FEATURES.ADMIN_TWO_FACTOR)) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Two-factor policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You don&apos;t have permission to manage two-factor policy.
        </p>
      </div>
    );
  }

  const platformDb = getPlatformDb();

  const orgs = await platformDb.execute(sql`
    SELECT o.id,
           o.name,
           o.organization_type::text          AS organization_type,
           coalesce(s.require_two_factor, false) AS require_two_factor,
           count(m.id) FILTER (WHERE m.ended_on IS NULL)::int AS member_count
      FROM organizations o
      LEFT JOIN organization_settings s ON s.organization_id = o.id
      LEFT JOIN memberships m           ON m.organization_id = o.id
     GROUP BY o.id, o.name, o.organization_type, s.require_two_factor
     ORDER BY o.organization_type, o.name
  `);

  // Required but not enrolled. These are the people who will hit the challenge
  // and cannot answer it — the stranded-member case, which is the whole reason
  // an administrator opens this page. `source` says WHY they are required, so
  // it is obvious whether to flip a congregation's policy, look at a role, or
  // open the user's own row.
  // The predicate is shared with the dashboard's Two-factor card
  // (src/lib/admin/two-factor-stranded.ts), so the card and this list cannot
  // disagree. The per-organization `member_count` above stays in this file.
  const stranded = await listStranded(STRANDED_LIMIT);

  const orgRows = orgs.rows as unknown as OrgRow[];
  const strandedRows = stranded.rows;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Two-factor policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        When two-factor enforcement is on for the installation, a person is
        required to use two-factor sign-in if any one of these is true: their
        own account setting requires it, they hold a role that requires it
        (giving, creating and granting roles, or website domains), or a
        congregation they belong to requires it. The stricter setting wins,
        because the requirement is resolved at sign-in, before anyone has chosen
        an organization.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        A platform administrator&apos;s own setting is switched on when the role
        is granted through the application. It can be switched off on their user
        page; a role or a congregation&apos;s policy cannot be switched off
        there.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Enrolling in two-factor for your own account is at{" "}
        <Link href="/account/2fa" className="underline">
          Account → Two-factor
        </Link>
        . Resetting someone else&apos;s is on their user page.
      </p>

      <h2 className="mt-8 text-sm font-semibold">Congregations</h2>
      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Requires 2FA</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-muted-foreground">
                No organizations yet.
              </TableCell>
            </TableRow>
          ) : (
            orgRows.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{o.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {o.organization_type.replace(/_/g, " ")}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {o.member_count}
                </TableCell>
                <TableCell>
                  {o.require_two_factor ? (
                    <Badge
                      variant="outline"
                      className="bg-green-500/15 text-green-700 dark:text-green-300"
                    >
                      required
                    </Badge>
                  ) : (
                    <Badge variant="secondary">optional</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <TwoFactorPolicyToggle
                    organizationId={o.id}
                    organizationName={o.name}
                    required={o.require_two_factor}
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <h2 className="mt-10 text-sm font-semibold">
        Required, but not enrolled
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        These accounts are required to use two-factor but have not set it up
        yet. While enforcement is on, they are taken to set it up before they
        can open the admin area or a congregation&apos;s portal. Open an account
        to see or change its own setting; a role or a congregation&apos;s policy
        still applies when its own setting is off.
      </p>
      {stranded.total > strandedRows.length ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Showing the first {strandedRows.length} of {stranded.total} accounts.
        </p>
      ) : null}
      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Required by</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {strandedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-muted-foreground">
                Nobody is required without being enrolled.
              </TableCell>
            </TableRow>
          ) : (
            strandedRows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.email}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.name ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {SOURCE_LABEL[u.source] ?? u.source}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/admin/users/${u.id}`}
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
