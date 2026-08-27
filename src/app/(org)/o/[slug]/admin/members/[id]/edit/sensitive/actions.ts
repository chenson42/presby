"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  addPersonNote,
  setPersonDemographics,
  setPersonMedical,
  setPersonDisabilities,
  sensitiveInfoFieldLabel,
  type AddPersonNoteInput,
  type SetPersonDemographicsInput,
  type SetPersonMedicalInput,
  type SetPersonDisabilitiesInput,
} from "@/lib/person-sensitive";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/members/[id]/edit/sensitive`. Same
 * plumbing shape as `edit/actions.ts`: `auth()` not `cachedAuth()`,
 * `organizationId`/`personId` (the ACTOR's) never trusted from the client,
 * `resolveOrgContext()` re-run inside every action body — the permission
 * check itself lives in `src/lib/person-sensitive.ts`, not duplicated here.
 */

function forbiddenResult(): { ok: false; error: string } {
  return {
    ok: false,
    error: "You don't have permission to do that here.",
  };
}

function invalidInputResult(field: string): { ok: false; error: string } {
  return {
    ok: false,
    error: `${sensitiveInfoFieldLabel(field)} is too long. Please shorten it and try again.`,
  };
}

export async function addPersonNoteAction(
  slug: string,
  personId: string,
  input: AddPersonNoteInput,
): Promise<ActionResult<{ noteId: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await addPersonNote(
    resolved.org.personId,
    resolved.org.organizationId,
    session.user.id,
    personId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return forbiddenResult();
    case "not_found":
      return { ok: false, error: "That person could not be found." };
    case "invalid_input":
      return invalidInputResult(result.field);
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/members/${personId}/edit/sensitive`);
  return { ok: true, data: { noteId: result.noteId } };
}

export async function setPersonDemographicsAction(
  slug: string,
  personId: string,
  input: SetPersonDemographicsInput,
): Promise<ActionResult<{ personId: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await setPersonDemographics(
    resolved.org.personId,
    resolved.org.organizationId,
    personId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return forbiddenResult();
    case "not_found":
      return { ok: false, error: "That person could not be found." };
    case "invalid_input":
      return invalidInputResult(result.field);
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/members/${personId}/edit/sensitive`);
  return { ok: true, data: { personId } };
}

export async function setPersonMedicalAction(
  slug: string,
  personId: string,
  input: SetPersonMedicalInput,
): Promise<ActionResult<{ personId: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await setPersonMedical(
    resolved.org.personId,
    resolved.org.organizationId,
    personId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return forbiddenResult();
    case "not_found":
      return { ok: false, error: "That person could not be found." };
    case "invalid_input":
      return invalidInputResult(result.field);
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/members/${personId}/edit/sensitive`);
  return { ok: true, data: { personId } };
}

export async function setPersonDisabilitiesAction(
  slug: string,
  personId: string,
  input: SetPersonDisabilitiesInput,
): Promise<ActionResult<{ personId: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await setPersonDisabilities(
    resolved.org.personId,
    resolved.org.organizationId,
    personId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return forbiddenResult();
    case "not_found":
      return { ok: false, error: "That person could not be found." };
    case "tracking_disabled":
      return {
        ok: false,
        error: "Per-person disability tracking isn't turned on for this organization.",
      };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/members/${personId}/edit/sensitive`);
  return { ok: true, data: { personId } };
}
