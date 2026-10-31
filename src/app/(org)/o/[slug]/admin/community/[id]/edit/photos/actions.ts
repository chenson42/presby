"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { REFUSAL_COPY, REFUSALS_NAMING_PERSON, REUSED_COPY, refusalMessage } from "@/lib/person-photos/copy";
import { UPLOAD_MAX_BYTES } from "@/lib/person-photos/limits";
import { addPhoto, designatePhoto, removePhoto, undesignatePhoto, type PhotoCtx } from "@/lib/person-photos/store";
import type { PhotoRefusal, Purpose, Refused } from "@/lib/person-photos/types";
import { parseBlobKey } from "@/lib/storage/blob-key";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/community/[id]/edit/photos`
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 "API Contract").
 *
 * Same plumbing as `edit/guardians/actions.ts`: `auth()` (not `cachedAuth()`),
 * `resolveOrgContext()` re-run in EVERY body, and the acting person, the user
 * and the organization taken from the session and that resolution, never from
 * the request. THIS FILE HOLDS NO `db.*` CALL (so `check:audit` has nothing to
 * check here, and a source scan pins that); every check that matters (the
 * toggle, `people.manage`, membership, adult, the cap, the lock) and every audit
 * row lives in `src/lib/person-photos/store.ts`, inside the mutation's own
 * transaction. The DB tests of that file stand in for the tripwire.
 *
 * Each action returns `{ ok: false, error }` with ONE fixed string from
 * `person-photos/copy.ts` per refusal kind (Copy C6), never raw error text.
 * Ids are UUID-validated before any SQL; `purpose` is validated against the
 * closed pair; `attested` must be the boolean `true` for the website. NO action
 * redirects: the client re-renders from the revalidated page.
 */

/** A malformed id is "not found": nothing about it reaches SQL. */
const BAD_ID: PhotoRefusal = "not_found";

function fail(reason: PhotoRefusal, first = ""): { ok: false; error: string } {
  return { ok: false, error: refusalMessage(reason, first) };
}

function fromRefusal(refused: Refused): { ok: false; error: string } {
  // The three strings that name the person need `first`; store.ts always sets it for them (it arises
  // after the membership is found). If it were ever missing, say the generic truth rather than a blank.
  if (REFUSALS_NAMING_PERSON.includes(refused.reason) && !refused.first) {
    return { ok: false, error: REFUSAL_COPY.save_failed("") };
  }
  return fail(refused.reason, refused.first ?? "");
}

type Resolved = { ok: true; ctx: PhotoCtx } | { ok: false; error: string };

async function resolveCtx(slug: string): Promise<Resolved> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: REUSED_COPY.signedOut };
  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") return { ok: false, error: REUSED_COPY.noOrgAccess };
  return {
    ok: true,
    ctx: {
      organizationId: resolved.org.organizationId,
      actorPersonId: resolved.org.personId,
      actor: { userId: session.user.id, email: session.user.email ?? null },
    },
  };
}

function revalidate(slug: string, personId: string): void {
  revalidatePath(`/o/${slug}/admin/community/${personId}/edit/photos`);
  revalidatePath(`/o/${slug}/admin/community/${personId}/edit`);
  revalidatePath(`/o/${slug}/directory`);
}

const isPurpose = (value: unknown): value is Purpose => value === "directory" || value === "website";

export async function addPersonPhotoAction(
  slug: string,
  personId: string,
  formData: FormData,
): Promise<ActionResult<{ photoId: string; usedForDirectory: boolean }>> {
  const resolved = await resolveCtx(slug);
  if (!resolved.ok) return resolved;
  if (parseBlobKey(personId) === null) return fail(BAD_ID);

  // The size is a property of the File handle: refuse an oversized or empty upload before reading it.
  const file = formData.get("photo");
  if (!(file instanceof Blob)) return fail("empty");
  if (file.size === 0) return fail("empty");
  if (file.size > UPLOAD_MAX_BYTES) return fail("too_large");

  const result = await addPhoto(resolved.ctx, personId, Buffer.from(await file.arrayBuffer()));
  if (result.kind === "refused") return fromRefusal(result);

  revalidate(slug, personId);
  return { ok: true, data: { photoId: result.photoId, usedForDirectory: result.usedForDirectory } };
}

export async function designatePersonPhotoAction(
  slug: string,
  personId: string,
  input: { photoId: string; purpose: "directory" | "website"; attested: boolean },
): Promise<ActionResult> {
  const resolved = await resolveCtx(slug);
  if (!resolved.ok) return resolved;
  if (parseBlobKey(personId) === null || parseBlobKey(String(input?.photoId)) === null) return fail(BAD_ID);
  if (!isPurpose(input.purpose)) return fail("save_failed");
  // The attestation is a boolean `true` for the website; anything else (a string, 1, undefined) is not consent.
  if (input.purpose === "website" && input.attested !== true) return fail("attestation_required");

  const result = await designatePhoto(resolved.ctx, personId, {
    photoId: input.photoId,
    purpose: input.purpose,
    attested: input.attested === true,
  });
  if (result.kind === "refused") return fromRefusal(result);

  revalidate(slug, personId);
  return { ok: true };
}

export async function undesignatePersonPhotoAction(
  slug: string,
  personId: string,
  purpose: "directory" | "website",
): Promise<ActionResult> {
  const resolved = await resolveCtx(slug);
  if (!resolved.ok) return resolved;
  if (parseBlobKey(personId) === null) return fail(BAD_ID);
  if (!isPurpose(purpose)) return fail("save_failed");

  const result = await undesignatePhoto(resolved.ctx, personId, purpose);
  if (result.kind === "refused") return fromRefusal(result);

  revalidate(slug, personId);
  return { ok: true };
}

export async function removePersonPhotoAction(slug: string, personId: string, photoId: string): Promise<ActionResult> {
  const resolved = await resolveCtx(slug);
  if (!resolved.ok) return resolved;
  if (parseBlobKey(personId) === null || parseBlobKey(String(photoId)) === null) return fail(BAD_ID);

  const result = await removePhoto(resolved.ctx, personId, photoId);
  if (result.kind === "refused") return fromRefusal(result);

  revalidate(slug, personId);
  return { ok: true };
}
