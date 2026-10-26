/**
 * Shared DB-test seeding for person photos (drizzle/0078; DECISION-285;
 * docs/work-log/2026-10-26-person-photos-inc1.md, F331).
 *
 * Since 0078, `people.photo_key` is retired (held null by
 * people_photo_key_retired) and a person's public photo is
 * presby_person_public_photo(org, person): an active website designation, else
 * an active directory designation attested for the website, withheld when the
 * org's `org_portal.person_photos` toggle is off, the person is a minor, merged,
 * or has hidden their photo. Every DB test that used to write
 * `people.photo_key` seeds through here instead.
 *
 * OWNER PATH ONLY: pass the fixture's `platform` connection (getPlatformDb(),
 * neondb_owner). It writes `blob_assets` directly, which is why it lives under
 * src/lib/testing/ - the one place audience-callsites.test.ts's "blob_assets is
 * queried nowhere but blob-store.ts" scan exempts. The guards still run on this
 * path (F44); nothing here writes a column they forbid.
 *
 * Teardown is the organization delete the calendar fixture already does:
 * person_photos, person_photo_designations and blob_assets all cascade from
 * organizations, and their NO ACTION FKs are satisfied at the end of that one
 * statement (person-photos.db.test.ts pins it).
 */
import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

type Exec = { execute: (query: SQL) => Promise<unknown> };
type Row = Record<string, unknown>;

const rowsOf = (r: unknown): Row[] =>
  Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []);

export type SeedPurpose = "directory" | "website";

export interface SeededPersonPhoto {
  photoId: string;
  /** The master's blob id: what the roster functions project as photo_key. */
  imageKey: string;
  /** The thumbnail's blob id: never listed, never served by the door. */
  thumbKey: string;
}

const JPEG_MAGIC = Buffer.from("ffd8ffe0", "hex");
const WEBP_MAGIC = Buffer.from("52494646", "hex");

/** Inserts a private blob under `id` unless that id already exists (a shared image). */
async function privateBlob(exec: Exec, organizationId: string, id: string, contentType: string, magic: Buffer) {
  const bytes = Buffer.concat([magic, Buffer.from(` person-photo-fixture ${id} ${randomUUID()}`)]);
  const hex = bytes.toString("hex");
  await exec.execute(sql`
    insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
    values (${id}, ${organizationId}, ${createHash("sha256").update(bytes).digest("hex")}, ${contentType},
            ${bytes.byteLength}, decode(${hex}, 'hex'), 'private')
    on conflict (id) do nothing`);
}

/** Turns the per-org toggle on (or off). A missing row is off (provisioned off). */
export async function setPersonPhotosToggle(exec: Exec, organizationId: string, enabled = true): Promise<void> {
  await exec.execute(sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${organizationId}, 'org_portal.person_photos', ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`);
}

/**
 * Adds one photo to a person's set at an org (the person must already be a
 * member: person_photos_person_fk) and designates it for `purposes`. A website
 * designation is always attested (the CHECK requires it); a directory one is
 * attested only when `attestDirectory` (the Q6 fallback condition).
 * `imageKey` may name a blob that already exists in the org (a byte-identical
 * photo shared by two people): it is then reused, never re-inserted.
 */
export async function seedPersonPhoto(
  exec: Exec,
  o: {
    organizationId: string;
    personId: string;
    userId: string;
    imageKey?: string;
    purposes?: SeedPurpose[];
    attestDirectory?: boolean;
  },
): Promise<SeededPersonPhoto> {
  const imageKey = o.imageKey ?? randomUUID();
  const thumbKey = randomUUID();
  await privateBlob(exec, o.organizationId, imageKey, "image/jpeg", JPEG_MAGIC);
  await privateBlob(exec, o.organizationId, thumbKey, "image/webp", WEBP_MAGIC);
  const [photo] = rowsOf(
    await exec.execute(sql`
      insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
      values (${o.organizationId}, ${o.personId}, ${imageKey}, ${thumbKey}, 800, 1000, ${o.userId})
      returning id`),
  );
  const photoId = String(photo!.id);
  for (const purpose of o.purposes ?? ["website"]) {
    const attested = purpose === "website" || o.attestDirectory === true;
    await exec.execute(sql`
      insert into person_photo_designations (organization_id, person_id, photo_id, purpose,
                                             public_attested_at, public_attested_by, designated_by)
      values (${o.organizationId}, ${o.personId}, ${photoId}, ${purpose},
              ${attested ? sql`now()` : sql`null`}, ${attested ? o.userId : null}, ${o.userId})`);
  }
  return { photoId, imageKey, thumbKey };
}

/** Removes a photo the way store.ts does: ends its active designations, then sets removed_at. */
export async function removeSeededPersonPhoto(exec: Exec, photoId: string, userId: string): Promise<void> {
  await exec.execute(sql`
    update person_photo_designations set ended_at = now(), ended_by = ${userId}
     where photo_id = ${photoId} and ended_at is null`);
  await exec.execute(sql`
    update person_photos set removed_at = now(), removed_by = ${userId}
     where id = ${photoId} and removed_at is null`);
}
