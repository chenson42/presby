import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  resolveOrgContext,
  type OrganizationType,
} from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import {
  ComingSoon,
  PlaceholderFlagOff,
  PlaceholderNotAvailable,
} from "@/components/org-portal/coming-soon";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";

const REPORTS_FLAG = "org_portal.reports";
const AREA = "Per-Capita, SASR & Imports";
const DESCRIPTION =
  "Per-capita/SASR rollup (Presbytery Increment 4, BLOCKED on a real publication mechanism) and data-import housekeeping (Presbytery Increment 5) — planned but not yet built.";

/**
 * `/o/<slug>/admin/reports` — one of the 7 product-IA placeholder routes,
 * docs/work-log/2026-08-27-product-ia-scaffold.md (Phase 3 §1/§3,
 * DECISION-117). An inert "coming soon" stub: no data read, no mutation.
 *
 * Repeats the `(org)` auth pattern in full (DECISION-040), same as every
 * other page under `(org)` — see `admin/credentials/page.tsx`'s header for
 * the fuller rationale on why the auth check lives in the page rather than
 * the layout.
 *
 * THREE CHECKS, IN THIS ORDER, mirroring `admin/credentials/page.tsx`'s own
 * bug-fixed ordering: flag, then org type. A congregation/synod/GA org with
 * the flag ON must land on `PlaceholderNotAvailable`, not
 * `PlaceholderFlagOff` — the org-type check runs strictly AFTER the flag
 * check (flag-off wins regardless of org type, same as `credentials`).
 *
 * This tile's `category` is `"administer"` (`src/lib/org-portal/tiles.ts`),
 * unlike its `domain`-sibling `insights` (`"operate"`) — presbytery
 * back-office/compliance filing lives on the admin hub, not the home page.
 * The route itself is unaffected by that distinction; only which page's
 * `visiblePortalTiles()` call surfaces its tile differs.
 */
const REPORTS_ORG_TYPES: readonly OrganizationType[] = ["presbytery"];

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/reports`)}`);
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

  const reportsEnabled = await isFlagEnabled(REPORTS_FLAG);
  if (!reportsEnabled) {
    return <PlaceholderFlagOff area={AREA} orgName={resolved.org.name} />;
  }

  if (!REPORTS_ORG_TYPES.includes(resolved.org.organizationType)) {
    return <PlaceholderNotAvailable area={AREA} orgName={resolved.org.name} />;
  }

  return <ComingSoon area={AREA} description={DESCRIPTION} slug={slug} />;
}
