/**
 * BD-1..BD-5 - `findByContentHashes()` against REAL Postgres as `presby_app`
 * (site-ingest-size, DECISION-279; docs/work-log/2026-10-26-site-ingest-size.md,
 * Phase 3 "Test plan"). Needs drizzle/0072 applied (the audience column and
 * the `blob_assets_org_audience_hash_key` index).
 *
 *   BD-1  a held public_site hash is found; an unknown one is absent
 *   BD-2  a hash held only as `private` is absent for public_site and present
 *         for private (F298: the dedup key includes the audience)
 *   BD-3  identical bytes held by ANOTHER organization are absent
 *   BD-4  2,000 hashes in one call
 *   BD-5  the index that serves the lookup exists (a branch without 0072
 *         fails loudly instead of scanning)
 *
 * Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/storage/blob-store-find.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const PNG = (seed: string) =>
  Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(`find ${seed} ${randomUUID()}`)]);

describe.skipIf(!hasDb)("findByContentHashes (Postgres-backed, presby_app)", () => {
  let getBlobStore: typeof import("./blob-store").getBlobStore;
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let organizations: typeof import("@/lib/db/domain/org").organizations;

  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    ({ getBlobStore } = await import("./blob-store"));
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ organizations } = await import("@/lib/db/domain/org"));

    const platform = getPlatformDb();
    const stamp = Date.now();
    const make = async (label: string) => {
      const [row] = await platform
        .insert(organizations)
        .values({
          deletableUntil: fixtureDeletableUntil(),
          organizationType: "congregation",
          name: `Fixture Congregation ${label} for blob-store-find.db.test.ts`,
          slug: `blob-find-${label}-${stamp}`,
          path: `blob_find_${label}_${stamp}`,
          platformStatus: "unmanaged",
        })
        .returning({ id: organizations.id });
      return row!.id;
    };
    orgId = await make("a");
    otherOrgId = await make("b");
  }, 30_000);

  afterAll(async () => {
    const platform = getPlatformDb();
    for (const id of [orgId, otherOrgId]) {
      if (id) await platform.delete(organizations).where(eq(organizations.id, id));
    }
  });

  it("BD-1: a held public_site hash is found with its ref; an unknown hash is absent", async () => {
    const store = getBlobStore();
    const bytes = PNG("bd1");
    const ref = await store.store({ organizationId: orgId, bytes, contentType: "image/png", audience: "public_site" });
    const unknown = sha(Buffer.from(`never stored ${randomUUID()}`));

    const found = await store.findByContentHashes({
      organizationId: orgId,
      audience: "public_site",
      contentHashes: [sha(bytes), unknown],
    });

    expect([...found.keys()]).toEqual([sha(bytes)]);
    expect(found.get(sha(bytes))).toEqual({
      key: ref.key,
      contentType: "image/png",
      byteSize: bytes.byteLength,
      audience: "public_site",
    });
    expect(found.has(unknown)).toBe(false);
  });

  it("BD-2: a hash held only as private is absent for public_site and present for private", async () => {
    const store = getBlobStore();
    const bytes = PNG("bd2");
    const ref = await store.store({ organizationId: orgId, bytes, contentType: "image/png", audience: "private" });

    const asPublic = await store.findByContentHashes({
      organizationId: orgId,
      audience: "public_site",
      contentHashes: [sha(bytes)],
    });
    expect(asPublic.size).toBe(0);

    const asPrivate = await store.findByContentHashes({
      organizationId: orgId,
      audience: "private",
      contentHashes: [sha(bytes)],
    });
    expect(asPrivate.get(sha(bytes))?.key).toBe(ref.key);
    expect(asPrivate.get(sha(bytes))?.audience).toBe("private");
  });

  it("BD-3: identical bytes held by another organization are absent", async () => {
    const store = getBlobStore();
    const bytes = PNG("bd3");
    await store.store({ organizationId: otherOrgId, bytes, contentType: "image/png", audience: "public_site" });

    const mine = await store.findByContentHashes({
      organizationId: orgId,
      audience: "public_site",
      contentHashes: [sha(bytes)],
    });
    expect(mine.size).toBe(0);

    const theirs = await store.findByContentHashes({
      organizationId: otherOrgId,
      audience: "public_site",
      contentHashes: [sha(bytes)],
    });
    expect(theirs.size).toBe(1);
  });

  it("BD-4: 2,000 hashes in one call; the held ones are returned and the rest are absent", async () => {
    const store = getBlobStore();
    const held = PNG("bd4");
    await store.store({ organizationId: orgId, bytes: held, contentType: "image/png", audience: "public_site" });
    const hashes = [sha(held)];
    for (let i = 1; i < 2000; i++) hashes.push(sha(Buffer.from(`bd4 filler ${i} ${randomUUID()}`)));

    const found = await store.findByContentHashes({
      organizationId: orgId,
      audience: "public_site",
      contentHashes: hashes,
    });
    expect([...found.keys()]).toEqual([sha(held)]);
  });

  it("BD-5: the unique index that serves the lookup exists (organization_id, audience, content_hash)", async () => {
    const platform = getPlatformDb();
    const result = await platform.execute(
      sql`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'blob_assets' and indexname = 'blob_assets_org_audience_hash_key'`,
    );
    const rows = (result as unknown as { rows: Array<{ indexdef: string }> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/unique/i);
    expect(rows[0]!.indexdef).toMatch(/\(organization_id, audience, content_hash\)/);
  });
});
