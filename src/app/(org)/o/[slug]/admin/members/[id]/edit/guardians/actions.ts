"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  addGuardianLink,
  removeGuardianLink,
  searchLinkablePeople,
  updateGuardianLink,
  type AddGuardianLinkInput,
  type LinkablePerson,
} from "@/lib/children";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/members/[id]/edit/guardians`. Same
 * plumbing shape as `edit/sensitive/actions.ts`: `auth()` not
 * `cachedAuth()`, `organizationId`/`personId` (the ACTOR's) never trusted
 * from the client, `resolveOrgContext()` re-run inside every action body —
 * the `children.roster` permission check itself lives in
 * `src/lib/children.ts`, not duplicated here.
 */

function forbiddenResult(): { ok: false; error: string } {
  return {
    ok: false,
    error: "You don't have permission to do that here.",
  };
}

const FIELD_LABELS: Record<string, string> = {
  relatedName: "Name",
  relatedPersonId: "Linked person",
  notes: "Notes",
  relationship: "Relationship",
};

function invalidInputResult(field: string): { ok: false; error: string } {
  const label = FIELD_LABELS[field] ?? field;
  if (field === "relatedPersonId") {
    return {
      ok: false,
      error:
        "Choose a person already in this organization, or use the name field instead.",
    };
  }
  return {
    ok: false,
    error: `${label} is too long or missing. Please check it and try again.`,
  };
}

export async function addGuardianLinkAction(
  slug: string,
  personId: string,
  input: AddGuardianLinkInput,
): Promise<ActionResult<{ linkId: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await addGuardianLink(
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

  revalidatePath(`/o/${slug}/admin/members/${personId}/edit/guardians`);
  return { ok: true, data: { linkId: result.linkId } };
}

export async function updateGuardianLinkAction(
  slug: string,
  personId: string,
  linkId: string,
  input: AddGuardianLinkInput,
): Promise<ActionResult<{ linkId: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await updateGuardianLink(
    resolved.org.personId,
    resolved.org.organizationId,
    personId,
    linkId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return forbiddenResult();
    case "not_found":
      return { ok: false, error: "That guardian link could not be found." };
    case "invalid_input":
      return invalidInputResult(result.field);
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/members/${personId}/edit/guardians`);
  return { ok: true, data: { linkId: result.linkId } };
}

/**
 * Backs the guardian-link form's "link an existing person" search box.
 * Returns an empty list (never `forbidden`-shaped from the client's view —
 * `ok: false` still reads as "no matches" in the UI) on any denial, since a
 * typeahead has no honest "you can't search" state distinct from "nothing
 * found" once the surrounding page has already gated on the same
 * permission.
 */
export async function searchLinkablePeopleAction(
  slug: string,
  query: string,
): Promise<ActionResult<{ people: LinkablePerson[] }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: true, data: { people: [] } };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: true, data: { people: [] } };
  }

  const result = await searchLinkablePeople(
    resolved.org.personId,
    resolved.org.organizationId,
    query,
  );

  if (result.kind === "forbidden") {
    return { ok: true, data: { people: [] } };
  }
  return { ok: true, data: { people: result.people } };
}

export async function removeGuardianLinkAction(
  slug: string,
  personId: string,
  linkId: string,
): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await removeGuardianLink(
    resolved.org.personId,
    resolved.org.organizationId,
    personId,
    linkId,
  );

  switch (result.kind) {
    case "forbidden":
      return forbiddenResult();
    case "not_found":
      return { ok: false, error: "That guardian link could not be found." };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/members/${personId}/edit/guardians`);
  return { ok: true };
}
