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
 *
 * `rollAction.kind === "none"` REJECTED HERE, AT RUNTIME (docs/work-log/
 * 2026-08-27-staff-and-personnel.md, DECISION-128/129 follow-on). `people.ts`
 * widened `CreatePersonInput.rollAction` to a third arm for staff hiring's
 * inline person-create, and this action still accepts a plain
 * `CreatePersonInput` from client input — a Server Action's parameter types
 * are not a runtime boundary (an arbitrary caller who knows this action's id
 * can post any JSON shape regardless of what `member-wizard-schema.ts`'s zod
 * schema allows client-side). The member wizard's whole contract is "every
 * new member gets a real roll action" — silently letting a `"none"` payload
 * through here would let anyone reachable at this action skip that
 * requirement entirely, since `createPerson()` itself now only requires
 * `people.manage` (not `roll.propose`) for that kind. Checked and rejected
 * BEFORE calling `createPerson()`, not left to fall through as a type error.
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

  // See this file's header comment — a client-supplied "none" must never
  // reach createPerson() from THIS action.
  if (input.rollAction.kind === "none") {
    return {
      ok: false,
      error: "A roll action is required to add a new member.",
    };
  }

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

  // `result.rollActionId` is `string | null` on `createPerson()`'s own
  // signature (it now also serves the `rollAction.kind === "none"` staff
  // caller), but THIS action already rejected that kind above — a `null`
  // here would mean createPerson() and this guard disagree about which kind
  // was passed, a genuine invariant break, not an expected-and-handled case.
  if (result.rollActionId === null) {
    throw new Error(
      "createPersonAction: createPerson() returned a null rollActionId for a roll-action-bearing call",
    );
  }

  revalidatePath(`/o/${slug}/admin/members`);
  revalidatePath(`/o/${slug}/admin/members/pending`);

  return {
    ok: true,
    data: { personId: result.personId, rollActionId: result.rollActionId },
  };
}
