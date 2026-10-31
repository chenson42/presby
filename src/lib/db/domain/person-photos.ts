import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  check,
  unique,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";
import { memberships } from "./people";
import { users } from "../schema";

/**
 * Person photos, Increment 1 (docs/work-log/2026-10-26-person-photos-inc1.md;
 * DECISION-285, 286, 289). DDL is hand-written in
 * drizzle/0078_presby_person_photos.sql; this file is for TypeScript's
 * benefit and the migration is the ground truth.
 *
 * A photo belongs to the MEMBERSHIP (the congregation's relationship with the
 * person), never to the global `people` row (D1): two congregations that
 * share a person each keep their own set, and a presbytery cannot see or
 * change a congregation's. `people.photo_key` is RETIRED (held null by
 * people_photo_key_retired in 0078, dropped in 0079; see people.ts).
 *
 * The only writer of both tables is src/lib/person-photos/store.ts; the only
 * other reader is src/lib/person-photos/reader.ts (plus directory.ts's raw
 * SQL through presby_person_directory_photo()). Whether a photo shows on any
 * surface is decided by the five SQL functions 0078 section 5 creates, never
 * by TypeScript (DECISION-289).
 *
 * What the table builder below cannot express, and where it is enforced:
 *   - FORCE ROW LEVEL SECURITY and the tenant_isolation policy on both tables
 *     (0078 section 3);
 *   - the grant shape: presby_app SELECT and INSERT, UPDATE only on the
 *     removal / end pair by column grant, NO DELETE; presby_platform nothing
 *     (0078 section 3);
 *   - removal and ending are one-way, and every other column is immutable,
 *     on EVERY connection including the owner (F44): the BEFORE INSERT OR
 *     UPDATE guard triggers person_photos_guard_write and
 *     person_photo_designations_guard_write (0078 section 3). A designation
 *     may only be inserted against a photo that is not removed (same guard).
 *   - the two blob FKs person_photos_image_fk / person_photos_thumb_fk:
 *     (image_asset_key | thumb_asset_key, organization_id, asset_audience)
 *     -> blob_assets (id, organization_id, audience), NO ACTION, pinned to
 *     'private' by person_photos_audience_private - DDL-ONLY (0078 section
 *     1). assets.ts is imported by the storage adapter alone (DECISION-058;
 *     its header), so this file does not import it;
 *     scripts/check-schema-parity.ts allowlists both FKs.
 */

/** The closed purpose vocabulary (person_photo_designations_purpose). */
export const PERSON_PHOTO_PURPOSES = ["directory", "website"] as const;
export type PersonPhotoPurpose = (typeof PERSON_PHOTO_PURPOSES)[number];

/**
 * person_photos: the set. Rows are never updated except to remove, never
 * deleted on the tenant path.
 */
export const personPhotos = pgTable(
  "person_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // The master: at most 1200 px on the long edge, no forced crop, <= 400 KB.
    imageAssetKey: uuid("image_asset_key").notNull(),
    // 160 x 160 WebP, top-biased crop. Never served by the public door.
    thumbAssetKey: uuid("thumb_asset_key").notNull(),
    // Constant 'private' (person_photos_audience_private): the third column
    // of both DDL-only blob FKs. Never written by the application.
    assetAudience: text("asset_audience").notNull().default("private"),
    // Of the master.
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    // Stamped clock_timestamp() by the guard on a non-owner insert.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    // One-way, together (person_photos_removal_pair + the guard trigger).
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (t) => [
    unique("person_photos_id_org_key").on(t.id, t.organizationId),
    // The designation FK target: a designation cannot point at another
    // person's or another org's photo.
    unique("person_photos_id_org_person_key").on(t.id, t.organizationId, t.personId),
    check("person_photos_audience_private", sql`${t.assetAudience} = 'private'`),
    check("person_photos_distinct_assets", sql`${t.imageAssetKey} <> ${t.thumbAssetKey}`),
    check(
      "person_photos_dimensions",
      sql`${t.width} between 1 and 2000 and ${t.height} between 1 and 2000`,
    ),
    check("person_photos_removal_pair", sql`(${t.removedAt} is null) = (${t.removedBy} is null)`),
    // The photo hangs off the membership, not the global person (D1).
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "person_photos_person_fk",
    }),
    // A byte-identical re-upload for the same person is "already in their
    // set"; it reveals nothing about any other person (the dedup oracle).
    uniqueIndex("person_photos_active_image_idx")
      .on(t.organizationId, t.personId, t.imageAssetKey)
      .where(sql`${t.removedAt} is null`),
    // The door's "is this key a photo" lookup, image and thumbnail.
    index("person_photos_image_key_idx").on(t.organizationId, t.imageAssetKey),
    index("person_photos_thumb_key_idx").on(t.organizationId, t.thumbAssetKey),
  ],
);

/**
 * person_photo_designations: end-dated history, not a current-state pointer.
 * Changing the photo or the attestation for a purpose ends the active row and
 * inserts a new one. At most one active row per purpose per person per org
 * (person_photo_designations_active_idx).
 */
export const personPhotoDesignations = pgTable(
  "person_photo_designations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    photoId: uuid("photo_id").notNull(),
    // 'directory' | 'website' (PERSON_PHOTO_PURPOSES).
    purpose: text("purpose").$type<PersonPhotoPurpose>().notNull(),
    // Required for 'website'; optional for 'directory', where it is what lets
    // the directory photo stand in on the public website (DECISION-286, Q6).
    publicAttestedAt: timestamp("public_attested_at", { withTimezone: true }),
    publicAttestedBy: uuid("public_attested_by").references(() => users.id),
    // Stamped clock_timestamp() by the guard on a non-owner insert.
    designatedAt: timestamp("designated_at", { withTimezone: true }).notNull().defaultNow(),
    designatedBy: uuid("designated_by")
      .notNull()
      .references(() => users.id),
    // One-way, together (person_photo_designations_end_pair + the guard).
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: uuid("ended_by").references(() => users.id),
  },
  (t) => [
    unique("person_photo_designations_id_org_key").on(t.id, t.organizationId),
    check("person_photo_designations_purpose", sql`${t.purpose} in ('directory','website')`),
    check(
      "person_photo_designations_attest_pair",
      sql`(${t.publicAttestedAt} is null) = (${t.publicAttestedBy} is null)`,
    ),
    check(
      "person_photo_designations_website_attested",
      sql`${t.purpose} <> 'website' or ${t.publicAttestedAt} is not null`,
    ),
    check("person_photo_designations_end_pair", sql`(${t.endedAt} is null) = (${t.endedBy} is null)`),
    foreignKey({
      columns: [t.photoId, t.organizationId, t.personId],
      foreignColumns: [personPhotos.id, personPhotos.organizationId, personPhotos.personId],
      name: "person_photo_designations_photo_fk",
    }),
    uniqueIndex("person_photo_designations_active_idx")
      .on(t.organizationId, t.personId, t.purpose)
      .where(sql`${t.endedAt} is null`),
    index("person_photo_designations_photo_idx").on(t.organizationId, t.photoId),
  ],
);
