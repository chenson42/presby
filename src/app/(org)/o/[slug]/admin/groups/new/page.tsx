import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getGroupFormOptions } from "@/lib/groups";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import {
  GroupsFlagOff,
  GroupsForbidden,
  GroupsLoadError,
} from "../groups-states";
import { NewGroupForm } from "../new-group-form";

const GROUPS_FLAG = "org_portal.groups";

/**
 * `/o/<slug>/admin/groups/new` — Flow 1. Repeats the `(org)` auth pattern in
 * full, per the officers/roles precedent.
 */
export default async function NewGroupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/groups/new`)}`,
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

  let optionsResult;
  try {
    optionsResult = await getGroupFormOptions(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <GroupsLoadError slug={slug} />;
  }

  if (optionsResult.kind === "forbidden") {
    return <GroupsForbidden name={resolved.org.name} />;
  }
  if (optionsResult.kind !== "ok") {
    return <GroupsLoadError slug={slug} />;
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New group</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>
      <NewGroupForm slug={slug} options={optionsResult.data} />
    </section>
  );
}
