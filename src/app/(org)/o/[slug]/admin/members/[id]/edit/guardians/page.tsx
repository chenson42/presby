import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { getGuardianLinksForEdit } from "@/lib/children";
import { OrgAccessDenied, OrgAccessEnded } from "../../../../../org-states";
import {
  MembersFlagOff,
  MembersForbidden,
  MembersLoadError,
} from "../../../members-states";
import { GuardianLinkForm } from "./guardian-link-form";

const CHILDREN_MINISTRY_FLAG = "org_portal.children_ministry";

/**
 * `/o/<slug>/admin/members/<id>/edit/guardians` (docs/work-log/
 * 2026-08-26-childrens-ministry.md, Phase 3, Increment A). A linked
 * sub-screen, mirroring `edit/sensitive/page.tsx`'s structure exactly: own
 * route, own flag-off/forbidden/not-found states, single permission
 * (`children.roster`) instead of four. Checked bare — no
 * `organization_feature_toggles` row (Phase 3: this is a brand-new admin
 * surface reachable only via a fixed permission, the same shape as
 * `org_portal.officers`/`org_portal.groups`).
 *
 * `children.roster` itself is checked inside `getGuardianLinksForEdit()`,
 * not duplicated here.
 */
export default async function EditGuardiansPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(
        `/o/${slug}/admin/members/${id}/edit/guardians`,
      )}`,
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
      <MembersFlagOff name={resolved.org.name} heading="Guardians" />
    );
  }

  let result;
  try {
    result = await getGuardianLinksForEdit(
      resolved.org.personId,
      resolved.org.organizationId,
      id,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return (
      <MembersLoadError
        backHref={`/o/${slug}/admin/members/${id}/edit`}
        heading="Guardians"
      />
    );
  }

  if (result.kind === "forbidden") {
    return <MembersForbidden name={resolved.org.name} heading="Guardians" />;
  }
  if (result.kind === "not_found") {
    notFound();
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Guardians</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
        <Link
          href={`/o/${slug}/admin/members/${id}/edit`}
          className="mt-2 inline-block text-sm text-muted-foreground underline underline-offset-2"
        >
          Back to edit person
        </Link>
      </div>
      <GuardianLinkForm slug={slug} personId={id} links={result.links} />
    </section>
  );
}
