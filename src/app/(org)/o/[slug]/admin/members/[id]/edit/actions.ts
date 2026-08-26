"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { updatePerson, type UpdatePersonInput } from "@/lib/people";
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
