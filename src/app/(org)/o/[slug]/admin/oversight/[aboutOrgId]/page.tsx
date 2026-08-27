import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
  type OrganizationType,
} from "@/lib/authz";
import { getCongregationOversightDetail } from "@/lib/presbytery";
import { isFlagEnabled } from "@/lib/flags";
import {
  PlaceholderFlagOff,
  PlaceholderNotAvailable,
} from "@/components/org-portal/coming-soon";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import { OversightForbidden, OversightLoadError } from "../oversight-states";
import { OversightEditForm } from "./edit-form";

const OVERSIGHT_FLAG = "org_portal.oversight";
const AREA = "Congregation Oversight";
const OVERSIGHT_ORG_TYPES: readonly OrganizationType[] = ["presbytery"];

/**
 * `/o/<slug>/admin/oversight/<aboutOrgId>` — one congregation's assessment
 * (Flow: click-through from the list, Phase 3 Component/Page Plan). Repeats
 * the `(org)` auth pattern in full, same reason every page under `(org)`
 * does, and the SAME flag/org-type ordering the list page runs.
 *
 * `getCongregationOversightDetail()`'s `invalid_target` (an `aboutOrgId` that
 * isn't an actual member congregation of THIS presbytery — the parent-path
 * check, this file's own `src/lib/presbytery.ts` header) is a real 404, same
 * as `admin/officers/[personId]/page.tsx`'s identical branch for
 * `getOfficerHistory()`.
 */
export default async function OversightDetailPage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string }>;
}) {
  const { slug, aboutOrgId } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/oversight/${aboutOrgId}`)}`,
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
        <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const oversightEnabled = await isFlagEnabled(OVERSIGHT_FLAG);
  if (!oversightEnabled) {
    return <PlaceholderFlagOff area={AREA} orgName={resolved.org.name} />;
  }

  if (!OVERSIGHT_ORG_TYPES.includes(resolved.org.organizationType)) {
    return <PlaceholderNotAvailable area={AREA} orgName={resolved.org.name} />;
  }

  let result;
  try {
    result = await getCongregationOversightDetail(
      resolved.org.personId,
      resolved.org.organizationId,
      aboutOrgId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <OversightLoadError slug={slug} />;
  }

  if (result.kind !== "ok") {
    if (result.kind === "forbidden") {
      return <OversightForbidden name={resolved.org.name} />;
    }
    if (result.kind === "invalid_target") {
      notFound();
    }
    return <OversightLoadError slug={slug} />;
  }

  return (
    <section className="space-y-6">
      <div>
        <Link
          href={`/o/${slug}/admin/oversight`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to oversight
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">{result.data.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}&apos;s own oversight record for this congregation.
        </p>
      </div>
      <OversightEditForm slug={slug} aboutOrgId={aboutOrgId} row={result.data} />
    </section>
  );
}
