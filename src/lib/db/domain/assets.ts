import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  check,
  unique,
  customType,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";

/**
 * The generic blob storage adapter (DECISION-030, DECISION-055, DECISION-058).
 *
 * DECISION-030 required that no caller query this table directly — reads and
 * writes go through `src/lib/storage/blob-store.ts`'s `resolve`/`store`
 * interface. This file holds ONLY the table definition; it is imported by the
 * storage module and nothing else (DECISION-058 — the adapter is a small
 * abstraction boundary, same category as `src/lib/authz.ts`, not a schema
 * module in the shape every other `db/domain/` file is).
 *
 * The logo was the first real consumer (DECISION-055). Person photos are a
 * private consumer since drizzle/0078 (person_photos, pinned 'private' by a
 * three-column composite FK like the others below); `people.photo_key` is
 * retired, never a blob reference.
 *
 * AUDIENCE (drizzle/0072_presby_blob_audience.sql, F289, DECISION-277). Every
 * row is `public_site` (a brand mark or a site-bundle image: what the public
 * asset route may serve) or `private` (everything else: ticket attachments,
 * statement PDFs, the bundle JSON itself, wordmarks, replaced marks). The
 * column defaults to 'private' permanently, so a writer that forgets it fails
 * closed; store() still takes it as a required argument. What the table
 * builder below cannot express, and where it is enforced instead:
 *   - immutability on every connection, the owner included: the
 *     blob_assets_audience_immutable trigger (0072 section 9);
 *   - private consumers pin 'private' by a three-column composite FK into
 *     blob_assets_id_org_audience_key (0072 section 8, and 0078 section 1
 *     for person_photos' image and thumbnail; the consumer side declares its
 *     asset_audience column, the FK itself is DDL-only, see below);
 *   - presby_public_site_asset() (0072 section 12, its photo test moved to
 *     person_photos by 0078 section 6) is the public asset route's only
 *     door: a SECURITY DEFINER that serves a public_site image, or a listed
 *     person's photo by the roster functions' own definition, and nothing
 *     else.
 */

// drizzle-orm/pg-core has no bytea primitive.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const blobAssets = pgTable(
  "blob_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // sha256 hex digest of `bytes`. Dedup key alongside organizationId and
    // audience: two uploads of byte-identical content within one org AND one
    // audience resolve to the same row instead of storing the image twice
    // (E-c6). Across audiences they are two rows (F298, drizzle/0072), so a
    // private upload never resolves to a public_site row.
    contentHash: text("content_hash").notNull(),
    // Raster only, plus PDF (DECISION-071/073, ticket attachments) and
    // structured JSON (DECISION-088, the normalized site content bundle).
    // SVG is rejected at the schema (G7) — <script> and <foreignObject> make
    // sanitising it its own project, so it never gets a row to begin with.
    // Each caller keeps its own narrower magic-byte sniff / declared-type
    // check as the real per-feature gate; this CHECK is only the shared
    // outer bound (the union of every consumer's needs).
    contentType: text("content_type").notNull(),
    // The 10MB cap (DECISION-071/073 widened this from the original 2MB —
    // "That file is 12 MB — we can take up to 2 MB." no longer describes the
    // live constraint; see blob_assets_byte_size_bounds below).
    byteSize: integer("byte_size").notNull(),
    bytes: bytea("bytes").notNull(),
    // 'public_site' | 'private'. See the header; immutable by trigger (0072
    // section 9), never by anything this builder can say.
    audience: text("audience").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite-tenant-key convention (docs/schema-design.md sec 3): the
    // target of every cross-table composite FK into this table, e.g.
    // organization_brands.mark_asset_key / wordmark_asset_key in
    // drizzle/0016_presby_brand_storage.sql.
    //
    // That FK is NOT declared here as a Drizzle foreignKey() on the
    // organization_brands side (in org.ts): doing so would require org.ts to
    // import this file, and this file already imports `organizations` from
    // ./org — a circular module dependency. Every other domain/ file forms a
    // one-directional graph rooted at org.ts (people.ts -> org.ts,
    // roll.ts -> org.ts + people.ts, ...); making org.ts depend on assets.ts
    // would be the first cycle and would break at module-load time (assets.ts
    // would read `organizations` before org.ts's own top-level const has
    // finished initializing). The constraint is enforced at the database
    // level in the migration instead, where it has no import graph to honor.
    unique("blob_assets_id_org_key").on(t.id, t.organizationId),
    // The target of the PRIVATE consumers' three-column FKs
    // (ticket_messages_attachment_fk, giving_statements_blob_fk, and from
    // 0073 treasury's receipts): (x, organization_id, asset_audience ==
    // 'private') -> (id, organization_id, audience). Name fixed (0073 targets
    // it). The brand and site FKs keep targeting blob_assets_id_org_key above.
    unique("blob_assets_id_org_audience_key").on(t.id, t.organizationId, t.audience),
    // The dedup key store() checks before inserting: per audience (F298), so
    // a private upload byte-identical to a public image is its own row.
    unique("blob_assets_org_audience_hash_key").on(t.organizationId, t.audience, t.contentHash),
    check("blob_assets_audience_allowed", sql`${t.audience} in ('public_site','private')`),
    // A public_site row is an image, as a database property.
    check(
      "blob_assets_public_site_is_image",
      sql`${t.audience} = 'private' or ${t.contentType} in ('image/png','image/jpeg','image/webp')`,
    ),
    check(
      "blob_assets_content_type_allowed",
      sql`${t.contentType} in ('image/png','image/jpeg','image/webp','application/pdf','application/json')`,
    ),
    check(
      "blob_assets_byte_size_bounds",
      sql`${t.byteSize} > 0 and ${t.byteSize} <= 10485760`,
    ),
  ],
);
