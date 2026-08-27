import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, resolveOrgContext } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { ComingSoon, PlaceholderFlagOff } from "@/components/org-portal/coming-soon";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";

const INSIGHTS_FLAG = "org_portal.insights";
const AREA = "Insights & Analytics";
const DESCRIPTION =
  "Dashboards, trends, and per-capita/membership insights — universal across every organization type, planned but not yet built.";

/**
 * `/o/<slug>/admin/insights` — one of the 7 product-IA placeholder routes,
 * docs/work-log/2026-08-27-product-ia-scaffold.md (Phase 3 §3, DECISION-117).
 * An inert "coming soon" stub: no data read, no mutation.
 *
 * Repeats the `(org)` auth pattern in full (DECISION-040), same as every
 * other page under `(org)` — see `admin/credentials/page.tsx`'s header for
 * the fuller rationale on why the auth check lives in the page rather than
 * the layout. THE FLAG CHECK RUNS AFTER `assertOrgAccess()`, same ordering
 * every other flag-gated page in this tree uses.
 *
 * Universal tile (no `orgTypeScope`), deliberately kept separate from
 * `reports` (Phase 3 §1): `insights` is for every organization type, while
 * `reports` is presbytery-only back-office compliance filing — different
 * audiences, different `orgTypeScope`, must not share a tile or a route.
 */
export default async function InsightsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/insights`)}`);
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

  const insightsEnabled = await isFlagEnabled(INSIGHTS_FLAG);
  if (!insightsEnabled) {
    return <PlaceholderFlagOff area={AREA} orgName={resolved.org.name} />;
  }

  return <ComingSoon area={AREA} description={DESCRIPTION} slug={slug} />;
}
