import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { listPendingRollActions } from "@/lib/roll";
import { isFlagEnabled } from "@/lib/flags";
import { isOrgFeatureEnabled } from "@/lib/org-features";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import {
  MembersFlagOff,
  MembersForbidden,
  MembersLoadError,
} from "../members-states";
import { PendingWorklist } from "./pending-worklist";

const MEMBERS_CREATE_FLAG = "org_portal.members_create";

/**
 * `/o/<slug>/admin/members/pending` — the approve/deny worklist
 * (Deliverable B's fold-in, Phase 1's "a propose-only Increment 1 ships
 * people invisible in the directory" gap). Same two-axis gate as every
 * other `admin/members*` page: `org_portal.members_create` (flag) AND its
 * matching `organization_feature_toggles` row.
 *
 * `listPendingRollActions()` is gated on `roll.approve` internally, checked
 * inside its own `withOrgContext()` transaction — not re-checked here.
 */
export default async function PendingMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/members/pending`)}`,
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

  const flagOn = await isFlagEnabled(MEMBERS_CREATE_FLAG);
  const toggleOn = flagOn
    ? await isOrgFeatureEnabled(
        resolved.org.personId,
        resolved.org.organizationId,
        MEMBERS_CREATE_FLAG,
      )
    : false;
  if (!flagOn || !toggleOn) {
    return (
      <MembersFlagOff name={resolved.org.name} heading="Pending approvals" />
    );
  }

  let result;
  try {
    result = await listPendingRollActions(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return (
      <MembersLoadError
        backHref={`/o/${slug}/admin/members/pending`}
        heading="Pending approvals"
      />
    );
  }

  if (result.kind === "forbidden") {
    return (
      <MembersForbidden name={resolved.org.name} heading="Pending approvals" />
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pending approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>

      <PendingWorklist slug={slug} actions={result.actions} />
    </section>
  );
}
