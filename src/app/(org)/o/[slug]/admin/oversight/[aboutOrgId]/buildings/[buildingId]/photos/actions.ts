"use server";

import { finishPhoto, resolveOversightActor } from "@/lib/oversight/action-gate";
import type { PhotoActionResult } from "@/lib/oversight/contract";
import { PHOTO_REFUSAL } from "@/lib/oversight/copy";
import { addPhoto, removePhoto, setPhotoCaption, setPhotoCover } from "@/lib/oversight/photo-store";
import { parseCaption, type CaptionValues } from "@/lib/oversight/validate";
import { UPLOAD_MAX_BYTES } from "@/lib/storage/image/limits";

/**
 * The building photo actions (docs/work-log/2026-11-17-congregation-profile-inc2.md,
 * B5; the parent Phase 3 "API Contract" and Copy C14; DECISION-346). Every one:
 * authenticate (Node-side second-factor recheck) -> resolve the organization from
 * the slug -> UUID check on every id -> (the caption's pure parse; the upload's
 * size gate) -> `photo-store.ts`, which checks `congregation_oversight.manage`,
 * the toggle, the congregation, the building and the photo again inside its own
 * transaction and writes the audit row in that same transaction. THIS FILE HOLDS
 * NO `db.*` CALL, so `check:audit` has nothing to check here; `audit-coverage.test.ts`
 * and `photo-store.db.test.ts` stand in for the tripwire. `organizationId` is
 * never a parameter.
 *
 * The upload takes a `FormData` with one `photo` field (the island downscales to
 * at most 900 KB first; the server is the authority and refuses over 1,000,000
 * bytes, under the framework's 1 MiB Server Action body limit). Its refusal
 * order, end to end: signed in and second factor, organization, ids, the file
 * handle's size (a property of the `File`, read before the bytes are), then in the
 * store the key, the toggle, the type, the building and the cap, all before any
 * decode.
 */

export async function addBuildingPhotoAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
  formData: FormData,
): Promise<PhotoActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId });
  if (!gate.ok) return gate.result;

  // The size is a property of the File handle: refuse an oversized or empty upload before reading it.
  const file = formData.get("photo");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: PHOTO_REFUSAL.empty, kind: "empty" };
  if (file.size > UPLOAD_MAX_BYTES) return { ok: false, error: PHOTO_REFUSAL.too_large, kind: "too_large" };

  return finishPhoto(
    gate.identity,
    aboutOrgId,
    buildingId,
    await addPhoto(gate.identity.ctx, aboutOrgId, buildingId, Buffer.from(await file.arrayBuffer())),
  );
}

export async function setPhotoCaptionAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
  photoId: string,
  values: CaptionValues,
): Promise<PhotoActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId, photoId });
  if (!gate.ok) return gate.result;
  const parsed = parseCaption(values);
  if (!parsed.ok) return { ok: false, error: parsed.message, field: parsed.field, kind: "invalid" };
  return finishPhoto(
    gate.identity,
    aboutOrgId,
    buildingId,
    await setPhotoCaption(gate.identity.ctx, aboutOrgId, buildingId, photoId, parsed.value.caption),
  );
}

export async function setPhotoCoverAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
  photoId: string,
): Promise<PhotoActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId, photoId });
  if (!gate.ok) return gate.result;
  return finishPhoto(
    gate.identity,
    aboutOrgId,
    buildingId,
    await setPhotoCover(gate.identity.ctx, aboutOrgId, buildingId, photoId),
  );
}

export async function removePhotoAction(
  slug: string,
  aboutOrgId: string,
  buildingId: string,
  photoId: string,
): Promise<PhotoActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, buildingId, photoId });
  if (!gate.ok) return gate.result;
  return finishPhoto(
    gate.identity,
    aboutOrgId,
    buildingId,
    await removePhoto(gate.identity.ctx, aboutOrgId, buildingId, photoId),
  );
}
