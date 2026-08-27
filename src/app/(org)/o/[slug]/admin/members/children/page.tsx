import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { getChildrenRoster } from "@/lib/children";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import {
  MembersFlagOff,
  MembersForbidden,
  MembersLoadError,
} from "../members-states";
import { ChildrenRosterList } from "./children-roster-list";

const CHILDREN_MINISTRY_FLAG = "org_portal.children_ministry";

/**
 * `/o/<slug>/admin/members/children` — the children's roster (docs/
 * work-log/2026-08-26-childrens-ministry.md, Phase 3, Increment A). A
 * FILTERED VIEW of the existing `admin/members/` tree, not a parallel data
 * path (DECISION-111 placement ruling): same auth → flag → read shape as
 * every other page here, gated on `org_portal.children_ministry` (bare — no
 * `organization_feature_toggles` row, same shape as `org_portal.officers`/
 * `org_portal.groups`), then calls `getChildrenRoster()`, which does its
 * own `children.roster` check.
 */
export default async function ChildrenRosterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/members/children`)}`,
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

  const flagOn = await isFlagEnabled(CHILDREN_MINISTRY_FLAG);
  if (!flagOn) {
    return (
      <MembersFlagOff name={resolved.org.name} heading="Children's roster" />
    );
  }

  let result;
  try {
    result = await getChildrenRoster(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return (
      <MembersLoadError
        backHref={`/o/${slug}/admin/members`}
        heading="Children's roster"
      />
    );
  }

  if (result.kind === "forbidden") {
    return (
      <MembersForbidden name={resolved.org.name} heading="Children's roster" />
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Children&apos;s roster</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>
      <ChildrenRosterList slug={slug} children={result.children} />
    </section>
  );
}
