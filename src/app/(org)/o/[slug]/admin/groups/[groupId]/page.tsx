import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getGroup, getGroupFormOptions } from "@/lib/groups";
import { isFlagEnabled } from "@/lib/flags";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import {
  GroupsFlagOff,
  GroupsForbidden,
  GroupsLoadError,
} from "../groups-states";
import { GROUP_ROLE_LABELS } from "../group-type-labels";
import { AddGroupMemberForm } from "../add-group-member-form";
import { EndGroupMembershipDialog } from "../end-group-membership-dialog";

const GROUPS_FLAG = "org_portal.groups";

/**
 * `/o/<slug>/admin/groups/<groupId>` — a managed group's own detail plus its
 * roster (Flow 3/4/5). docs/work-log/2026-08-26-groups-admin.md.
 *
 * `getGroup()`'s `{ kind: "invalid_target" }` (a nonexistent id, OR a
 * DERIVED group's id typed directly into the URL) is a real 404, not a load
 * error — same discipline `admin/officers/[personId]/page.tsx` documents
 * for `invalid_target`. This is the load-bearing half of Flow 2/4's guard
 * at the detail level: a derived group's roster is never rendered by this
 * page at all, so no "End membership" control on a Session/Diaconate row is
 * ever reachable through this route.
 *
 * MOBILE (360px), VERIFIED IN A REAL BROWSER (Workflow Rule, "Verify in a
 * Browser") — the roster `Table`'s first draft rendered Person/Role/Since/
 * Ends/Actions unconditionally and, at 360px, silently scrolled Ends and the
 * "End membership" action entirely off-screen inside the table's own
 * horizontal-scroll wrapper with no visible affordance more columns
 * existed — a real walkthrough caught it; a passing test suite (which does
 * not compute layout) did not. `Role`/`Since` now hide below `sm:`, mirroring
 * `officer-roster.tsx`'s own identical finding and fix: the always-visible
 * set (Person, Ends, the End-membership action) is what answers "who is
 * currently active and can I end their membership right now" without
 * scrolling on a phone; Role/Since are still readable at `sm:` and above,
 * only deferred past the breakpoint.
 */
export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ slug: string; groupId: string }>;
}) {
  const { slug, groupId } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/groups/${groupId}`)}`,
    );
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied
          name={resolved.name}
          organizationType={resolved.organizationType}
          slug={slug}
        />
      );
    case "ended":
      return (
        <OrgAccessEnded
          name={resolved.name}
          endedOn={resolved.endedOn}
          slug={slug}
        />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const groupsEnabled = await isFlagEnabled(GROUPS_FLAG);
  if (!groupsEnabled) {
    return <GroupsFlagOff name={resolved.org.name} />;
  }

  let groupResult;
  let people: Array<{ personId: string; displayName: string }> = [];
  try {
    groupResult = await getGroup(
      resolved.org.personId,
      resolved.org.organizationId,
      groupId,
    );
    const optionsResult = await getGroupFormOptions(
      resolved.org.personId,
      resolved.org.organizationId,
    );
    if (optionsResult.kind === "ok") {
      people = optionsResult.data.people;
    }
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <GroupsLoadError slug={slug} />;
  }

  if (groupResult.kind === "forbidden") {
    return <GroupsForbidden name={resolved.org.name} />;
  }
  if (groupResult.kind === "invalid_target") {
    notFound();
  }
  if (groupResult.kind !== "ok") {
    return <GroupsLoadError slug={slug} />;
  }

  const group = groupResult.data;

  return (
    <section className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {group.groupTypeName}
          {group.meetsWhen ? ` · ${group.meetsWhen}` : ""}
        </p>
        {group.description && (
          <p className="mt-2 text-sm text-muted-foreground">
            {group.description}
          </p>
        )}
        <Link
          href={`/o/${slug}/admin/groups/${groupId}/edit`}
          className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Edit group
        </Link>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Roster</h2>
        {group.roster.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-sm font-medium">No members yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the form below to add the first one.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="hidden sm:table-cell">Role</TableHead>
                <TableHead className="hidden sm:table-cell">Since</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.roster.map((entry) => (
                <TableRow key={entry.groupMembershipId}>
                  <TableCell className="max-w-[6rem] font-medium whitespace-normal sm:max-w-none sm:whitespace-nowrap">
                    {entry.displayName}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {GROUP_ROLE_LABELS[entry.groupRole]}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <FormattedDate value={entry.startsOn} mode="date" />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.endsOn ? (
                      <FormattedDate value={entry.endsOn} mode="date" />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.endsOn === null && (
                      <EndGroupMembershipDialog
                        slug={slug}
                        groupMembershipId={entry.groupMembershipId}
                        groupId={groupId}
                        personId={entry.personId}
                        personName={entry.displayName}
                        groupName={group.name}
                        startsOn={entry.startsOn}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="max-w-md space-y-4">
        <h2 className="text-xl font-semibold">Add a member</h2>
        <p className="text-sm text-muted-foreground">
          This is descriptive only — granting software access (Administration
          → Roles) is done separately.
        </p>
        <AddGroupMemberForm slug={slug} groupId={groupId} people={people} />
      </div>
    </section>
  );
}
