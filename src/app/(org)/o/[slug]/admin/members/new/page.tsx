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
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import { MembersFlagOff, MembersLoadError } from "../members-states";
import { MemberWizard } from "./member-wizard";

const MEMBERS_CREATE_FLAG = "org_portal.members_create";

/**
 * `/o/<slug>/admin/members/new` — the add-a-person wizard (Deliverable B,
 * Increment 1). A thin server page: auth → flag → org-toggle → render the
 * client wizard. Every PERMISSION check (`people.manage`, `roll.propose`)
 * happens inside `src/lib/people.ts`, not duplicated here — this page only
 * decides whether the wizard is reachable at all, per Phase 3's design.
 *
 * `getHouseholds()` supplies the household picker's options. Its own
 * `directory.view` gate is a KNOWN, NAMED Increment-1 coupling (Phase 3): a
 * `people.manage` holder who somehow lacks `directory.view` sees an empty
 * household list rather than a forbidden page — the wizard degrades to
 * "no existing households to pick from" rather than blocking the whole
 * flow, since attaching to a household is optional (`household.mode:
 * "none"` is always available).
 */
export default async function NewMemberPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/members/new`)}`,
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

  let households: { householdId: string; name: string }[] = [];
  try {
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
    // { kind: "forbidden" } — degrade to an empty household list, per this
    // file's own header note. Not a page-level failure.
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <MembersLoadError backHref={`/o/${slug}/admin/members`} />;
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a person</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>
      <MemberWizard slug={slug} households={households} />
    </section>
  );
}
