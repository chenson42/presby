"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { toggleOrgFeature, ORG_FEATURE_CATALOG } from "@/lib/org-features";
import { toggleOrgFeatureCategory } from "@/lib/org-feature-categories";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { ActionResult } from "@/types/actions";

/**
 * Server Action for `/o/<slug>/admin/features`. Same plumbing shape as
 * `admin/roles/actions.ts` — `auth()` not `cachedAuth()` (see that file's
 * header for why), `organizationId` never trusted from the client,
 * `resolveOrgContext()` re-run inside the action body.
 *
 * DOES NOT CALL `recordAudit()` — `toggleOrgFeature()` already does, from
 * inside `src/lib/org-features.ts` itself (a stated divergence from the
 * `role-grants.ts`/`admin/roles/actions.ts` split, made by the prior Phase 4
 * server-logic pass — see the work-log's "Divergences" section 1). Calling
 * it again here would double-write the audit trail.
 */
export async function toggleFeatureAction(
  slug: string,
  input: { key: string; enabled: boolean },
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await toggleOrgFeature(
    resolved.org.personId,
    resolved.org.organizationId,
    session.user.id,
    input.key,
    input.enabled,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage features here.",
      };
    case "invalid_key":
      return { ok: false, error: "That feature doesn't exist." };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/features`);

  return { ok: true };
}

/**
 * Server Action for the new category-picker section. Same plumbing shape as
 * `toggleFeatureAction` above — `auth()`, `resolveOrgContext()` re-run,
 * `organizationId` never trusted from the client.
 *
 * DOES CALL `recordAudit()` HERE, unlike `toggleFeatureAction` above — the
 * opposite split from its sibling, and deliberately so (DECISION-130):
 * `toggleOrgFeatureCategory()` (`src/lib/org-feature-categories.ts`) has no
 * import of `ORG_FEATURE_CATALOG` (that would create a real import cycle —
 * see that module's own header), so it cannot itself enumerate which
 * `feature_key`s a category mutation affects. This action can import both
 * modules with no cycle, so it computes `affectedFeatureKeys` and calls
 * `recordAudit()` after the write commits (`result.kind === "ok"`), never
 * for a write that was rejected or rolled back.
 */
export async function toggleFeatureCategoryAction(
  slug: string,
  input: { category: string; enabled: boolean },
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await toggleOrgFeatureCategory(
    resolved.org.personId,
    resolved.org.organizationId,
    session.user.id,
    input.category,
    input.enabled,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage features here.",
      };
    case "invalid_category":
      return { ok: false, error: "That category doesn't exist." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ORG_FEATURE_CATEGORY_TOGGLED,
    resourceType: "organization_feature_category",
    resourceId: input.category,
    metadata: {
      organizationId: resolved.org.organizationId,
      category: input.category,
      enabled: input.enabled,
      affectedFeatureKeys: ORG_FEATURE_CATALOG.filter(
        (entry) => entry.category === input.category,
      ).map((entry) => entry.key),
    },
  });

  revalidatePath(`/o/${slug}/admin/features`);

  return { ok: true };
}
