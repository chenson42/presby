import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getGroup } from "@/lib/groups";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../../../org-states";
import {
  GroupsFlagOff,
  GroupsForbidden,
  GroupsLoadError,
} from "../../groups-states";
import { EditGroupForm } from "../../edit-group-form";

const GROUPS_FLAG = "org_portal.groups";

/**
 * `/o/<slug>/admin/groups/<groupId>/edit` — Flow 2.
 *
 * `getGroup()`'s `{ kind: "invalid_target" }` RESOLVES THIS ROUTE TO A REAL
 * 404 — NOT A LOAD ERROR, AND NOT LEFT TO A CLIENT-SIDE "NO EDIT BUTTON"
 * OMISSION. This is the exact load-bearing guard Phase 3's Edge Cases & Risks
 * names: `getGroup()` scopes its query to `membership_source = 'managed'`,
 * so a derived group's id (Session, Board of Deacons, Active Membership),
 * reached by typing its id directly into this URL, resolves `invalid_target`
 * here exactly as a nonexistent id would — this page never renders
 * `EditGroupForm` for one. The migration's `groups_reject_derived_edit`
 * trigger (`drizzle/0033_presby_groups_administration.sql`) is the
 * database-layer half of the same guard; this page's `notFound()` call is
 * the application-layer half, and neither substitutes for the other.
 */
export default async function EditGroupPage({
  params,
}: {
  params: Promise<{ slug: string; groupId: string }>;
}) {
  const { slug, groupId } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/groups/${groupId}/edit`)}`,
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
  try {
    groupResult = await getGroup(
      resolved.org.personId,
      resolved.org.organizationId,
      groupId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <GroupsLoadError slug={slug} />;
  }

  if (groupResult.kind === "forbidden") {
    return <GroupsForbidden name={resolved.org.name} />;
  }
  // The load-bearing guard: a nonexistent id AND a derived group's id both
  // resolve here, indistinguishably — a real 404, never rendered as
  // EditGroupForm.
  if (groupResult.kind === "invalid_target") {
    notFound();
  }
  if (groupResult.kind !== "ok") {
    return <GroupsLoadError slug={slug} />;
  }

  const group = groupResult.data;

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit group</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>
      <EditGroupForm
        slug={slug}
        groupId={groupId}
        name={group.name}
        description={group.description}
        meetsWhen={group.meetsWhen}
      />
    </section>
  );
}
