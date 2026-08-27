"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { updatePerson, type UpdatePersonInput } from "@/lib/people";
import {
  recordRollAction,
  type RecordRollActionInput,
} from "@/lib/roll";
import type { ActionResult } from "@/types/actions";

/**
 * Server Action for `/o/<slug>/admin/members/[id]/edit`. Same plumbing shape
 * as `admin/members/new/actions.ts`: `auth()` not `cachedAuth()`,
 * `organizationId` never trusted from the client, `resolveOrgContext()`
 * re-run inside the action body — the permission check itself lives in
 * `updatePerson()`, not duplicated here.
 */
export async function updatePersonAction(
  slug: string,
  input: UpdatePersonInput,
): Promise<ActionResult<{ personId: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await updatePerson(
    resolved.org.personId,
    resolved.org.organizationId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to edit members here.",
      };
    case "not_found":
      return {
        ok: false,
        error: "That person could not be found.",
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
  revalidatePath(`/o/${slug}/directory/${input.personId}`);

  return { ok: true, data: { personId: input.personId } };
}

/**
 * Server Action for `RecordRollActionForm` — same plumbing shape as
 * `updatePersonAction` above and as `admin/members/new/actions.ts`'s
 * `createPersonAction`: `auth()`, `resolveOrgContext()` re-run inside the
 * action body, the permission check itself lives in `recordRollAction()`,
 * not duplicated here. Revalidates the members list AND the pending
 * worklist — the new `pending` row must show up there immediately.
 */
export async function recordRollActionAction(
  slug: string,
  input: RecordRollActionInput,
): Promise<ActionResult<{ rollActionId: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await recordRollAction(
    resolved.org.personId,
    resolved.org.organizationId,
    session.user.id,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to record roll actions here.",
      };
    case "not_found":
      return {
        ok: false,
        error: "That person could not be found.",
      };
    case "invalid_kind":
      return {
        ok: false,
        error: "That roll action isn't available from this screen.",
      };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/members`);
  revalidatePath(`/o/${slug}/admin/members/pending`);

  return { ok: true, data: { rollActionId: result.rollActionId } };
}
