import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { listFeatureToggles } from "@/lib/org-features";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  FeaturesFlagOff,
  FeaturesForbidden,
  FeaturesLoadError,
} from "./features-states";
import { FeaturesList } from "./features-list";

/**
 * `/o/<slug>/admin/features` — per-org feature enablement (Deliverable A,
 * DECISION-097, docs/work-log/2026-08-25-member-management.md Phase 3).
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, same as `admin/roles/page.tsx` —
 * see that file's header for the fuller rationale on why the auth check
 * lives in the page rather than the layout.
 *
 * THE FLAG CHECK RUNS BEFORE `listFeatureToggles()` IS EVER CALLED, same
 * "flag answers 'is this on at all', permission answers 'may THIS person'"
 * split every other `org_portal.*` page in this tree already follows.
 * `org_portal.features` is its own flag, checked ONLY here — it never
 * appears in the `isOrgFeatureEnabled` resolver's own three-axis composition, because
 * this page IS the mechanism that gates other features, not a consumer of
 * it. There is no circular gate: this page's own reachability rides on the
 * plain global kill switch + the `org_features.manage` permission, exactly
 * like every other `org_portal.*` page — not on the `organization_feature_
 * toggles` table it exists to administer.
 *
 * `listFeatureToggles()` THROWS on genuine failure rather than returning a
 * result variant for it, matching `listGrants()`'s own contract.
 * `OrgAccessError` is RE-THROWN, not swallowed — `[slug]/error.tsx` already
 * has the correct copy for that case, one level up.
 */
export default async function FeaturesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/features`)}`,
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

  // The authoritative gate — see `../../page.tsx`'s identical call for the
  // full rationale. Every `(org)` page calls it, including this one.
  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const featuresEnabled = await isFlagEnabled("org_portal.features");
  if (!featuresEnabled) {
    return <FeaturesFlagOff name={resolved.org.name} />;
  }

  let togglesResult;
  try {
    togglesResult = await listFeatureToggles(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <FeaturesLoadError slug={slug} />;
  }

  if (togglesResult.kind === "forbidden") {
    return <FeaturesForbidden name={resolved.org.name} />;
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Features</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Turn optional portal features on or off for {resolved.org.name}.
        </p>
      </div>

      <FeaturesList slug={slug} toggles={togglesResult.toggles} />
    </section>
  );
}
