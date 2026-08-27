import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { isOrgFeatureEnabled } from "@/lib/org-features";
import { getSensitiveInfoForEdit } from "@/lib/person-sensitive";
import { OrgAccessDenied, OrgAccessEnded } from "../../../../../org-states";
import {
  MembersFlagOff,
  MembersForbidden,
  MembersLoadError,
} from "../../../members-states";
import { SensitiveInfoForm } from "./sensitive-info-form";

const SENSITIVE_INFO_FLAG = "org_portal.sensitive_info";

/**
 * `/o/<slug>/admin/members/<id>/edit/sensitive` (docs/work-log/
 * 2026-08-26-member-sensitive-info.md, DECISION-108). A linked sub-screen,
 * not a section on `edit/page.tsx` — the four permissions gating this page
 * are independent of `people.manage`, so a `people.manage`-only viewer never
 * pays for four extra `presby_has_permission()` checks on the main edit
 * page (architect's Phase 2 placement ruling).
 *
 * Gate order (DECISION-097's three-axis pattern): flag ->
 * org toggle -> the four permission checks, which live inside
 * `getSensitiveInfoForEdit()` itself, not duplicated here. `forbidden` means
 * the viewer holds NONE of the four permissions; `not_found` collapses
 * "no such person" and "not visible in this org" the same way
 * `getPersonForEdit` does (enumeration safety).
 */
export default async function EditSensitiveInfoPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(
        `/o/${slug}/admin/members/${id}/edit/sensitive`,
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

  const flagOn = await isFlagEnabled(SENSITIVE_INFO_FLAG);
  const toggleOn = flagOn
    ? await isOrgFeatureEnabled(
        resolved.org.personId,
        resolved.org.organizationId,
        SENSITIVE_INFO_FLAG,
      )
    : false;
  if (!flagOn || !toggleOn) {
    return (
      <MembersFlagOff name={resolved.org.name} heading="Sensitive information" />
    );
  }

  let result;
  try {
    result = await getSensitiveInfoForEdit(
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
        heading="Sensitive information"
      />
    );
  }

  if (result.kind === "forbidden") {
    return (
      <MembersForbidden
        name={resolved.org.name}
        heading="Sensitive information"
      />
    );
  }
  if (result.kind === "not_found") {
    notFound();
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sensitive information</h1>
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
      <SensitiveInfoForm slug={slug} personId={id} data={result.data} />
    </section>
  );
}
