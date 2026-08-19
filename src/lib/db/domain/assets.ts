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
 * The logo is the first real consumer (DECISION-055) — not `people.photo_key`,
 * which stays untouched. No photo migration happens here.
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
    // sha256 hex digest of `bytes`. Dedup key alongside organizationId: two
    // uploads of byte-identical content within one org resolve to the same
    // row instead of storing the image twice (E-c6).
    contentHash: text("content_hash").notNull(),
    // Raster only. SVG rejected at the schema (G7) — <script> and
    // <foreignObject> make sanitising it its own project, so it never gets a
    // row to begin with.
    contentType: text("content_type").notNull(),
    // The 2MB cap (Flow 2: "That file is 12 MB — we can take up to 2 MB.").
    byteSize: integer("byte_size").notNull(),
    bytes: bytea("bytes").notNull(),
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
    // The dedup key store() checks before inserting.
    unique("blob_assets_org_hash_key").on(t.organizationId, t.contentHash),
    check(
      "blob_assets_content_type_allowed",
      sql`${t.contentType} in ('image/png','image/jpeg','image/webp')`,
    ),
    check(
      "blob_assets_byte_size_bounds",
      sql`${t.byteSize} > 0 and ${t.byteSize} <= 2097152`,
    ),
  ],
);
