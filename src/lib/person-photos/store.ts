import "server-only";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { OrgAccessError, withOrgContext, type OrgTx } from "@/lib/authz";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import { memberships, people } from "@/lib/db/domain/people";
import { personPhotoDesignations, personPhotos } from "@/lib/db/domain/person-photos";
import { pgErrorField } from "@/lib/db/errors";
import { getBlobStore } from "@/lib/storage/blob-store";
import { parseBlobKey } from "@/lib/storage/blob-key";
import { processPhoto } from "./image";
import { PHOTO_CAP_PER_PERSON } from "./limits";
import type { MutationResult, PhotoRefusal, Purpose, Refused } from "./types";

/**
 * THE ONLY WRITER of `person_photos` and `person_photo_designations` in `src/`,
 * and the only `getBlobStore().store(` caller in the feature (both calls pass
 * the literal `audience: "private"`; `scan.test.ts` and
 * `audience-callsites.test.ts` fail on anything else). DECISION-285/286/289;
 * docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 "API Contract".
 *
 * WHAT THIS DOES NOT DECIDE. Whether a photo SHOWS anywhere (the toggle, a
 * minor, a merge, `hide_photo`, attestation) is SQL (`presby_person_public_photo`
 * and its siblings, 0078 section 5). This module decides only whether a STAFF
 * MEMBER MAY CHANGE the set, and writes it.
 *
 * EVERY MUTATION is one `withOrgContext()` transaction (the actor must be an
 * active member of the organization), under the person's advisory lock, that
 * repeats the whole check in this order, cheapest and least informative first:
 *
 *   1. the per-organization toggle (`presby_person_photos_enabled`)  -> feature_off
 *   2. `people.manage`, by `presby_has_permission(actor, org, ...)`   -> forbidden
 *   3. the target is a membership of THIS organization               -> not_found
 *   3b. the photo is this person's, in this organization, and live   -> not_found / already_removed
 *       (designate and remove only)
 *   4. the target is an adult (add and designate only)               -> minor
 *   5. fewer than ten live photos (add only)                         -> cap_reached
 *
 * Nothing in the client is trusted: the organization and the acting person come
 * from `resolveOrgContext()` in the action, never the request. Removing and
 * un-designating are never refused for a minor (staff must be able to clear a
 * photo of someone who has since turned out to be under 18).
 *
 * `addPhoto` AUTHORIZES BEFORE IT DECODES (R7): the first transaction refuses an
 * unauthorized caller before `processPhoto()` is reached, so nobody spends
 * `sharp`'s CPU without `people.manage`. The final transaction repeats every
 * check, because permission and toggle can change in the seconds between.
 *
 * ACCEPTED RESIDUAL (R7). If the final transaction fails after the two blobs
 * were stored, they are left unreferenced and unservable (the public door serves
 * only a listed person's photo; nothing references them). As on the logo path
 * there is no `blob_assets` delete.
 *
 * AUDIT is written with `insertAuditRow(tx, ...)` in the mutation's own
 * transaction: a failed audit insert undoes the change. Metadata is ids,
 * booleans and purposes only (never bytes, a hash, a filename, dimensions or a
 * name).
 *
 * Nothing here deletes a row: removal and ending are `removed_at` / `ended_at`
 * (the database revoked DELETE and guards both tables, 0078).
 */

export interface PhotoCtx {
  organizationId: string;
  /** The acting person (`resolveOrgContext().org.personId`). */
  actorPersonId: string;
  /** The acting user, for `created_by` / `removed_by` / the audit row. */
  actor: { userId: string; email: string | null };
}

/** Thrown inside a transaction to roll it back with a typed refusal. */
class Refuse extends Error {
  constructor(
    readonly reason: PhotoRefusal,
    readonly first?: string,
  ) {
    super(reason);
    this.name = "Refuse";
  }
}

type Rows = Array<Record<string, unknown>>;
const rowsOf = (result: unknown): Rows =>
  Array.isArray(result) ? (result as Rows) : ((result as { rows?: Rows }).rows ?? []);

/** Maps whatever a transaction threw to the one answer the caller gets. */
function refusalFor(err: unknown): Refused {
  if (err instanceof Refuse) {
    return err.first === undefined
      ? { kind: "refused", reason: err.reason }
      : { kind: "refused", reason: err.reason, first: err.first };
  }
  if (err instanceof OrgAccessError) return { kind: "refused", reason: "forbidden" };
  // A fixed line: the SQLSTATE and nothing else. No message, no id, no content.
  console.error(`[person-photos] save failed (sqlstate ${pgErrorField(err, "code") ?? "none"})`);
  return { kind: "refused", reason: "save_failed" };
}

async function attempt<R extends { kind: "ok" }>(fn: () => Promise<R>): Promise<R | Refused> {
  try {
    return await fn();
  } catch (err) {
    return refusalFor(err);
  }
}

interface GateOptions {
  /** The photo a designate or remove names: must be this person's here, and not removed. */
  photoId?: string;
  /** Refuse a person who appears to be under 18 (add, designate). */
  adult?: boolean;
  /** Refuse when the person already holds the cap of live photos (add). */
  cap?: boolean;
}

const isDuplicateImage = (err: unknown) =>
  pgErrorField(err, "code") === "23505" && pgErrorField(err, "constraint") === "person_photos_active_image_idx";

/** Steps 1-5 of the check order (see the header). Throws `Refuse`. Returns the person's `{first}`. */
async function gate(tx: OrgTx, ctx: PhotoCtx, personId: string, options: GateOptions): Promise<string> {
  const [flags] = rowsOf(
    await tx.execute(sql`
      select presby_person_photos_enabled(${ctx.organizationId}::uuid) as enabled,
             presby_has_permission(${ctx.actorPersonId}::uuid, ${ctx.organizationId}::uuid, 'people.manage') as allowed`),
  );
  if (flags?.enabled !== true) throw new Refuse("feature_off");
  if (flags?.allowed !== true) throw new Refuse("forbidden");

  const [member] = await tx
    .select({ first: sql<string>`coalesce(${people.preferredName}, ${people.firstName})` })
    .from(memberships)
    .innerJoin(people, eq(people.id, memberships.personId))
    .where(and(eq(memberships.personId, personId), eq(memberships.organizationId, ctx.organizationId)))
    .limit(1);
  if (!member) throw new Refuse("not_found");
  const first = member.first;

  if (options.photoId !== undefined) {
    const [photo] = await tx
      .select({ removedAt: personPhotos.removedAt })
      .from(personPhotos)
      .where(
        and(
          eq(personPhotos.id, options.photoId),
          eq(personPhotos.organizationId, ctx.organizationId),
          eq(personPhotos.personId, personId),
        ),
      )
      .limit(1);
    if (!photo) throw new Refuse("not_found");
    if (photo.removedAt !== null) throw new Refuse("already_removed");
  }

  if (options.adult) {
    const [minor] = rowsOf(
      await tx.execute(sql`select presby_photo_subject_is_minor(${ctx.organizationId}::uuid, ${personId}::uuid) as minor`),
    );
    if (minor?.minor === true) throw new Refuse("minor", first);
  }

  if (options.cap) {
    const [live] = await tx
      .select({ n: count() })
      .from(personPhotos)
      .where(
        and(
          eq(personPhotos.organizationId, ctx.organizationId),
          eq(personPhotos.personId, personId),
          isNull(personPhotos.removedAt),
        ),
      );
    if ((live?.n ?? 0) >= PHOTO_CAP_PER_PERSON) throw new Refuse("cap_reached", first);
  }
  return first;
}

/** Serializes every change to one person's photos (add, designate, remove). */
async function lockPerson(tx: OrgTx, ctx: PhotoCtx, personId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`person_photos:${ctx.organizationId}:${personId}`}, 0))`,
  );
}

type PhotoAuditAction =
  | typeof AUDIT_ACTIONS.PERSON_PHOTO_ADDED
  | typeof AUDIT_ACTIONS.PERSON_PHOTO_REMOVED
  | typeof AUDIT_ACTIONS.PERSON_PHOTO_DESIGNATED
  | typeof AUDIT_ACTIONS.PERSON_PHOTO_UNDESIGNATED;

async function audit(
  tx: OrgTx,
  ctx: PhotoCtx,
  personId: string,
  action: PhotoAuditAction,
  metadata: Record<string, unknown>,
): Promise<void> {
  await insertAuditRow(tx, {
    action,
    actor: ctx.actor,
    resourceType: "person",
    resourceId: personId,
    metadata: { organizationId: ctx.organizationId, personId, ...metadata },
  });
}

/** The person's active designation for a purpose, if any. */
async function activeDesignation(tx: OrgTx, ctx: PhotoCtx, personId: string, purpose: Purpose) {
  const [row] = await tx
    .select({
      id: personPhotoDesignations.id,
      photoId: personPhotoDesignations.photoId,
      attested: personPhotoDesignations.publicAttestedAt,
    })
    .from(personPhotoDesignations)
    .where(
      and(
        eq(personPhotoDesignations.organizationId, ctx.organizationId),
        eq(personPhotoDesignations.personId, personId),
        eq(personPhotoDesignations.purpose, purpose),
        isNull(personPhotoDesignations.endedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function endDesignation(tx: OrgTx, ctx: PhotoCtx, designationId: string): Promise<void> {
  await tx
    .update(personPhotoDesignations)
    .set({ endedAt: sql`now()`, endedBy: ctx.actor.userId })
    .where(
      and(
        eq(personPhotoDesignations.id, designationId),
        eq(personPhotoDesignations.organizationId, ctx.organizationId),
        isNull(personPhotoDesignations.endedAt),
      ),
    );
}

async function insertDesignation(
  tx: OrgTx,
  ctx: PhotoCtx,
  personId: string,
  photoId: string,
  purpose: Purpose,
  attested: boolean,
): Promise<void> {
  // `designated_at` is stamped by the guard trigger; never passed (0078).
  await tx.insert(personPhotoDesignations).values({
    organizationId: ctx.organizationId,
    personId,
    photoId,
    purpose,
    publicAttestedAt: attested ? sql`now()` : null,
    publicAttestedBy: attested ? ctx.actor.userId : null,
    designatedBy: ctx.actor.userId,
  });
}

/**
 * `store()` de-duplicates by content hash with check-then-insert, so two
 * simultaneous stores of the same bytes (a double-clicked upload; the same file
 * for two people) can both miss the check and one insert loses to the unique
 * index (23505). The second attempt finds the row the winner wrote and returns
 * its key. Once only: anything that fails twice is a real fault.
 */
async function retryOnDedupRace<T>(attemptStore: () => Promise<T>): Promise<T> {
  try {
    return await attemptStore();
  } catch (err) {
    if (pgErrorField(err, "code") !== "23505") throw err;
    return attemptStore();
  }
}

export type AddPhotoResult = MutationResult<{ photoId: string; usedForDirectory: boolean }>;

/**
 * Adds a photo to an adult's set. The first photo (or any photo while the
 * person has no active directory designation) becomes the DIRECTORY photo
 * without attestation; it never becomes the website photo by itself.
 */
export async function addPhoto(ctx: PhotoCtx, rawPersonId: string, file: Buffer): Promise<AddPhotoResult> {
  const personId = parseBlobKey(rawPersonId);
  if (personId === null) return { kind: "refused", reason: "not_found" };

  // 1. Authorize and check the target BEFORE any decode (R7).
  const first = await attempt(async () => {
    await withOrgContext(ctx.actorPersonId, ctx.organizationId, (tx) => gate(tx, ctx, personId, { adult: true, cap: true }));
    return { kind: "ok" } as const;
  });
  if (first.kind === "refused") return first;

  // 2. Decode, strip, re-encode. Outside any transaction.
  const processed = await processPhoto(file);
  if (processed.kind === "refused") return { kind: "refused", reason: processed.reason };

  // 3. Two private blobs, each its own transaction (store() owns it, DECISION-030).
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
    return refusalFor(err);
  }

  // 4. The write, under the person's lock, repeating every check.
  return attempt(() =>
    withOrgContext(ctx.actorPersonId, ctx.organizationId, async (tx) => {
      await lockPerson(tx, ctx, personId);
      const first = await gate(tx, ctx, personId, { adult: true, cap: true });

      const [same] = await tx
        .select({ id: personPhotos.id })
        .from(personPhotos)
        .where(
          and(
            eq(personPhotos.organizationId, ctx.organizationId),
            eq(personPhotos.personId, personId),
            eq(personPhotos.imageAssetKey, imageKey),
            isNull(personPhotos.removedAt),
          ),
        )
        .limit(1);
      if (same) throw new Refuse("duplicate", first);

      // `created_at` is stamped by the guard trigger; never passed (0078).
      let photo: { id: string } | undefined;
      try {
        [photo] = await tx
          .insert(personPhotos)
          .values({
            organizationId: ctx.organizationId,
            personId,
            imageAssetKey: imageKey,
            thumbAssetKey: thumbKey,
            width: processed.width,
            height: processed.height,
            createdBy: ctx.actor.userId,
          })
          .returning({ id: personPhotos.id });
      } catch (err) {
        // The pre-check above makes this unreachable under the lock; the partial unique is the backstop.
        if (isDuplicateImage(err)) throw new Refuse("duplicate", first);
        throw err;
      }
      if (!photo) throw new Error("person_photos insert returned no row");

      const hasDirectory = (await activeDesignation(tx, ctx, personId, "directory")) !== null;
      if (!hasDirectory) await insertDesignation(tx, ctx, personId, photo.id, "directory", false);

      await audit(tx, ctx, personId, AUDIT_ACTIONS.PERSON_PHOTO_ADDED, {
        photoId: photo.id,
        autoDirectory: !hasDirectory,
      });
      if (!hasDirectory) {
        await audit(tx, ctx, personId, AUDIT_ACTIONS.PERSON_PHOTO_DESIGNATED, {
          photoId: photo.id,
          purpose: "directory",
          attested: false,
          replacedPhotoId: null,
          via: "add",
        });
      }
      return { kind: "ok", photoId: photo.id, usedForDirectory: !hasDirectory } as const;
    }),
  );
}

/**
 * Chooses a photo for a purpose. Ends the active designation for that purpose,
 * then inserts the new one (the partial unique index forbids the reverse
 * order). `website` requires `attested === true`: the editor confirms the
 * person agreed to a public photo. For `directory`, `attested` is the optional
 * clearance that lets this photo stand in on the website when no website photo
 * is chosen (DECISION-286). Choosing the photo and attestation that are already
 * active writes nothing and succeeds.
 */
export async function designatePhoto(
  ctx: PhotoCtx,
  rawPersonId: string,
  input: { photoId: string; purpose: Purpose; attested: boolean },
): Promise<MutationResult> {
  const personId = parseBlobKey(rawPersonId);
  const photoId = parseBlobKey(input.photoId);
  if (personId === null || photoId === null) return { kind: "refused", reason: "not_found" };
  if (input.purpose !== "directory" && input.purpose !== "website") return { kind: "refused", reason: "not_found" };
  const { purpose } = input;

  return attempt(() =>
    withOrgContext(ctx.actorPersonId, ctx.organizationId, async (tx) => {
      await lockPerson(tx, ctx, personId);
      // The date of birth can change between add and designate (a correction), so
      // the adult check runs here too.
      await gate(tx, ctx, personId, { photoId, adult: true });
      if (purpose === "website" && input.attested !== true) throw new Refuse("attestation_required");
      const attested = purpose === "website" ? true : input.attested === true;

      const current = await activeDesignation(tx, ctx, personId, purpose);
      if (current && current.photoId === photoId && (current.attested !== null) === attested) {
        return { kind: "ok" } as const; // already exactly this: nothing to write, nothing to audit
      }
      if (current) await endDesignation(tx, ctx, current.id);
      await insertDesignation(tx, ctx, personId, photoId, purpose, attested);

      await audit(tx, ctx, personId, AUDIT_ACTIONS.PERSON_PHOTO_DESIGNATED, {
        photoId,
        purpose,
        attested,
        replacedPhotoId: current && current.photoId !== photoId ? current.photoId : null,
        via: "designate",
      });
      return { kind: "ok" } as const;
    }),
  );
}

/** Ends the active designation for a purpose. None active: succeeds, writes nothing, no audit row. */
export async function undesignatePhoto(ctx: PhotoCtx, rawPersonId: string, purpose: Purpose): Promise<MutationResult> {
  const personId = parseBlobKey(rawPersonId);
  if (personId === null) return { kind: "refused", reason: "not_found" };
  if (purpose !== "directory" && purpose !== "website") return { kind: "refused", reason: "not_found" };

  return attempt(() =>
    withOrgContext(ctx.actorPersonId, ctx.organizationId, async (tx) => {
      await lockPerson(tx, ctx, personId);
      await gate(tx, ctx, personId, {});

      const current = await activeDesignation(tx, ctx, personId, purpose);
      if (!current) return { kind: "ok" } as const;
      await endDesignation(tx, ctx, current.id);
      await audit(tx, ctx, personId, AUDIT_ACTIONS.PERSON_PHOTO_UNDESIGNATED, {
        photoId: current.photoId,
        purpose,
        via: "undesignate",
      });
      return { kind: "ok" } as const;
    }),
  );
}

/**
 * Removes a photo: ends every active designation of it, then sets `removed_at`.
 * One `undesignated` audit row per ended designation (the website designation
 * is the sensitive disclosure act and its end gets its own row) and then
 * `removed`. The bytes stay in `blob_assets` (no delete path exists).
 */
export async function removePhoto(ctx: PhotoCtx, rawPersonId: string, rawPhotoId: string): Promise<MutationResult> {
  const personId = parseBlobKey(rawPersonId);
  const photoId = parseBlobKey(rawPhotoId);
  if (personId === null || photoId === null) return { kind: "refused", reason: "not_found" };

  return attempt(() =>
    withOrgContext(ctx.actorPersonId, ctx.organizationId, async (tx) => {
      await lockPerson(tx, ctx, personId);
      await gate(tx, ctx, personId, { photoId });

      const active = await tx
        .select({ id: personPhotoDesignations.id, purpose: personPhotoDesignations.purpose })
        .from(personPhotoDesignations)
        .where(
          and(
            eq(personPhotoDesignations.organizationId, ctx.organizationId),
            eq(personPhotoDesignations.photoId, photoId),
            isNull(personPhotoDesignations.endedAt),
          ),
        );
      const endedPurposes: Purpose[] = [];
      for (const designation of active) {
        await endDesignation(tx, ctx, designation.id);
        endedPurposes.push(designation.purpose);
        await audit(tx, ctx, personId, AUDIT_ACTIONS.PERSON_PHOTO_UNDESIGNATED, {
          photoId,
          purpose: designation.purpose,
          via: "remove",
        });
      }

      // removed_at and removed_by together (person_photos_removal_pair).
      await tx
        .update(personPhotos)
        .set({ removedAt: sql`now()`, removedBy: ctx.actor.userId })
        .where(
          and(
            eq(personPhotos.id, photoId),
            eq(personPhotos.organizationId, ctx.organizationId),
            isNull(personPhotos.removedAt),
          ),
        );
      await audit(tx, ctx, personId, AUDIT_ACTIONS.PERSON_PHOTO_REMOVED, { photoId, endedPurposes });
      return { kind: "ok" } as const;
    }),
  );
}
