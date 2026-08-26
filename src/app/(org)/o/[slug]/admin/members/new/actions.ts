"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  createPerson,
  matchPerson,
  type CreatePersonInput,
  type MatchCandidate,
  type MatchPersonInput,
} from "@/lib/people";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/members/new` — the wizard's search step
 * and its single final submit. Same plumbing shape as `admin/roles/
 * actions.ts`: `auth()` not `cachedAuth()`, `organizationId` never trusted
 * from the client, `resolveOrgContext()` re-run inside every action body.
 *
 * NEITHER ACTION CALLS `recordAudit()` — `createPerson()` writes no audit
 * event by design (not in the `AUDIT_ACTIONS` catalog; only feature-toggle
 * and roll-approve/deny are audited, per Phase 2's ruling), and
 * `matchPerson()` is a read.
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

export async function matchPersonAction(
  slug: string,
  input: MatchPersonInput,
): Promise<ActionResult<{ candidates: MatchCandidate[] }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await matchPerson(identity.personId, identity.organizationId, input);

  if (result.kind === "forbidden") {
    return {
      ok: false,
      error: "You don't have permission to add members here.",
    };
  }

  return { ok: true, data: { candidates: result.candidates } };
}

export async function createPersonAction(
  slug: string,
  input: CreatePersonInput,
): Promise<ActionResult<{ personId: string; rollActionId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await createPerson(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to add members here.",
      };
    case "existing_member_elsewhere":
      return {
        ok: false,
        error:
          "That person already belongs to another organization. This step can't attach them here yet — contact support about a transfer.",
      };
    case "invalid_household":
      return {
        ok: false,
        error: "That household no longer exists. Choose another or create a new one.",
      };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/members`);
  revalidatePath(`/o/${slug}/admin/members/pending`);

  return {
    ok: true,
    data: { personId: result.personId, rollActionId: result.rollActionId },
  };
}
