import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { listGroups } from "@/lib/groups";
import { isFlagEnabled } from "@/lib/flags";
import { Button } from "@/components/ui/button";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { GroupsFlagOff, GroupsForbidden, GroupsLoadError } from "./groups-states";
import { GroupsList } from "./groups-list";

const GROUPS_FLAG = "org_portal.groups";

/**
 * `/o/<slug>/admin/groups` — the managed-group list + "New group" entry
 * point. docs/work-log/2026-08-26-groups-admin.md, Phase 3 design, Phase 4
 * commit 2. Repeats the `(org)` auth pattern in full, same as every other
 * page under `(org)` — see `admin/officers/page.tsx`'s header for the fuller
 * rationale on why the auth check lives in the page rather than the layout.
 *
 * THE FLAG CHECK RUNS BEFORE `listGroups()` IS EVER CALLED, same ordering
 * `admin/officers/page.tsx`/`admin/roles/page.tsx` use. `org_portal.groups`
 * is checked BARE — no `organization_feature_toggles` row (Phase 3: neither
 * `officers` nor `roles`, the two closest precedents, carry one either).
 *
 * `listGroups()` THROWS on genuine failure rather than returning a result
 * variant for it (mirrors `officers.ts`'s contract) — `OrgAccessError` is
 * RE-THROWN, not swallowed; anything else renders the load-error state.
 *
 * `canCreate` IS IMPLIED BY `listGroups()`'s OWN "ok" RESULT, not a second,
 * separate permission check — `listGroups()` already required
 * `groups.manage` to succeed at all, so a `forbidden` result short-circuits
 * the whole page before this point (same reasoning `admin/officers/page.tsx`
 * uses for `AddOfficerTermForm` — there is no read-only role for this
 * surface, unlike `admin/members/page.tsx`'s `directory.view`/
 * `people.manage` split).
 */
export default async function GroupsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/groups`)}`,
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

  let result;
  try {
    result = await listGroups(resolved.org.personId, resolved.org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <GroupsLoadError slug={slug} />;
  }

  if (result.kind === "forbidden") {
    return <GroupsForbidden name={resolved.org.name} />;
  }
  if (result.kind !== "ok") {
    return <GroupsLoadError slug={slug} />;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {resolved.org.name}
          </p>
        </div>
        <Button asChild className="min-h-11">
          <Link href={`/o/${slug}/admin/groups/new`}>New group</Link>
        </Button>
      </div>

      <GroupsList slug={slug} entries={result.data} />
    </section>
  );
}
