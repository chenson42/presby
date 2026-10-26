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
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

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
          // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
          deletableUntil: fixtureDeletableUntil(),
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
          // Fixture teardown window — drizzle/0044's BEFORE DELETE guard.
          deletableUntil: fixtureDeletableUntil(),
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
        audience: "private",
      });
      const second = await store.store({
        organizationId: orgId,
        bytes,
        contentType: "image/png",
        audience: "private",
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
        audience: "private",
      });
      expect(result).toBeNull();
    });

    it("resolve() returns null for a real key read under the WRONG org (RLS isolation, not just a WHERE clause)", async () => {
      const store = getBlobStore();
      const ref = await store.store({
        organizationId: orgId,
        bytes: Buffer.from("cross-org-isolation-fixture"),
        contentType: "image/png",
        audience: "private",
      });

      const result = await store.resolve({
        organizationId: otherOrgId,
        key: ref.key,
        audience: "private",
      });
      expect(result).toBeNull();
    });

    it("store() rejects an oversized buffer at the application layer before ever reaching the database", async () => {
      const store = getBlobStore();
      const tooBig = Buffer.alloc(10_485_761, 1); // one byte past the 10MB cap (DECISION-071/073)

      await expect(
        store.store({
          organizationId: orgId,
          bytes: tooBig,
          contentType: "image/png",
          audience: "private",
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
          audience: "private",
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
            byteSize: 10_485_761, // one byte past the CHECK's 10MB bound (DECISION-071/073); not the actual buffer length
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

    // ---------------------------------------------------------------------
    // D2, adapter half (F289, DECISION-277; docs/work-log/
    // 2026-10-25-public-asset-allowlist.md Phase 3 "Test Plan" D2). The
    // database half (constraints, immutability, FKs) is blob-audience.db.test.ts.
    // ---------------------------------------------------------------------
    describe("audience (F289)", () => {
      const png = (seed: string) =>
        Buffer.concat([
          Buffer.from("89504e470d0a1a0a", "hex"),
          Buffer.from(`f289 adapter ${seed} ${randomUUID()}`),
        ]);

      it("store() returns the audience it stored under", async () => {
        const store = getBlobStore();
        const pub = await store.store({ organizationId: orgId, bytes: png("ref-pub"), contentType: "image/png", audience: "public_site" });
        const priv = await store.store({ organizationId: orgId, bytes: png("ref-priv"), contentType: "image/png", audience: "private" });
        expect(pub.audience).toBe("public_site");
        expect(priv.audience).toBe("private");
      });

      it("identical bytes under the two audiences are TWO rows and two keys (F298); the same pair dedups to one key", async () => {
        const store = getBlobStore();
        const bytes = png("twin");
        const pub = await store.store({ organizationId: orgId, bytes, contentType: "image/png", audience: "public_site" });
        const priv = await store.store({ organizationId: orgId, bytes, contentType: "image/png", audience: "private" });
        expect(priv.key).not.toBe(pub.key);

        const pubAgain = await store.store({ organizationId: orgId, bytes, contentType: "image/png", audience: "public_site" });
        const privAgain = await store.store({ organizationId: orgId, bytes, contentType: "image/png", audience: "private" });
        expect(pubAgain.key).toBe(pub.key);
        expect(privAgain.key).toBe(priv.key);

        const rows = await getPlatformDb()
          .select({ id: blobAssets.id, audience: blobAssets.audience })
          .from(blobAssets)
          .where(sql`${blobAssets.organizationId} = ${orgId} and ${blobAssets.contentHash} = ${createHash("sha256").update(bytes).digest("hex")}`);
        expect(rows.map((r) => r.audience).sort()).toEqual(["private", "public_site"]);
      });

      it("resolve() and resolveMeta() match ONLY the audience the caller names, in both directions", async () => {
        const store = getBlobStore();
        const pub = await store.store({ organizationId: orgId, bytes: png("res-pub"), contentType: "image/png", audience: "public_site" });
        const priv = await store.store({ organizationId: orgId, bytes: png("res-priv"), contentType: "image/png", audience: "private" });

        // Right audience: found.
        expect((await store.resolve({ organizationId: orgId, key: pub.key, audience: "public_site" }))?.contentType).toBe("image/png");
        expect((await store.resolve({ organizationId: orgId, key: priv.key, audience: "private" }))?.contentType).toBe("image/png");
        expect((await store.resolveMeta({ organizationId: orgId, key: pub.key, audience: "public_site" }))?.contentType).toBe("image/png");
        expect((await store.resolveMeta({ organizationId: orgId, key: priv.key, audience: "private" }))?.contentType).toBe("image/png");

        // Wrong audience: null. A private caller never reads a public_site row, and the reverse.
        expect(await store.resolve({ organizationId: orgId, key: pub.key, audience: "private" })).toBeNull();
        expect(await store.resolve({ organizationId: orgId, key: priv.key, audience: "public_site" })).toBeNull();
        expect(await store.resolveMeta({ organizationId: orgId, key: pub.key, audience: "private" })).toBeNull();
        expect(await store.resolveMeta({ organizationId: orgId, key: priv.key, audience: "public_site" })).toBeNull();
      });

      it.each([
        ["application/pdf", "%PDF-1.7 f289"],
        ["application/json", '{"f289":true}'],
      ])("store(public_site, %s) throws BlobValidationError before the CHECK would, and writes nothing", async (contentType, body) => {
        const store = getBlobStore();
        const bytes = Buffer.from(`${body} ${randomUUID()}`);
        let caught: unknown;
        try {
          await store.store({ organizationId: orgId, bytes, contentType, audience: "public_site" });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(BlobValidationError);
        expect((caught as Error).message).toBe(
          `blob-store: audience "public_site" requires an image content type (png, jpeg or webp); got "${contentType}"`,
        );
        const rows = await getPlatformDb()
          .select({ id: blobAssets.id })
          .from(blobAssets)
          .where(sql`${blobAssets.organizationId} = ${orgId} and ${blobAssets.contentHash} = ${createHash("sha256").update(bytes).digest("hex")}`);
        expect(rows).toHaveLength(0);
      });

      it("a PDF and a JSON bundle are fine as private", async () => {
        const store = getBlobStore();
        const pdf = await store.store({ organizationId: orgId, bytes: Buffer.from(`%PDF-1.7 f289 ${randomUUID()}`), contentType: "application/pdf", audience: "private" });
        const json = await store.store({ organizationId: orgId, bytes: Buffer.from(`{"f289":"${randomUUID()}"}`), contentType: "application/json", audience: "private" });
        expect(pdf.audience).toBe("private");
        expect(json.audience).toBe("private");
      });

      it("an audience outside the vocabulary cannot be stored (the type forbids it; a cast gets as far as the database CHECK)", async () => {
        const store = getBlobStore();
        let caught: unknown;
        try {
          await store.store({ organizationId: orgId, bytes: png("vocab"), contentType: "image/png", audience: "other" as never });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeDefined();
        expect(pgConstraintOf(caught)).toBe("blob_assets_audience_allowed");
      });
    });
  },
);
