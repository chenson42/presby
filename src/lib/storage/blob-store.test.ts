/**
 * Integration tests for the blob storage adapter — run against a REAL
 * Postgres connection, not mocked.
 *
 * This deliberately departs from this repo's usual unit-test posture (see
 * e.g. src/lib/authz.test.ts, which mocks `@/lib/db`). The point of this
 * file's second and third `it()`s is to prove a DATABASE CHECK constraint
 * rejects bad data independent of `store()`'s own app-level guard — mocking
 * the connection would only prove the mock's behavior. `@/lib/db`'s `db`
 * export opens a real pool at module-import time (`required("DATABASE_URL")`
 * throws if unset), so this file NEVER statically imports `./blob-store` or
 * `@/lib/db`: every import is dynamic, inside `beforeAll`, reached only when
 * `hasDb` is true. `npm test` in CI does not set DATABASE_URL (see
 * .github/workflows/ci.yml — only the `build` step gets one, and it is a
 * fake), so this whole suite is SKIPPED there, not failed. Run it for real
 * with `dotenv -e .env.local -- vitest run src/lib/storage/blob-store.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

// vi.mock() calls are hoisted above the imports by Vitest's transform.
// blob-store.ts (and @/lib/authz, transitively pulled in by nothing here but
// kept consistent with the rest of the tree) import "server-only", which
// throws outside a React Server Component module graph — Vitest's plain node
// environment is exactly that "outside".
vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

describe.skipIf(!hasDb)(
  "blob-store (Postgres-backed, real dev database)",
  () => {
    let getBlobStore: typeof import("./blob-store").getBlobStore;
    let BlobValidationError: typeof import("./blob-store").BlobValidationError;
    let db: typeof import("@/lib/db").db;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let blobAssets: typeof import("@/lib/db/domain/assets").blobAssets;
    let organizations: typeof import("@/lib/db/domain/org").organizations;

    let orgId: string;
    let otherOrgId: string;

    beforeAll(async () => {
      ({ getBlobStore, BlobValidationError } = await import("./blob-store"));
      ({ db, getPlatformDb } = await import("@/lib/db"));
      ({ blobAssets } = await import("@/lib/db/domain/assets"));
      ({ organizations } = await import("@/lib/db/domain/org"));

      const platform = getPlatformDb();
      const stamp = Date.now();

      const [org] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: "Fixture Congregation for blob-store.test.ts",
          slug: `blob-store-test-a-${stamp}`,
          path: `blob_store_test_a_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      orgId = org!.id;

      const [other] = await platform
        .insert(organizations)
        .values({
          organizationType: "congregation",
          name: "Fixture Congregation B for blob-store.test.ts",
          slug: `blob-store-test-b-${stamp}`,
          path: `blob_store_test_b_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      otherOrgId = other!.id;
    });

    afterAll(async () => {
      // ON DELETE CASCADE on blob_assets.organization_id takes every fixture
      // row with it. No `people`/`users` fixtures were created — blob_assets
      // carries no user FK.
      const platform = getPlatformDb();
      await platform.delete(organizations).where(eq(organizations.id, orgId));
      await platform
        .delete(organizations)
        .where(eq(organizations.id, otherOrgId));
    });

    it("dedup: storing the same bytes twice in the same org returns the same key and inserts no second row", async () => {
      const store = getBlobStore();
      const bytes = Buffer.from("dedup-fixture-bytes-not-a-real-image");

      const first = await store.store({
        organizationId: orgId,
        bytes,
        contentType: "image/png",
      });
      const second = await store.store({
        organizationId: orgId,
        bytes,
        contentType: "image/png",
      });

      expect(second.key).toBe(first.key);

      const platform = getPlatformDb();
      const rows = await platform
        .select({ id: blobAssets.id })
        .from(blobAssets)
        .where(eq(blobAssets.organizationId, orgId));
      expect(rows).toHaveLength(1);
    });

    it("resolve() returns null, not a throw, for an unknown key", async () => {
      const store = getBlobStore();
      const result = await store.resolve({
        organizationId: orgId,
        key: randomUUID(),
      });
      expect(result).toBeNull();
    });

    it("resolve() returns null for a real key read under the WRONG org (RLS isolation, not just a WHERE clause)", async () => {
      const store = getBlobStore();
      const ref = await store.store({
        organizationId: orgId,
        bytes: Buffer.from("cross-org-isolation-fixture"),
        contentType: "image/png",
      });

      const result = await store.resolve({
        organizationId: otherOrgId,
        key: ref.key,
      });
      expect(result).toBeNull();
    });

    it("store() rejects an oversized buffer at the application layer before ever reaching the database", async () => {
      const store = getBlobStore();
      const tooBig = Buffer.alloc(2_097_153, 1); // one byte past the 2MB cap

      await expect(
        store.store({
          organizationId: orgId,
          bytes: tooBig,
          contentType: "image/png",
        }),
      ).rejects.toThrow(BlobValidationError);
    });

    it("store() rejects a disallowed content type at the application layer before ever reaching the database", async () => {
      const store = getBlobStore();

      await expect(
        store.store({
          organizationId: orgId,
          bytes: Buffer.from("<svg></svg>"),
          contentType: "image/svg+xml",
        }),
      ).rejects.toThrow(BlobValidationError);
    });

    // The two tests below bypass store()'s own guard entirely and insert
    // through the same RLS-enforced connection directly, proving the DATABASE
    // constraint rejects the row on its own — not merely the TypeScript
    // validation in store(). This is the check the task explicitly asked for:
    // "test the DB constraint, not just app-level validation."
    //
    // drizzle-orm wraps the driver error; `.message` is a generic "Failed
    // query" summary, and the real Postgres error (with the constraint name)
    // is on `.cause`. Asserting on `.cause.constraint` is exact — a message
    // regex would also pass for a coincidentally-similar failure.
    function pgConstraintOf(error: unknown): string | undefined {
      const cause = (error as { cause?: unknown } | undefined)?.cause as
        | { constraint?: string }
        | undefined;
      return cause?.constraint;
    }

    it("the database rejects an oversized byte_size independent of store()'s app-level guard", async () => {
      let caught: unknown;
      try {
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`select set_config('app.current_org_id', ${orgId}, true)`,
          );
          await tx.insert(blobAssets).values({
            organizationId: orgId,
            contentHash: `oversize-${randomUUID()}`,
            contentType: "image/png",
            byteSize: 3_000_000, // the CHECK, not the actual buffer length
            bytes: Buffer.from("small"),
          });
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(pgConstraintOf(caught)).toBe("blob_assets_byte_size_bounds");
    });

    it("the database rejects a disallowed content_type independent of store()'s app-level guard", async () => {
      let caught: unknown;
      try {
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`select set_config('app.current_org_id', ${orgId}, true)`,
          );
          await tx.insert(blobAssets).values({
            organizationId: orgId,
            contentHash: `badtype-${randomUUID()}`,
            contentType: "image/svg+xml",
            byteSize: 5,
            bytes: Buffer.from("small"),
          });
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(pgConstraintOf(caught)).toBe("blob_assets_content_type_allowed");
    });
  },
);
