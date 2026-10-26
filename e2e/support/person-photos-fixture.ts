/**
 * person-photos-fixture.ts - synthetic pictures and rows for the person-photos
 * specs (docs/work-log/2026-10-26-person-photos-inc1.md, Batch 3; DECISION-157:
 * a spec creates only its own rows and removes them itself).
 *
 * NO REAL PHOTO ENTERS THE REPOSITORY. Every picture here is generated at run
 * time from random noise (so it is large and incompressible, which is what
 * exercises the client downscale) and carries invented metadata.
 *
 * Written on the owner connection (`platformSql`): fixture plumbing, never
 * application code. F337: `removeSiteOrg` (custom-hosts.ts) deletes
 * `blob_assets` last but photo rows reference them with NO ACTION, so a spec
 * that seeded photos must call `removePhotoRows` BEFORE any shared teardown;
 * `sweepPhotoRows` is the crash sweep (run it BEFORE `sweepCommunityPeople`,
 * for the same reason `sweepEmailExtras` is: a surviving `person_photos_person_fk`
 * row makes the people delete fail and poisons every later run).
 *
 * Everything is scoped by the ids it is handed. Nothing here touches a row it
 * did not create or was not told to.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { withDbRetry, type Sql } from "./db";
import { COMMUNITY_ORG, FIXTURE_FIRST_NAME } from "./community-fixture";

export const PHOTOS_TOGGLE = "org_portal.person_photos";

// ---------------------------------------------------------------------------
// synthetic pictures
// ---------------------------------------------------------------------------

/**
 * A large noise JPEG marked "rotate 90 clockwise" (EXIF orientation 6) with an invented
 * copyright, a GPS latitude reference and a latitude: a landscape raster that displays as a
 * portrait, with location information in it. 3000 x 2000 noise at quality 92 is about 5 MB.
 */
export async function syntheticExifJpeg(width = 3000, height = 2000): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .withMetadata({
      orientation: 6,
      exif: { IFD0: { Copyright: "synthetic e2e" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 0/1 0/1" } },
    })
    .toBuffer();
}

/** A large noise PNG (about 9 MB at 2000 x 1500): far over the 1 MiB Server Action limit before the downscale. */
export async function syntheticLargePng(width = 2000, height = 1500): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
}

/** A small, valid JPEG (a flat colour with a little noise so two differ), for rows a spec seeds itself. */
export async function smallJpeg(tag: string): Promise<Buffer> {
  const hue = createHash("sha256").update(tag).digest();
  return sharp({ create: { width: 240, height: 320, channels: 3, background: { r: hue[0]!, g: hue[1]!, b: hue[2]! } } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/**
 * A 160 x 160 WebP, the thumbnail's shape. `photographic` adds a gradient and mild noise so the
 * file is a few KB like a real portrait thumbnail (a flat colour is about 100 bytes), for the
 * directory's document-size measurement (E4).
 */
export async function smallWebp(tag: string, photographic = false): Promise<Buffer> {
  const hue = createHash("sha256").update(`thumb-${tag}`).digest();
  if (!photographic) {
    return sharp({ create: { width: 160, height: 160, channels: 3, background: { r: hue[0]!, g: hue[1]!, b: hue[2]! } } })
      .webp()
      .toBuffer();
  }
  const raw = Buffer.alloc(160 * 160 * 3);
  const noise = randomBytes(160 * 160);
  for (let y = 0; y < 160; y += 1) {
    for (let x = 0; x < 160; x += 1) {
      const i = (y * 160 + x) * 3;
      const n = (noise[y * 160 + x]! % 24) - 12;
      raw[i] = Math.max(0, Math.min(255, hue[0]! / 2 + x + n));
      raw[i + 1] = Math.max(0, Math.min(255, hue[1]! / 2 + y + n));
      raw[i + 2] = Math.max(0, Math.min(255, hue[2]! / 2 + (x + y) / 2 + n));
    }
  }
  return sharp(raw, { raw: { width: 160, height: 160, channels: 3 } }).webp({ quality: 70 }).toBuffer();
}

// ---------------------------------------------------------------------------
// the per-organization toggle
// ---------------------------------------------------------------------------

/** The toggle row's value, or null when there is none (provisioned off). */
export async function getPhotosToggle(sql: Sql, orgId: string): Promise<boolean | null> {
  const rows = (await withDbRetry("read photos toggle", () => sql`
    select enabled from organization_feature_toggles
     where organization_id = ${orgId}::uuid and feature_key = ${PHOTOS_TOGGLE}`)) as { enabled: boolean }[];
  return rows[0]?.enabled ?? null;
}

/** Sets the toggle, or removes the row when `enabled` is null. */
export async function setPhotosToggle(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  await withDbRetry("set photos toggle", async () => {
    if (enabled === null) {
      await sql`delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = ${PHOTOS_TOGGLE}`;
    } else {
      await sql`
        insert into organization_feature_toggles (organization_id, feature_key, enabled)
        values (${orgId}::uuid, ${PHOTOS_TOGGLE}, ${enabled})
        on conflict (organization_id, feature_key) do update set enabled = ${enabled}`;
    }
  });
}

/** Restores a captured toggle value, verifying by SELECT. */
export async function restorePhotosToggle(sql: Sql, orgId: string, prior: boolean | null): Promise<void> {
  await setPhotosToggle(sql, orgId, prior);
  const now = await getPhotosToggle(sql, orgId);
  if (now !== prior) throw new Error(`[person-photos-fixture] the ${PHOTOS_TOGGLE} toggle was not restored (${String(now)} vs ${String(prior)})`);
}

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

export interface PhotoRow {
  id: string;
  image_asset_key: string;
  thumb_asset_key: string;
  width: number;
  height: number;
  removed: boolean;
}

export interface DesignationRow {
  photo_id: string;
  purpose: "directory" | "website";
  attested: boolean;
  ended: boolean;
}

/** Every photo of a person at an organization, oldest first, live and removed. */
export async function photoRows(sql: Sql, orgId: string, personId: string): Promise<PhotoRow[]> {
  return (await withDbRetry("read photo rows", () => sql`
    select id, image_asset_key::text, thumb_asset_key::text, width, height, removed_at is not null as removed
      from person_photos
     where organization_id = ${orgId}::uuid and person_id = ${personId}::uuid
     order by created_at, id`)) as PhotoRow[];
}

/** Every designation of a person at an organization, oldest first, active and ended. */
export async function designationRows(sql: Sql, orgId: string, personId: string): Promise<DesignationRow[]> {
  return (await withDbRetry("read designation rows", () => sql`
    select photo_id::text, purpose, public_attested_at is not null as attested, ended_at is not null as ended
      from person_photo_designations
     where organization_id = ${orgId}::uuid and person_id = ${personId}::uuid
     order by designated_at, id`)) as DesignationRow[];
}

/** The stored bytes of a blob (a master), or null. */
export async function blobBytes(sql: Sql, blobId: string): Promise<{ bytes: Buffer; contentType: string; audience: string } | null> {
  const rows = (await withDbRetry("read blob bytes", () => sql`
    select encode(bytes, 'hex') as hex, content_type, audience from blob_assets where id = ${blobId}::uuid`)) as {
    hex: string;
    content_type: string;
    audience: string;
  }[];
  return rows[0] ? { bytes: Buffer.from(rows[0].hex, "hex"), contentType: rows[0].content_type, audience: rows[0].audience } : null;
}

/** Audit rows the photo actions wrote for a person, oldest first (`tenant.person_photo.*`). */
export async function photoAudit(sql: Sql, personId: string, since?: string): Promise<{ action: string; metadata: Record<string, unknown> }[]> {
  return (await withDbRetry("read photo audit", () => sql`
    select action, metadata from audit_events
     where action like 'tenant.person_photo.%' and metadata->>'personId' = ${personId}
       and (${since ?? null}::timestamptz is null or created_at > ${since ?? null}::timestamptz)
     order by created_at, id`)) as { action: string; metadata: Record<string, unknown> }[];
}

/**
 * Seeds one photo straight into the tables (a private master and a private
 * thumbnail, both real images) and designates it for `purposes`. A website
 * designation is always attested (the CHECK); a directory one only when
 * `attestDirectory`. Returns the ids. The person must already be a member.
 */
export async function seedPhoto(
  sql: Sql,
  o: {
    orgId: string;
    personId: string;
    userId: string;
    tag: string;
    purposes?: Array<"directory" | "website">;
    attestDirectory?: boolean;
    thumbnail?: "flat" | "photographic";
  },
): Promise<{ photoId: string; imageKey: string; thumbKey: string }> {
  const imageKey = randomUUID();
  const thumbKey = randomUUID();
  const master = await smallJpeg(`${o.tag}-${imageKey}`);
  const thumb = await smallWebp(`${o.tag}-${thumbKey}`, o.thumbnail === "photographic");
  for (const [id, bytes, type] of [
    [imageKey, master, "image/jpeg"],
    [thumbKey, thumb, "image/webp"],
  ] as const) {
    await withDbRetry("seed photo blob", () => sql`
      insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
      values (${id}::uuid, ${o.orgId}::uuid, ${createHash("sha256").update(bytes).digest("hex")}, ${type},
              ${bytes.byteLength}, decode(${bytes.toString("hex")}, 'hex'), 'private')`);
  }
  const photo = (await withDbRetry("seed person photo", () => sql`
    insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
    values (${o.orgId}::uuid, ${o.personId}::uuid, ${imageKey}::uuid, ${thumbKey}::uuid, 240, 320, ${o.userId}::uuid)
    returning id::text`)) as { id: string }[];
  const photoId = photo[0]!.id;
  for (const purpose of o.purposes ?? ["website"]) {
    const attested = purpose === "website" || o.attestDirectory === true;
    await withDbRetry("seed photo designation", () => sql`
      insert into person_photo_designations (organization_id, person_id, photo_id, purpose,
                                             public_attested_at, public_attested_by, designated_by)
      values (${o.orgId}::uuid, ${o.personId}::uuid, ${photoId}::uuid, ${purpose},
              ${attested ? sql`now()` : sql`null`}, ${attested ? o.userId : null}, ${o.userId}::uuid)`);
  }
  return { photoId, imageKey, thumbKey };
}

/**
 * Ends a photo's active designations and marks it removed, the way `store.ts` does, so a spec can
 * reproduce "the photo was removed" without the UI. Removal is one-way by trigger on every connection.
 */
export async function removeSeededPhoto(sql: Sql, photoId: string, userId: string): Promise<void> {
  await withDbRetry("end designations", () => sql`
    update person_photo_designations set ended_at = now(), ended_by = ${userId}::uuid
     where photo_id = ${photoId}::uuid and ended_at is null`);
  await withDbRetry("remove photo", () => sql`
    update person_photos set removed_at = now(), removed_by = ${userId}::uuid
     where id = ${photoId}::uuid and removed_at is null`);
}

/**
 * Deletes every photo row, designation, the photos' blobs and the photo audit rows of the given
 * people (owner path: the application's roles hold no DELETE). Run before any teardown that deletes
 * memberships, people or an organization (F337). Confirms by SELECT.
 */
export async function removePhotoRows(sql: Sql, personIds: string[]): Promise<void> {
  if (personIds.length === 0) return;
  await withDbRetry("remove photo rows", async () => {
    const photos = (await sql`
      select image_asset_key::text as a, thumb_asset_key::text as b from person_photos
       where person_id = any(${personIds}::uuid[])`) as { a: string; b: string }[];
    await sql`delete from person_photo_designations where person_id = any(${personIds}::uuid[])`;
    await sql`delete from person_photos where person_id = any(${personIds}::uuid[])`;
    const blobs = photos.flatMap((p) => [p.a, p.b]);
    if (blobs.length > 0) await sql`delete from blob_assets where id = any(${blobs}::uuid[]) and audience = 'private'`;
    await sql`delete from audit_events where action like 'tenant.person_photo.%' and metadata->>'personId' = any(${personIds})`;
    const left = (await sql`select 1 from person_photos where person_id = any(${personIds}::uuid[])`) as unknown[];
    if (left.length > 0) throw new Error("[person-photos-fixture] photo rows survived their removal");
  });
}

/**
 * Crash sweep for the Community fixture's people at the Community organization: run BEFORE
 * `sweepCommunityPeople`. A run that died before its afterAll leaves photo rows whose FK to the
 * membership makes the people delete fail.
 */
export async function sweepPhotoRows(sql: Sql): Promise<void> {
  const rows = (await withDbRetry("list photo-fixture people", () => sql`
    select id::text from people
     where first_name = ${FIXTURE_FIRST_NAME}
       and exists (select 1 from memberships m where m.person_id = people.id and m.organization_id = ${COMMUNITY_ORG.id}::uuid)`)) as { id: string }[];
  await removePhotoRows(sql, rows.map((r) => r.id));
}
