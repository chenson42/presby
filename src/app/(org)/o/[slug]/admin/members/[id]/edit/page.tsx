import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { isOrgFeatureEnabled } from "@/lib/org-features";
import { getHouseholds } from "@/lib/directory";
import { getPersonForEdit } from "@/lib/people";
import { OrgAccessDenied, OrgAccessEnded } from "../../../../org-states";
import {
  MembersFlagOff,
  MembersForbidden,
  MembersLoadError,
} from "../../members-states";
import { EditPersonForm } from "./edit-person-form";

const MEMBERS_CREATE_FLAG = "org_portal.members_create";

/**
 * `/o/<slug>/admin/members/<id>/edit` — Increment 2 (docs/work-log/
 * 2026-08-26-member-management-edit-person.md). A thin server page: auth →
 * flag → org-toggle → read the person → render the client form. The
 * `people.manage` permission check happens inside `getPersonForEdit()`/
 * `updatePerson()`, not duplicated here, same discipline as `admin/
 * members/new/page.tsx`. Rides the SAME flag/toggle as Increment 1 — this
 * is additive to the existing `/admin/members` surface, not a new one.
 */
export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/members/${id}/edit`)}`,
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
    return <MembersFlagOff name={resolved.org.name} />;
  }

  let personResult;
  let households: { householdId: string; name: string }[] = [];
  try {
    personResult = await getPersonForEdit(
      resolved.org.personId,
      resolved.org.organizationId,
      id,
    );
    const householdsResult = await getHouseholds(
      resolved.org.personId,
      resolved.org.organizationId,
    );
    if (householdsResult.kind === "ok") {
      households = householdsResult.households.map((h) => ({
        householdId: h.householdId,
        name: h.name,
      }));
    }
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <MembersLoadError backHref={`/o/${slug}/admin/members`} />;
  }

  if (personResult.kind === "forbidden") {
    return (
      <MembersForbidden name={resolved.org.name} heading="Edit person" />
    );
  }
  if (personResult.kind === "not_found") {
    notFound();
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit person</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>
      <EditPersonForm
        slug={slug}
        person={personResult.person}
        households={households}
      />
    </section>
  );
}
