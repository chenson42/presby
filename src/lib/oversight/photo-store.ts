import "server-only";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { OrgAccessError, withOrgContext, type OrgTx } from "@/lib/authz";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import { OVERSIGHT_GUARD_CODES, oversightBuildingPhotos, oversightBuildings } from "@/lib/db/domain/oversight";
import { pgErrorField } from "@/lib/db/errors";
import { isFlagEnabled } from "@/lib/flags";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { resolveMemberCongregation } from "@/lib/presbytery";
import { OVERSIGHT_FLAG } from "@/lib/presbytery-reports/contract";
import { getBlobStore } from "@/lib/storage/blob-store";
import { preflightPhoto, processPhoto } from "@/lib/storage/image/photo";
import {
  LIMITS,
  OVERSIGHT_MANAGE_KEY,
  type OversightCtx,
  type PhotoOutcome,
  type PhotoRefusal,
  type PhotoWritten,
} from "./contract";

/**
 * THE ONLY WRITER of `oversight_building_photos` in `src/`, and the only
 * `getBlobStore().store(` caller in the module (both calls pass the literal
 * `audience: "private"`; `boundaries.test.ts` and `audience-callsites.test.ts`
 * fail on anything else). docs/work-log/2026-11-17-congregation-profile.md,
 * Phase 3 "API Contract" and T10; DECISION-344, 346.
 *
 * THE UPLOAD'S REFUSAL ORDER is the security property, cheapest and least
 * informative first, and EVERYTHING before step 6 runs before a single pixel is
 * decoded (nobody spends `sharp`'s CPU without the key):
 *
 *   1. `congregation_oversight.manage`, by `presby_has_permission`   -> forbidden
 *   2. the global `org_portal.oversight` toggle                      -> not_found
 *   3. the bytes' own size, magic number and APNG marker (the
 *      pipeline's `preflightPhoto`, no decode)             -> empty, too_large,
 *                                                  unsupported_type, animated
 *   4. the congregation is a member of THIS presbytery, and the
 *      building is a live building of it                            -> not_found
 *   5. fewer than ten live photos                                    -> cap_reached
 *   6. the pipeline decodes, strips and re-encodes (outside any transaction)
 *   7. two private blobs, each its own transaction (`store()` owns it)
 *   8. the write: one transaction that repeats 1 to 5, with the building row
 *      locked `for update` BEFORE the cap is recounted, so two simultaneous
 *      uploads cannot both pass the cap. A byte-identical picture already live
 *      in this building is `duplicate`.
 *
 * Nothing in the client is trusted: the organization and the acting person come
 * from `resolveOrgContext()` in the action, never from the request, and every id
 * is resolved under (presbytery, congregation) or it is `not_found`.
 *
 * ACCEPTED RESIDUALS (DECISION-346). If step 8 fails after step 7, the two blobs
 * stay unreferenced and unservable (there is no `blob_assets` delete, and no
 * public door serves a `private` row); `bytea` grows by about 4 MB per building
 * at the cap; removing a photo hides it, the file stays.
 *
 * EVERY WRITE audits with `insertAuditRow(tx, ...)` in its own transaction, so a
 * failed audit insert undoes the change; never `recordAudit()`. Metadata is ids
 * and booleans only: never a caption, a filename, a hash, a dimension or bytes.
 * Nothing here deletes a row: removal is the `removed_at`/`removed_by` pair (the
 * database revoked DELETE and guards it, 0089).
 */

/** Thrown inside a transaction to roll it back with a typed refusal. */
class Refuse extends Error {
  constructor(readonly reason: PhotoRefusal) {
    super(reason);
    this.name = "Refuse";
  }
}

const GUARD_CODES: Record<string, PhotoRefusal> = {
  [OVERSIGHT_GUARD_CODES.buildingRemoved]: "building_removed",
  [OVERSIGHT_GUARD_CODES.removalFinal]: "already_removed",
};

const DUPLICATE_IMAGE = "oversight_building_photos_live_image_idx";

/** Maps whatever a transaction threw to the one answer the caller gets. */
function refusalFor(err: unknown): PhotoRefusal {
  if (err instanceof Refuse) return err.reason;
  if (err instanceof OrgAccessError) return "forbidden";
  const code = pgErrorField(err, "code");
  const constraint = pgErrorField(err, "constraint");
  if (code === "23505" && constraint === DUPLICATE_IMAGE) return "duplicate";
  if (code === "23514" && constraint && constraint in GUARD_CODES) return GUARD_CODES[constraint]!;
  // A fixed line: the SQLSTATE and nothing else. No message, no id, no content.
  console.error(`[oversight] photo save failed (sqlstate ${code ?? "none"})`);
  return "save_failed";
}

async function attempt<T>(fn: () => Promise<T>): Promise<PhotoOutcome<T>> {
  try {
    return { kind: "ok", data: await fn() };
  } catch (err) {
    return { kind: "refused", reason: refusalFor(err) };
  }
}

function inTransaction<T>(ctx: OversightCtx, fn: (tx: OrgTx) => Promise<T>): Promise<PhotoOutcome<T>> {
  return attempt(() => withOrgContext(ctx.personId, ctx.organizationId, fn));
}

type PhotoAuditAction =
  | typeof AUDIT_ACTIONS.OVERSIGHT_PHOTO_ADDED
  | typeof AUDIT_ACTIONS.OVERSIGHT_PHOTO_REMOVED
  | typeof AUDIT_ACTIONS.OVERSIGHT_PHOTO_COVER_SET
  | typeof AUDIT_ACTIONS.OVERSIGHT_PHOTO_CAPTION_SET;

/** The one audit write: in the mutation's own transaction (a failure here undoes the change). */
async function audit(
  tx: OrgTx,
  ctx: OversightCtx,
  action: PhotoAuditAction,
  photoId: string,
  aboutOrgId: string,
  metadata: Record<string, string | boolean | null>,
): Promise<void> {
  await insertAuditRow(tx, {
    action,
    actor: ctx.actor,
    resourceType: "oversight_photo",
    resourceId: photoId,
    metadata: { organizationId: ctx.organizationId, aboutOrgId, ...metadata },
  });
}

/** Step 1 of the order: the manage key, live (RLS is tenancy, not authorization). */
async function requireKey(tx: OrgTx, ctx: OversightCtx): Promise<void> {
  const [held] = await holdsPermissions(tx, ctx, [OVERSIGHT_MANAGE_KEY]);
  if (!held) throw new Refuse("forbidden");
}

/** The congregation half of step 4: it is a member of THIS presbytery. */
async function requireCongregation(tx: OrgTx, ctx: OversightCtx, aboutOrgId: string): Promise<void> {
  if (!(await resolveMemberCongregation(tx, ctx.organizationId, aboutOrgId))) throw new Refuse("not_found");
}

/** The key, then the congregation: the first steps of every write that is not an upload. */
async function gate(tx: OrgTx, ctx: OversightCtx, aboutOrgId: string): Promise<void> {
  await requireKey(tx, ctx);
  await requireCongregation(tx, ctx, aboutOrgId);
}

const liveBuilding = (ctx: OversightCtx, aboutOrgId: string, buildingId: string) =>
  and(
    eq(oversightBuildings.id, buildingId),
    eq(oversightBuildings.organizationId, ctx.organizationId),
    eq(oversightBuildings.aboutOrgId, aboutOrgId),
    isNull(oversightBuildings.removedAt),
  );

/** The building row of this congregation, live, or `not_found`. `lock` takes the row lock the cap and the cover rely on. */
async function building(tx: OrgTx, ctx: OversightCtx, aboutOrgId: string, buildingId: string, lock: boolean): Promise<void> {
  const query = tx.select({ id: oversightBuildings.id }).from(oversightBuildings).where(liveBuilding(ctx, aboutOrgId, buildingId));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new Refuse("not_found");
}

const inBuilding = (ctx: OversightCtx, aboutOrgId: string, buildingId: string) =>
  and(
    eq(oversightBuildingPhotos.organizationId, ctx.organizationId),
    eq(oversightBuildingPhotos.aboutOrgId, aboutOrgId),
    eq(oversightBuildingPhotos.buildingId, buildingId),
  );

async function liveCount(tx: OrgTx, ctx: OversightCtx, aboutOrgId: string, buildingId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(oversightBuildingPhotos)
    .where(and(inBuilding(ctx, aboutOrgId, buildingId), isNull(oversightBuildingPhotos.removedAt)));
  return Number(row?.n ?? 0);
}

/** The photo, locked, in this building: live (returned), removed (`already_removed`), or absent (`not_found`). */
async function lockPhoto(tx: OrgTx, ctx: OversightCtx, aboutOrgId: string, buildingId: string, photoId: string) {
  const [row] = await tx
    .select({
      id: oversightBuildingPhotos.id,
      caption: oversightBuildingPhotos.caption,
      isCover: oversightBuildingPhotos.isCover,
      removedAt: oversightBuildingPhotos.removedAt,
    })
    .from(oversightBuildingPhotos)
    .where(and(inBuilding(ctx, aboutOrgId, buildingId), eq(oversightBuildingPhotos.id, photoId)))
    .for("update");
  if (!row) throw new Refuse("not_found");
  if (row.removedAt !== null) throw new Refuse("already_removed");
  return row;
}

/**
 * `store()` de-duplicates by content hash with check-then-insert, so two
 * simultaneous stores of the same bytes can both miss the check and one insert
 * loses to the unique index (23505). The second attempt finds the row the winner
 * wrote and returns its key. Once only: anything that fails twice is a real fault.
 */
async function retryOnDedupRace<T>(attemptStore: () => Promise<T>): Promise<T> {
  try {
    return await attemptStore();
  } catch (err) {
    if (pgErrorField(err, "code") !== "23505") throw err;
    return attemptStore();
  }
}

const nowStamp = () => sql`now()`;

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

/**
 * Steps 1 to 5 of the upload order, in one transaction and with no decode. Shared
 * by the pre-check and the final write; the final write passes `lock` so the cap
 * is recounted under the building's row lock.
 */
async function checkUpload(tx: OrgTx, ctx: OversightCtx, aboutOrgId: string, buildingId: string, file: Buffer, lock: boolean): Promise<void> {
  await requireKey(tx, ctx); // 1
  if (!(await isFlagEnabled(OVERSIGHT_FLAG))) throw new Refuse("not_found"); // 2
  const pre = preflightPhoto(file); // 3
  if (pre.kind === "refused") throw new Refuse(pre.reason);
  await requireCongregation(tx, ctx, aboutOrgId); // 4
  await building(tx, ctx, aboutOrgId, buildingId, lock);
  if ((await liveCount(tx, ctx, aboutOrgId, buildingId)) >= LIMITS.photoCap) throw new Refuse("cap_reached"); // 5
}

/**
 * Adds a photo to a live building. The first photo (or any photo while no live
 * photo carries the cover mark) becomes the cover. Returns the new photo's id
 * and whether it took the cover.
 */
export async function addPhoto(
  ctx: OversightCtx,
  aboutOrgId: string,
  buildingId: string,
  file: Buffer,
): Promise<PhotoOutcome<PhotoWritten & { cover: boolean }>> {
  // Steps 1 to 5, before any decode.
  const first = await inTransaction(ctx, (tx) => checkUpload(tx, ctx, aboutOrgId, buildingId, file, false));
  if (first.kind === "refused") return first;

  // 6. Decode, strip, re-encode. Outside any transaction. Buildings crop from the centre.
  const processed = await processPhoto(file, { thumbnail: "centre" });
  if (processed.kind === "refused") return { kind: "refused", reason: processed.reason };

  // 7. Two private blobs, each its own transaction (store() owns it, DECISION-030).
  let imageKey: string;
  let thumbKey: string;
  try {
    const image = await retryOnDedupRace(() =>
      getBlobStore().store({
        organizationId: ctx.organizationId,
        bytes: processed.master,
        contentType: processed.masterContentType,
        audience: "private",
      }),
    );
    const thumb = await retryOnDedupRace(() =>
      getBlobStore().store({
        organizationId: ctx.organizationId,
        bytes: processed.thumb,
        contentType: processed.thumbContentType,
        audience: "private",
      }),
    );
    imageKey = image.key;
    thumbKey = thumb.key;
  } catch (err) {
    return { kind: "refused", reason: refusalFor(err) };
  }

  // 8. The write, under the building's row lock, repeating every check.
  return inTransaction(ctx, async (tx) => {
    await checkUpload(tx, ctx, aboutOrgId, buildingId, file, true);

    const [same] = await tx
      .select({ id: oversightBuildingPhotos.id })
      .from(oversightBuildingPhotos)
      .where(
        and(
          inBuilding(ctx, aboutOrgId, buildingId),
          eq(oversightBuildingPhotos.imageAssetKey, imageKey),
          isNull(oversightBuildingPhotos.removedAt),
        ),
      )
      .limit(1);
    if (same) throw new Refuse("duplicate");

    // The mark is the building's FIRST photo's: a new photo takes it only when no live photo exists
    // (counted here, inside the locked transaction). If the marked cover was removed, the oldest
    // remaining photo shows as the cover (`pickCover`, derived on read), and a later upload must
    // not take the mark and silently become the cover.
    const [anyLive] = await tx
      .select({ id: oversightBuildingPhotos.id })
      .from(oversightBuildingPhotos)
      .where(and(inBuilding(ctx, aboutOrgId, buildingId), isNull(oversightBuildingPhotos.removedAt)))
      .limit(1);
    const cover = anyLive === undefined;

    // `created_at` is stamped by the guard trigger; never passed (0089).
    const [row] = await tx
      .insert(oversightBuildingPhotos)
      .values({
        organizationId: ctx.organizationId,
        aboutOrgId,
        buildingId,
        imageAssetKey: imageKey,
        thumbAssetKey: thumbKey,
        width: processed.width,
        height: processed.height,
        isCover: cover,
        createdBy: ctx.actor.userId,
      })
      .returning({ id: oversightBuildingPhotos.id });
    if (!row) throw new Error("oversight_building_photos insert returned no row");

    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_PHOTO_ADDED, row.id, aboutOrgId, { buildingId, photoId: row.id, cover });
    return { id: row.id, cover };
  });
}

// ---------------------------------------------------------------------------
// Caption, cover, remove
// ---------------------------------------------------------------------------

/**
 * Sets or clears a live photo's caption (`caption` is already cleaned by
 * `parseCaption`; null clears it). The same caption writes and audits nothing.
 */
export function setPhotoCaption(
  ctx: OversightCtx,
  aboutOrgId: string,
  buildingId: string,
  photoId: string,
  caption: string | null,
): Promise<PhotoOutcome<PhotoWritten>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, aboutOrgId);
    await building(tx, ctx, aboutOrgId, buildingId, true);
    const stored = await lockPhoto(tx, ctx, aboutOrgId, buildingId, photoId);
    if (stored.caption === caption) return { id: stored.id, unchanged: true as const };

    await tx
      .update(oversightBuildingPhotos)
      .set({ caption })
      .where(and(eq(oversightBuildingPhotos.id, stored.id), isNull(oversightBuildingPhotos.removedAt)));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_PHOTO_CAPTION_SET, stored.id, aboutOrgId, { buildingId, photoId: stored.id });
    return { id: stored.id };
  });
}

/**
 * Makes a live photo the cover: clears the mark on the current cover first (the
 * partial unique index allows one), then sets it. Already the marked cover
 * writes and audits nothing. A building with no marked cover shows its oldest
 * photo as the cover (`pickCover`); marking one writes the mark.
 */
export function setPhotoCover(
  ctx: OversightCtx,
  aboutOrgId: string,
  buildingId: string,
  photoId: string,
): Promise<PhotoOutcome<PhotoWritten>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, aboutOrgId);
    // The building row first, so a cover change, an upload and a removal serialize.
    await building(tx, ctx, aboutOrgId, buildingId, true);
    const stored = await lockPhoto(tx, ctx, aboutOrgId, buildingId, photoId);
    if (stored.isCover) return { id: stored.id, unchanged: true as const };

    const [previous] = await tx
      .select({ id: oversightBuildingPhotos.id })
      .from(oversightBuildingPhotos)
      .where(and(inBuilding(ctx, aboutOrgId, buildingId), isNull(oversightBuildingPhotos.removedAt), eq(oversightBuildingPhotos.isCover, true)))
      .orderBy(asc(oversightBuildingPhotos.createdAt), asc(oversightBuildingPhotos.id))
      .limit(1)
      .for("update");
    if (previous) {
      await tx.update(oversightBuildingPhotos).set({ isCover: false }).where(eq(oversightBuildingPhotos.id, previous.id));
    }
    await tx.update(oversightBuildingPhotos).set({ isCover: true }).where(eq(oversightBuildingPhotos.id, stored.id));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_PHOTO_COVER_SET, stored.id, aboutOrgId, {
      buildingId,
      photoId: stored.id,
      previousCoverPhotoId: previous?.id ?? null,
    });
    return { id: stored.id };
  });
}

/**
 * Removes a photo from view: one UPDATE sets the removal pair and clears the
 * cover mark. The picture file stays in storage (DECISION-346); nothing is deleted.
 */
export function removePhoto(
  ctx: OversightCtx,
  aboutOrgId: string,
  buildingId: string,
  photoId: string,
): Promise<PhotoOutcome<PhotoWritten>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, aboutOrgId);
    await building(tx, ctx, aboutOrgId, buildingId, true);
    const stored = await lockPhoto(tx, ctx, aboutOrgId, buildingId, photoId);
    await tx
      .update(oversightBuildingPhotos)
      .set({ removedAt: nowStamp(), removedBy: ctx.actor.userId, isCover: false })
      .where(and(eq(oversightBuildingPhotos.id, stored.id), isNull(oversightBuildingPhotos.removedAt)));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_PHOTO_REMOVED, stored.id, aboutOrgId, { buildingId, photoId: stored.id });
    return { id: stored.id };
  });
}
