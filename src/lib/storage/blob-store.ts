import "server-only";
import { createHash } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { blobAssets } from "@/lib/db/domain/assets";

/**
 * The generic blob storage adapter (DECISION-030, DECISION-055, DECISION-058).
 *
 * `blob_assets` is never queried directly outside this file (DECISION-030's
 * own rule: "a direct query against the blob table from a page or action is a
 * review failure"). Every caller goes through `store()`/`resolve()`.
 *
 * The logo is the first real consumer (DECISION-055). `people.photo_key`
 * stays untouched — no photo migration happens here.
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
// ticket attachments. This is the shared OUTER bound only — each caller
// keeps its own narrower magic-byte sniff as the real per-feature gate. The
// org-brand logo action's sniffImageContentType()/MAX_LOGO_BYTES (2MB,
// images only) run BEFORE store() and are untouched by this widening, so
// the logo path accepts nothing new in practice. Mirrors the DB CHECK
// (blob_assets_content_type_allowed / blob_assets_byte_size_bounds) widened
// in the same commit, drizzle/0019_presby_ticket_support.sql.
const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;
type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** The 10MB cap (DECISION-073). Mirrors the DB CHECK. */
const MAX_BYTE_SIZE = 10_485_760;

export interface BlobRef {
  /** The row's own uuid — NOT the content hash. See `store()`'s doc comment. */
  key: string;
  contentType: AllowedContentType;
  byteSize: number;
}

export interface StoreInput {
  organizationId: string;
  bytes: Buffer;
  contentType: string;
}

export interface ResolveInput {
  organizationId: string;
  key: string;
}

export interface ResolvedBlob {
  bytes: Buffer;
  contentType: string;
}

export interface ResolvedBlobMeta {
  contentType: string;
  byteSize: number;
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
}

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
  async store({ organizationId, bytes, contentType }: StoreInput): Promise<BlobRef> {
    if (!isAllowedContentType(contentType)) {
      throw new BlobValidationError(
        `blob-store: content type "${contentType}" is not one of ${ALLOWED_CONTENT_TYPES.join(", ")}`,
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
      // contentHash) BEFORE inserting. The unique constraint on
      // (organization_id, content_hash) backs this up at the database level
      // regardless, but checking first avoids surfacing a constraint-
      // violation error on the ordinary "uploaded the same logo twice" path.
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
            eq(blobAssets.contentHash, contentHash),
          ),
        )
        .limit(1);

      if (existing[0]) {
        return {
          key: existing[0].id,
          contentType: existing[0].contentType as AllowedContentType,
          byteSize: existing[0].byteSize,
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
      };
    });
  }

  async resolve({ organizationId, key }: ResolveInput): Promise<ResolvedBlob | null> {
    return withTrustedOrgContext(organizationId, async (tx) => {
      const rows = await tx
        .select({
          bytes: blobAssets.bytes,
          contentType: blobAssets.contentType,
        })
        .from(blobAssets)
        .where(
          and(eq(blobAssets.id, key), eq(blobAssets.organizationId, organizationId)),
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
  }: ResolveInput): Promise<ResolvedBlobMeta | null> {
    return withTrustedOrgContext(organizationId, async (tx) => {
      const rows = await tx
        .select({
          contentType: blobAssets.contentType,
          byteSize: blobAssets.byteSize,
        })
        .from(blobAssets)
        .where(
          and(eq(blobAssets.id, key), eq(blobAssets.organizationId, organizationId)),
        )
        .limit(1);

      return rows[0] ?? null;
    });
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
