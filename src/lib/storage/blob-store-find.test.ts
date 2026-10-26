/**
 * BS-1..BS-4 - `findByContentHashes()`, the adapter half of the site-ingest
 * "which of these hashes does this organization already hold" lookup
 * (site-ingest-size, DECISION-279; docs/work-log/2026-10-26-site-ingest-size.md,
 * Phase 3 "Test plan").
 *
 * No database: `@/lib/db` is mocked, and drizzle's `eq`/`and`/`inArray` are
 * replaced by tagged records so the WHERE clause can be read back. What this
 * pins is the TypeScript contract: the select never projects `bytes`, the
 * filter is exactly (organization, audience, hash list), a malformed or
 * over-long list is refused before any query, and rows come back as a Map
 * keyed by the lowercase hash. The database half (the real index, RLS,
 * another organization's identical bytes) is blob-store-find.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Captured = {
  projection: Record<string, unknown> | null;
  where: unknown;
  gucOrg: unknown;
};
const captured: Captured = { projection: null, where: null, gucOrg: null };
let rowsToReturn: Array<Record<string, unknown>> = [];
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { transaction: (...args: unknown[]) => transaction(...args), execute: vi.fn() },
}));

// A fake table whose columns are sentinels the tagged operators can name.
vi.mock("@/lib/db/domain/assets", () => ({
  blobAssets: {
    id: { col: "id" },
    organizationId: { col: "organization_id" },
    audience: { col: "audience" },
    contentHash: { col: "content_hash" },
    contentType: { col: "content_type" },
    byteSize: { col: "byte_size" },
    bytes: { col: "bytes" },
  },
}));

vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...parts: unknown[]) => ({ op: "and", parts }),
  inArray: (col: unknown, val: unknown) => ({ op: "inArray", col, val }),
}));

import { getBlobStore, BlobValidationError } from "./blob-store";

const ORG = "11111111-1111-4111-8111-111111111111";
const hash = (n: number) => n.toString(16).padStart(64, "0");

beforeEach(() => {
  captured.projection = null;
  captured.where = null;
  captured.gucOrg = null;
  rowsToReturn = [];
  transaction.mockReset();
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(async (q: { queryChunks?: unknown[] }) => {
        captured.gucOrg = q.queryChunks;
      }),
      select: (projection: Record<string, unknown>) => {
        captured.projection = projection;
        return {
          from: () => ({
            where: (w: unknown) => {
              captured.where = w;
              return Promise.resolve(rowsToReturn);
            },
          }),
        };
      },
    };
    return fn(tx);
  });
});

describe("getBlobStore().findByContentHashes()", () => {
  it("BS-1: the select projection has no bytes column", async () => {
    await getBlobStore().findByContentHashes({
      organizationId: ORG,
      audience: "public_site",
      contentHashes: [hash(1)],
    });
    expect(captured.projection).not.toBeNull();
    expect(Object.keys(captured.projection!)).not.toContain("bytes");
    expect(Object.values(captured.projection!).map((c) => (c as { col: string }).col)).not.toContain("bytes");
    expect(Object.keys(captured.projection!).sort()).toEqual(["byteSize", "contentHash", "contentType", "id"]);
  });

  it("BS-2: the filter is organization_id, audience and the hash list - and it runs under the trusted org context", async () => {
    await getBlobStore().findByContentHashes({
      organizationId: ORG,
      audience: "public_site",
      contentHashes: [hash(1), hash(2)],
    });
    const where = captured.where as { op: string; parts: Array<{ op: string; col: { col: string }; val: unknown }> };
    expect(where.op).toBe("and");
    const byCol = Object.fromEntries(where.parts.map((p) => [p.col.col, p]));
    expect(byCol.organization_id).toMatchObject({ op: "eq", val: ORG });
    expect(byCol.audience).toMatchObject({ op: "eq", val: "public_site" });
    expect(byCol.content_hash).toMatchObject({ op: "inArray", val: [hash(1), hash(2)] });
    expect(where.parts).toHaveLength(3);
    // the org GUC was set in the same transaction
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(captured.gucOrg)).toContain("app.current_org_id");
  });

  it("BS-2: the audience the caller names is the audience queried (private is not public_site)", async () => {
    await getBlobStore().findByContentHashes({
      organizationId: ORG,
      audience: "private",
      contentHashes: [hash(1)],
    });
    const where = captured.where as { parts: Array<{ col: { col: string }; val: unknown }> };
    expect(where.parts.find((p) => p.col.col === "audience")?.val).toBe("private");
  });

  it("BS-3: an empty list is refused before any query", async () => {
    await expect(
      getBlobStore().findByContentHashes({ organizationId: ORG, audience: "public_site", contentHashes: [] }),
    ).rejects.toBeInstanceOf(BlobValidationError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["short", "ab".repeat(31)],
    ["long", "ab".repeat(33)],
    ["non-hex", "g".repeat(64)],
    ["with trailing whitespace", `${"a".repeat(63)} `],
    ["with a newline suffix", `${"a".repeat(64)}\n`],
    ["empty", ""],
  ])("BS-3: a %s hash is refused before any query", async (_name, bad) => {
    await expect(
      getBlobStore().findByContentHashes({ organizationId: ORG, audience: "public_site", contentHashes: [hash(1), bad] }),
    ).rejects.toBeInstanceOf(BlobValidationError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("BS-3: an uppercase hash is refused (lowercase only)", async () => {
    await expect(
      getBlobStore().findByContentHashes({ organizationId: ORG, audience: "public_site", contentHashes: ["A".repeat(64)] }),
    ).rejects.toBeInstanceOf(BlobValidationError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("BS-3: a duplicate in the list is refused before any query", async () => {
    await expect(
      getBlobStore().findByContentHashes({ organizationId: ORG, audience: "public_site", contentHashes: [hash(1), hash(2), hash(1)] }),
    ).rejects.toBeInstanceOf(BlobValidationError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("BS-3: 2,000 hashes are accepted and 2,001 are refused", async () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => hash(i + 1));
    await expect(
      getBlobStore().findByContentHashes({ organizationId: ORG, audience: "public_site", contentHashes: make(2000) }),
    ).resolves.toBeInstanceOf(Map);
    expect(transaction).toHaveBeenCalledTimes(1);

    transaction.mockClear();
    await expect(
      getBlobStore().findByContentHashes({ organizationId: ORG, audience: "public_site", contentHashes: make(2001) }),
    ).rejects.toBeInstanceOf(BlobValidationError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("BS-4: rows come back as a Map keyed by the lowercase hash, each value a BlobRef carrying the requested audience", async () => {
    rowsToReturn = [
      { id: "a1111111-1111-4111-8111-111111111111", contentHash: hash(1), contentType: "image/png", byteSize: 12 },
      { id: "b2222222-2222-4222-8222-222222222222", contentHash: hash(3), contentType: "image/jpeg", byteSize: 99 },
    ];
    const out = await getBlobStore().findByContentHashes({
      organizationId: ORG,
      audience: "public_site",
      contentHashes: [hash(1), hash(2), hash(3)],
    });
    expect(out).toBeInstanceOf(Map);
    expect([...out.keys()]).toEqual([hash(1), hash(3)]);
    expect(out.has(hash(2))).toBe(false);
    expect(out.get(hash(1))).toEqual({
      key: "a1111111-1111-4111-8111-111111111111",
      contentType: "image/png",
      byteSize: 12,
      audience: "public_site",
    });
    expect(out.get(hash(3))?.contentType).toBe("image/jpeg");
  });
});
