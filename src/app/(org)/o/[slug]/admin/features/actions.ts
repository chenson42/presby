"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { toggleOrgFeature } from "@/lib/org-features";
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
