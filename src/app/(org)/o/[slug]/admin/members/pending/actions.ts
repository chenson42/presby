"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { approveRollAction, denyRollAction } from "@/lib/roll";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/members/pending`. Same plumbing shape
 * as `admin/roles/actions.ts`. Neither action calls `recordAudit()` —
 * `approveRollAction()`/`denyRollAction()` already do, from inside
 * `src/lib/roll.ts` itself (the same stated divergence as `admin/features/
 * actions.ts` — see the work-log's Phase 4 "Divergences" section 1).
 */

async function resolveActingIdentity(slug: string): Promise<
  | { ok: true; userId: string; personId: string; organizationId: string }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  return {
    ok: true,
    userId: session.user.id,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
  };
}

function describeDecisionError(
  kind: "forbidden" | "not_found" | "already_decided",
): string {
  switch (kind) {
    case "forbidden":
      return "You don't have permission to approve or deny roll actions here.";
    case "not_found":
      return "That roll action no longer exists.";
    case "already_decided":
      return "Someone already decided this one. Refresh to see the current status.";
  }
}

export async function approveRollActionAction(
  slug: string,
  input: { rollActionId: string; minuteReference?: string },
): Promise<ActionResult> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await approveRollAction(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input.rollActionId,
    { minuteReference: input.minuteReference },
  );

  if (result.kind !== "ok") {
    return { ok: false, error: describeDecisionError(result.kind) };
  }

  revalidatePath(`/o/${slug}/admin/members/pending`);
  revalidatePath(`/o/${slug}/admin/members`);
  revalidatePath(`/o/${slug}/directory`);

  return { ok: true };
}

export async function denyRollActionAction(
  slug: string,
  input: { rollActionId: string; reason: string },
): Promise<ActionResult> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await denyRollAction(
    identity.personId,
    identity.organizationId,
    input.rollActionId,
    { reason: input.reason },
  );

  if (result.kind !== "ok") {
    return { ok: false, error: describeDecisionError(result.kind) };
  }

  revalidatePath(`/o/${slug}/admin/members/pending`);

  return { ok: true };
}
