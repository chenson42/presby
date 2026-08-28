import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { listFeatureToggles } from "@/lib/org-features";
import {
  listFeatureCategories,
  type FeatureCategoryEntry,
} from "@/lib/org-feature-categories";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  FeaturesFlagOff,
  FeaturesForbidden,
  FeaturesLoadError,
} from "./features-states";
import { FeaturesList } from "./features-list";
import { FeatureCategoriesList } from "./feature-categories-list";

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

  // Category-picker section (docs/work-log/2026-08-27-feature-categories.md,
  // Phase 3; DECISION-130): a SECOND, dedicated flag, checked separately from
  // org_portal.features above — the category axis's own dark-until-shipped
  // rollout lever, independent of the already-functioning toggle list. `null`
  // means "don't render the section at all" (flag off), never "render it
  // empty" — offeredCategories() is never actually empty for any
  // organization type, so a `[]` result (flag on) still renders the section.
  const categoriesFlagEnabled = await isFlagEnabled(
    "org_portal.feature_categories",
  );

  let categories: FeatureCategoryEntry[] | null = null;
  let togglesResult: Awaited<ReturnType<typeof listFeatureToggles>> | {
    kind: "forbidden";
  };
  try {
    if (categoriesFlagEnabled) {
      const categoriesResult = await listFeatureCategories(
        resolved.org.personId,
        resolved.org.organizationId,
        resolved.org.organizationType,
      );
      // Checked BEFORE listFeatureToggles() is ever called — same
      // "the new section must not partially render before that check runs"
      // requirement Phase 1's Flow 1 named for the category picker. A
      // forbidden category read is folded into `togglesResult` (below,
      // outside the try) rather than returning JSX from inside try/catch —
      // constructing JSX inside try/catch means a throw from the JSX
      // itself would be mis-attributed to `FeaturesLoadError` by the catch
      // block (lint: react-hooks/error-boundaries, caught in Phase 5 QA).
      if (categoriesResult.kind === "forbidden") {
        togglesResult = { kind: "forbidden" };
      } else {
        categories = categoriesResult.categories;
        togglesResult = await listFeatureToggles(
          resolved.org.personId,
          resolved.org.organizationId,
        );
      }
    } else {
      togglesResult = await listFeatureToggles(
        resolved.org.personId,
        resolved.org.organizationId,
      );
    }
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

      {categories && <FeatureCategoriesList slug={slug} categories={categories} />}

      <FeaturesList slug={slug} toggles={togglesResult.toggles} />
    </section>
  );
}
