import "server-only";
import { createHash } from "node:crypto";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { blobAssets } from "@/lib/db/domain/assets";
import { parseBlobKey } from "./blob-key";

/**
 * The generic blob storage adapter (DECISION-030, DECISION-055, DECISION-058).
 *
 * `blob_assets` is never queried directly outside this file (DECISION-030's
 * own rule: "a direct query against the blob table from a page or action is a
 * review failure"). Every caller goes through `store()`/`resolve()`/
 * `resolveMeta()`/`findByContentHashes()` (the site ingest's "which hashes do
 * we already hold" lookup, DECISION-279), and the anonymous public asset route goes through
 * `resolvePublic()`, which reaches the table only through one narrow
 * `SECURITY DEFINER` function (`presby_public_site_asset()`, drizzle/0072) -
 * a stricter form of the same rule: the route holds no query of its own and
 * the database, not TypeScript, decides what is public.
 *
 * AUDIENCE (F289, DECISION-277). Every row is `public_site` (an image a
 * public page references: a brand mark, a site image) or `private` (a ticket
 * attachment, a statement PDF, the content bundle, a person's photo...).
 * `store()`, `resolve()` and `resolveMeta()` all take `audience` as a REQUIRED
 * argument with no default, and `resolve()`/`resolveMeta()` match ONLY the
 * audience the caller names: a `private` caller can never read a
 * `public_site` row it did not store, and the reverse holds. The column itself
 * is immutable (a trigger), `public_site` implies an image type (a CHECK), and
 * the private consumers' foreign keys pin `'private'`, so the split is a
 * database property, not a convention here. The audience must be a string
 * LITERAL at every call site; `audience-callsites.test.ts` reads each one.
 *
 * The logo is the first real consumer (DECISION-055). `people.photo_key`
 * stays untouched here: a person's photo is served by `resolvePublic()` only
 * while a roster function lists it, and is stored `private`.
 *
 * WHY THIS DOES NOT CALL `withOrgContext()` FROM `@/lib/authz`:
 *
 * `withOrgContext(personId, organizationId, fn)` verifies that `personId`
 * holds an ACTIVE MEMBERSHIP at `organizationId` before setting the org GUC —
 * that membership check is what makes it safe to trust the org id at all.
 * This module's only caller in this slice is `/admin/organizations`
 * (getPlatformDb()-authorized, gated on `FEATURES.ADMIN_ORGANIZATIONS`): a
 * PLATFORM OPERATOR, who by "Two Hierarchies Intersect Nowhere" holds no
 * congregational membership anywhere. There is no `personId` to hand
 * `withOrgContext()` that would not be fabricated — and fabricating one to
 * satisfy its signature is exactly the "phantom membership" violation the
 * Phase 3 (re-run) design ruled out by name for `organization_brands`'s own
 * write path (DECISION-055/056 discussion, docs/work-log/2026-08-19-brand-
 * foundation.md). The same reasoning applies here without modification: the
 * calling action ALREADY established authorization — `getPlatformDb()` plus
 * the `FEATURES.ADMIN_ORGANIZATIONS` permission check — before it ever calls
 * `store()`/`resolve()`. This module does not re-authorize; it trusts the
 * `organizationId` it is given and does the tenant-scoped write through the
 * same RLS-ENFORCED connection (`db`, `presby_app`, FORCE ROW LEVEL SECURITY)
 * `withOrgContext()` itself uses — it just sets the transaction-scoped GUC
 * directly rather than through the membership-gated wrapper, because no
 * membership exists to gate on.
 *
 * A future tenant-facing caller (slice d's church-facing brand editor) DOES
 * have a real person with a real membership, and should call this module the
 * same way — `organizationId` trusted, no re-check here — after its own
 * action has run the request through `withOrgContext()` for whatever else it
 * needs. Nothing about this module's shape forecloses that; it simply never
 * assumes a person is in scope.
 */

// Widened by DECISION-071/073 (2026-08-20, support tickets) to admit PDF
// ticket attachments, and again by DECISION-088 (2026-08-20, public sites)
// to admit the normalized site content bundle (application/json). This is
// the shared OUTER bound only — each caller keeps its own narrower
// magic-byte sniff (or, for the JSON bundle, its own 422-on-malformed-body
// validation) as the real per-feature gate. The org-brand logo action's
// sniffImageContentType()/MAX_LOGO_BYTES (2MB, images only) run BEFORE
// store() and are untouched by either widening, so the logo path accepts
// nothing new in practice. Mirrors the DB CHECK
// (blob_assets_content_type_allowed / blob_assets_byte_size_bounds) widened
// in drizzle/0019_presby_ticket_support.sql and again in
// drizzle/0020_presby_public_sites.sql — this constant had drifted out of
// sync with the live DB constraint for the application/json case until this
// commit (src/lib/db/domain/assets.ts's own Drizzle check() calls were fixed
// in the schema commit, but this module's own ALLOWED_CONTENT_TYPES was not;
// api-developer's commit 2 needs store() to actually accept
// "application/json" for the ingest route, so it is fixed here).
const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "application/json",
] as const;
type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** The 10MB cap (DECISION-073). Mirrors the DB CHECK. */
const MAX_BYTE_SIZE = 10_485_760;

/** Who a stored blob is for (F289, DECISION-277). Closed vocabulary; mirrors blob_assets_audience_allowed. */
export type BlobAudience = "public_site" | "private";

/** The only content types a `public_site` row, or a public response, may carry. */
export type PublicImageType = "image/png" | "image/jpeg" | "image/webp";

const PUBLIC_IMAGE_TYPES: readonly PublicImageType[] = ["image/png", "image/jpeg", "image/webp"];

function isPublicImageType(value: unknown): value is PublicImageType {
  return typeof value === "string" && (PUBLIC_IMAGE_TYPES as readonly string[]).includes(value);
}

export interface BlobRef {
  /** The row's own uuid — NOT the content hash. See `store()`'s doc comment. */
  key: string;
  contentType: AllowedContentType;
  byteSize: number;
  audience: BlobAudience;
}

export interface StoreInput {
  organizationId: string;
  bytes: Buffer;
  contentType: string;
  /** Required, no default (DECISION-277): a string literal at the call site. */
  audience: BlobAudience;
}

export interface ResolveInput {
  organizationId: string;
  key: string;
  /** Required: only a row of THIS audience matches. A string literal at the call site. */
  audience: BlobAudience;
}

export interface ResolvedBlob {
  bytes: Buffer;
  contentType: string;
}

export interface ResolvedBlobMeta {
  contentType: string;
  byteSize: number;
}

/** What the anonymous public route may serve, and how long a cache may keep it. */
export interface PublicAsset {
  bytes: Buffer;
  contentType: PublicImageType;
  /**
   * `site`: a published page image or the brand mark (immutable, year-long).
   * `roster`: the photo of a person a public roster currently lists (a day,
   * private cache: un-listing must take effect).
   */
  cacheClass: "site" | "roster";
}

export interface BlobStore {
  store(input: StoreInput): Promise<BlobRef>;
  resolve(input: ResolveInput): Promise<ResolvedBlob | null>;
  /**
   * Metadata-only read — no `bytes` column in the SELECT. Added for support
   * tickets (2026-08-20, commit 2/3): `getTicketThread()` needs a message's
   * attachment `contentType` to decide inline-vs-download markup for every
   * message in a thread, and fetching a full (up to 10MB) BYTEA payload just
   * to read one column back out of it — then discarding the bytes — is the
   * wrong cost to pay per message. Same DECISION-030 discipline as
   * `resolve()`: `blob_assets` is still queried nowhere but this file.
   */
  resolveMeta(input: ResolveInput): Promise<ResolvedBlobMeta | null>;
  /**
   * The anonymous public asset door (F289). NO audience parameter: its
   * contract is `presby_public_site_asset(org, key)`, which serves a
   * `public_site` image, or the photo of a person a roster function currently
   * lists, and nothing else, as an image type only. Returns `null` for every
   * miss, and for a key that is not a uuid WITHOUT querying. Like `resolve()`
   * it does not catch a database error: the route owns that catch.
   */
  resolvePublic(input: { organizationId: string; key: string }): Promise<PublicAsset | null>;
  /**
   * Which of these content hashes does this organization already hold, as
   * rows of THIS audience (site-ingest-size, DECISION-279). Added so the
   * staged site ingest can ask "what is the platform missing?" without
   * receiving the bytes first: the answer is a `Map` keyed by the lowercase
   * hex hash, and a hash that is absent is not held. A hash held only as
   * another audience, or only by another organization, is ABSENT - the same
   * per-audience dedup key `store()` uses (F298), so a plan can never report
   * "held" for an image a public bundle could not serve.
   *
   * Metadata only: no `bytes` column in the SELECT. `audience` is required, no
   * default, and a string literal at the call site (audience-callsites.test.ts).
   * The list must be 1..2,000 DISTINCT lowercase 64-character hex digests;
   * anything else throws `BlobValidationError` before a query is issued (the
   * route validates the same things first - this is the second guard).
   */
  findByContentHashes(input: {
    organizationId: string;
    audience: BlobAudience;
    contentHashes: readonly string[];
  }): Promise<Map<string, BlobRef>>;
}

/** The most hashes one `findByContentHashes()` call accepts (the ingest manifest cap). */
export const MAX_FIND_HASHES = 2000;

const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

/** Thrown by `store()` for anything the DB CHECK constraints would also reject. */
export class BlobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobValidationError";
  }
}

function isAllowedContentType(value: string): value is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Sets the org GUC on the RLS-enforced connection for the duration of one
 * transaction, with NO membership check — see the module doc comment for why
 * that is the correct posture here. `set_config(..., true)` is
 * transaction-local, same as `withOrgContext()`, so nothing leaks to the next
 * request on a pooled connection.
 */
function withTrustedOrgContext<T>(
  organizationId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org_id', ${organizationId}, true)`,
    );
    return fn(tx);
  });
}

class PostgresBlobStore implements BlobStore {
  async store({ organizationId, bytes, contentType, audience }: StoreInput): Promise<BlobRef> {
    if (!isAllowedContentType(contentType)) {
      throw new BlobValidationError(
        `blob-store: content type "${contentType}" is not one of ${ALLOWED_CONTENT_TYPES.join(", ")}`,
      );
    }
    // Before the database CHECK (blob_assets_public_site_is_image) would: a
    // public_site row is always an image (png, jpeg or webp).
    if (audience === "public_site" && !isPublicImageType(contentType)) {
      throw new BlobValidationError(
        `blob-store: audience "public_site" requires an image content type (png, jpeg or webp); got "${contentType}"`,
      );
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTE_SIZE) {
      throw new BlobValidationError(
        `blob-store: ${bytes.byteLength} bytes is outside the allowed range (1..${MAX_BYTE_SIZE})`,
      );
    }

    const contentHash = createHash("sha256").update(bytes).digest("hex");

    return withTrustedOrgContext(organizationId, async (tx) => {
      // Dedup (E-c6): check for an existing row at (organizationId,
      // audience, contentHash) BEFORE inserting. The unique constraint on
      // (organization_id, audience, content_hash) backs this up at the
      // database level regardless, but checking first avoids surfacing a
      // constraint-violation error on the ordinary "uploaded the same logo
      // twice" path. Dedup is PER AUDIENCE (F298): identical bytes stored as
      // `private` and as `public_site` are two rows, so a private upload can
      // never silently resolve to a row the public route serves.
      const existing = await tx
        .select({
          id: blobAssets.id,
          contentType: blobAssets.contentType,
          byteSize: blobAssets.byteSize,
        })
        .from(blobAssets)
        .where(
          and(
            eq(blobAssets.organizationId, organizationId),
            eq(blobAssets.audience, audience),
            eq(blobAssets.contentHash, contentHash),
          ),
        )
        .limit(1);

      if (existing[0]) {
        return {
          key: existing[0].id,
          contentType: existing[0].contentType as AllowedContentType,
          byteSize: existing[0].byteSize,
          audience,
        };
      }

      const [inserted] = await tx
        .insert(blobAssets)
        .values({
          organizationId,
          contentHash,
          contentType,
          byteSize: bytes.byteLength,
          bytes,
          audience,
        })
        .returning({
          id: blobAssets.id,
          contentType: blobAssets.contentType,
          byteSize: blobAssets.byteSize,
        });

      // Not reachable in practice — insert() either returns a row or throws
      // — but keeps the return type honest without a non-null assertion.
      if (!inserted) {
        throw new Error("blob-store: insert returned no row");
      }

      return {
        // The KEY IS THE ROW'S OWN UUID, deliberately not the content hash:
        // a future non-content-addressed adapter (e.g. an object-store
        // adapter that generates its own key) does not have to change what a
        // "key" means to every caller that already stored one.
        key: inserted.id,
        contentType: inserted.contentType as AllowedContentType,
        byteSize: inserted.byteSize,
        audience,
      };
    });
  }

  async resolve({ organizationId, key, audience }: ResolveInput): Promise<ResolvedBlob | null> {
    return withTrustedOrgContext(organizationId, async (tx) => {
      const rows = await tx
        .select({
          bytes: blobAssets.bytes,
          contentType: blobAssets.contentType,
        })
        .from(blobAssets)
        .where(
          and(
            eq(blobAssets.id, key),
            eq(blobAssets.organizationId, organizationId),
            eq(blobAssets.audience, audience),
          ),
        )
        .limit(1);

      // Unknown key resolves to null, never a throw — a stale reference (an
      // asset deleted out from under a still-live mark_asset_key, or a typo
      // in a hand-built URL) is an ordinary "nothing here" for every caller,
      // not an exceptional one.
      return rows[0] ?? null;
    });
  }

  async resolveMeta({
    organizationId,
    key,
    audience,
  }: ResolveInput): Promise<ResolvedBlobMeta | null> {
    return withTrustedOrgContext(organizationId, async (tx) => {
      const rows = await tx
        .select({
          contentType: blobAssets.contentType,
          byteSize: blobAssets.byteSize,
        })
        .from(blobAssets)
        .where(
          and(
            eq(blobAssets.id, key),
            eq(blobAssets.organizationId, organizationId),
            eq(blobAssets.audience, audience),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    });
  }

  async findByContentHashes({
    organizationId,
    audience,
    contentHashes,
  }: {
    organizationId: string;
    audience: BlobAudience;
    contentHashes: readonly string[];
  }): Promise<Map<string, BlobRef>> {
    if (contentHashes.length === 0 || contentHashes.length > MAX_FIND_HASHES) {
      throw new BlobValidationError(
        `blob-store: ${contentHashes.length} content hashes is outside the allowed range (1..${MAX_FIND_HASHES})`,
      );
    }
    const seen = new Set<string>();
    for (const hash of contentHashes) {
      if (typeof hash !== "string" || !CONTENT_HASH_RE.test(hash)) {
        throw new BlobValidationError("blob-store: a content hash must be 64 lowercase hex characters");
      }
      if (seen.has(hash)) {
        throw new BlobValidationError("blob-store: the content hash list must not repeat a hash");
      }
      seen.add(hash);
    }

    return withTrustedOrgContext(organizationId, async (tx) => {
      // No `bytes` in the projection: this answers "held or not", never the payload.
      const rows = await tx
        .select({
          id: blobAssets.id,
          contentHash: blobAssets.contentHash,
          contentType: blobAssets.contentType,
          byteSize: blobAssets.byteSize,
        })
        .from(blobAssets)
        .where(
          and(
            eq(blobAssets.organizationId, organizationId),
            eq(blobAssets.audience, audience),
            inArray(blobAssets.contentHash, [...contentHashes]),
          ),
        );

      const held = new Map<string, BlobRef>();
      for (const row of rows) {
        held.set(row.contentHash, {
          key: row.id,
          contentType: row.contentType as AllowedContentType,
          byteSize: row.byteSize,
          audience,
        });
      }
      return held;
    });
  }

  async resolvePublic({
    organizationId,
    key,
  }: {
    organizationId: string;
    key: string;
  }): Promise<PublicAsset | null> {
    // A key that is not a uuid never reaches Postgres (a cast error would be
    // a free log-noise lever for a prober); a case variant collapses onto the
    // canonical lowercase form.
    const canonical = parseBlobKey(key);
    if (canonical === null) return null;

    // The anonymous public-read shape, exactly like getPublishedSite(): the
    // plain `db` connection (presby_app) with NO org GUC. The definer derives
    // everything from the organization id the site resolver returned, checks
    // the org is active and its site live, and returns zero rows for every
    // miss: a private blob, a foreign org's blob and a nonexistent uuid take
    // the same path. Bytes are read for the one row returned only.
    const result = await db.execute(
      sql`select content_type, bytes, cache_class from presby_public_site_asset(${organizationId}::uuid, ${canonical}::uuid)`,
    );
    const row = (
      result as unknown as {
        rows?: Array<{ content_type: unknown; bytes: unknown; cache_class: unknown }>;
      }
    ).rows?.[0];
    if (!row) return null;

    // A second, independent check in TypeScript (belt and braces): the
    // definer and the CHECK already guarantee an image type and a known class.
    if (!isPublicImageType(row.content_type)) return null;
    if (row.cache_class !== "site" && row.cache_class !== "roster") return null;
    if (!(row.bytes instanceof Uint8Array)) return null;

    return {
      bytes: Buffer.from(row.bytes),
      contentType: row.content_type,
      cacheClass: row.cache_class,
    };
  }
}

let instance: BlobStore | null = null;

/** The Postgres-backed implementation, per DECISION-030. Singleton — no
 * per-call construction cost, and every caller shares one adapter instance
 * the way `db`/`getPlatformDb()` are shared. */
export function getBlobStore(): BlobStore {
  if (!instance) {
    instance = new PostgresBlobStore();
  }
  return instance;
}
