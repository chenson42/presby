/**
 * U2 - `resolvePublic()`: the adapter half of the public asset door (F289,
 * DECISION-277; docs/work-log/2026-10-25-public-asset-allowlist.md, Phase 3
 * "Adapter").
 *
 * No database: `@/lib/db` is mocked. What this pins is the TypeScript side of
 * the contract - the key is validated BEFORE any read, the definer is called
 * with the canonical key and nothing else, the row is mapped to a Buffer, the
 * second independent type/class check holds, and a driver error propagates
 * (the route owns the catch, like `resolve()`). The database half (the
 * definer's own predicate) is public-asset.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const execute = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { execute: (...args: unknown[]) => execute(...args), transaction: vi.fn() },
}));

// The table object is only used by store()/resolve(), which this file never calls;
// importing the real schema module without the real `@/lib/db` trips a circular import.
vi.mock("@/lib/db/domain/assets", () => ({ blobAssets: {} }));

import { getBlobStore } from "./blob-store";

const ORG = "11111111-1111-4111-8111-111111111111";
const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(() => {
  execute.mockReset();
});

/** The single bound parameter list of the one `db.execute(sql...)` call. */
function boundParams(): unknown[] {
  const query = execute.mock.calls[0]![0] as { queryChunks: unknown[] };
  return query.queryChunks.filter((c) => !(typeof c === "object" && c !== null && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)));
}

function sqlText(): string {
  const query = execute.mock.calls[0]![0] as { queryChunks: Array<{ value?: string[] }> };
  return query.queryChunks.flatMap((c) => c.value ?? []).join("?");
}

describe("getBlobStore().resolvePublic()", () => {
  it("returns null for a malformed key WITHOUT querying", async () => {
    for (const bad of ["not-a-uuid", "", `${KEY}\n`, "../../etc/passwd", KEY.slice(1)]) {
      expect(await getBlobStore().resolvePublic({ organizationId: ORG, key: bad })).toBeNull();
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("calls the definer once, with the organization id and the CANONICAL (lowercase) key", async () => {
    execute.mockResolvedValue({ rows: [] });
    await getBlobStore().resolvePublic({ organizationId: ORG, key: KEY.toUpperCase() });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(sqlText()).toContain("presby_public_site_asset(");
    expect(boundParams()).toEqual([ORG, KEY]);
  });

  it("maps a row to { bytes: Buffer, contentType, cacheClass }", async () => {
    execute.mockResolvedValue({
      rows: [{ content_type: "image/png", bytes: Buffer.from("png-bytes"), cache_class: "site" }],
    });
    const out = await getBlobStore().resolvePublic({ organizationId: ORG, key: KEY });

    expect(out).not.toBeNull();
    expect(Buffer.isBuffer(out!.bytes)).toBe(true);
    expect(out!.bytes.toString()).toBe("png-bytes");
    expect(out!.contentType).toBe("image/png");
    expect(out!.cacheClass).toBe("site");
  });

  it("turns a Uint8Array from the driver into a Buffer", async () => {
    execute.mockResolvedValue({
      rows: [{ content_type: "image/webp", bytes: new Uint8Array([1, 2, 3]), cache_class: "roster" }],
    });
    const out = await getBlobStore().resolvePublic({ organizationId: ORG, key: KEY });

    expect(Buffer.isBuffer(out!.bytes)).toBe(true);
    expect([...out!.bytes]).toEqual([1, 2, 3]);
    expect(out!.cacheClass).toBe("roster");
  });

  it.each([
    ["application/pdf", "site"],
    ["application/json", "site"],
    ["image/svg+xml", "site"],
    ["image/gif", "roster"],
    ["", "site"],
  ])("returns null when the row's content type is %s (the second, independent type check)", async (contentType, cacheClass) => {
    execute.mockResolvedValue({ rows: [{ content_type: contentType, bytes: Buffer.from("x"), cache_class: cacheClass }] });
    expect(await getBlobStore().resolvePublic({ organizationId: ORG, key: KEY })).toBeNull();
  });

  it.each(["", "private", "SITE", "public_site", null, undefined])(
    "returns null when the row's cache_class is %j (an unknown class is never served)",
    async (cacheClass) => {
      execute.mockResolvedValue({ rows: [{ content_type: "image/png", bytes: Buffer.from("x"), cache_class: cacheClass }] });
      expect(await getBlobStore().resolvePublic({ organizationId: ORG, key: KEY })).toBeNull();
    },
  );

  it("returns null for zero rows", async () => {
    execute.mockResolvedValue({ rows: [] });
    expect(await getBlobStore().resolvePublic({ organizationId: ORG, key: KEY })).toBeNull();
    execute.mockResolvedValue({});
    expect(await getBlobStore().resolvePublic({ organizationId: ORG, key: KEY })).toBeNull();
  });

  it("does NOT swallow a driver error: the route owns the catch", async () => {
    execute.mockRejectedValue(new Error("simulated DB blip"));
    await expect(getBlobStore().resolvePublic({ organizationId: ORG, key: KEY })).rejects.toThrow("simulated DB blip");
  });
});
