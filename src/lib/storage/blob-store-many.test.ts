/**
 * U5 - `resolveMany()`: the adapter half of the directory's thumbnail read (F332;
 * docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 "Blob adapter
 * additions"). No database: `@/lib/db` is mocked. What this pins is the
 * TypeScript contract - one transaction and one statement however many keys,
 * keys validated and de-duplicated before any read, a cap of 100 distinct keys,
 * missing keys absent from the map, the audience and organization carried into
 * the query, and a driver error propagating to the caller.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const select = vi.fn();
const execute = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { transaction: (fn: (tx: unknown) => unknown) => transaction(fn), execute: vi.fn() },
}));

// A real (tiny) drizzle table so `inArray`/`eq` can build conditions; the adapter's
// own table object would pull in the real `@/lib/db`.
vi.mock("@/lib/db/domain/assets", async () => {
  const { pgTable, uuid, text, customType } = await import("drizzle-orm/pg-core");
  const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
  return {
    blobAssets: pgTable("blob_assets", {
      id: uuid("id"),
      organizationId: uuid("organization_id"),
      contentHash: text("content_hash"),
      contentType: text("content_type"),
      byteSize: text("byte_size"),
      audience: text("audience"),
      bytes: bytea("bytes"),
    }),
  };
});

import { BlobValidationError, getBlobStore, RESOLVE_MANY_MAX } from "./blob-store";

const ORG = "11111111-1111-4111-8111-111111111111";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let whereArg: unknown;
/** The predicate as Postgres would receive it: the SQL text and its bound parameters. */
const rendered = () => new PgDialect().sqlToQuery(whereArg as SQL);
function primeRows(rows: Array<{ id: string; bytes: Buffer; contentType: string }>) {
  select.mockImplementation(() => ({
    from: () => ({
      where: (cond: unknown) => {
        whereArg = cond;
        return Promise.resolve(rows);
      },
    }),
  }));
}

beforeEach(() => {
  select.mockReset();
  execute.mockReset();
  transaction.mockReset();
  whereArg = undefined;
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ select, execute }));
});

describe("getBlobStore().resolveMany()", () => {
  it("reads many keys in ONE transaction and ONE select, and returns a map keyed by id", async () => {
    primeRows([
      { id: uuid(1), bytes: Buffer.from("a"), contentType: "image/webp" },
      { id: uuid(2), bytes: Buffer.from("b"), contentType: "image/webp" },
    ]);
    const out = await getBlobStore().resolveMany({ organizationId: ORG, keys: [uuid(1), uuid(2), uuid(3)], audience: "private" });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect([...out.keys()].sort()).toEqual([uuid(1), uuid(2)]);
    expect(out.get(uuid(1))).toEqual({ bytes: Buffer.from("a"), contentType: "image/webp" });
  });

  it("sets the organization context in the same transaction (set_config), as resolve() does", async () => {
    primeRows([]);
    await getBlobStore().resolveMany({ organizationId: ORG, keys: [uuid(1)], audience: "private" });
    expect(execute).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(execute.mock.calls[0]![0]);
    expect(text).toContain("set_config");
    expect(text).toContain(ORG);
  });

  it("a key that is absent from the table is simply absent from the map", async () => {
    primeRows([]);
    const out = await getBlobStore().resolveMany({ organizationId: ORG, keys: [uuid(9)], audience: "private" });
    expect(out.size).toBe(0);
  });

  it("an empty list, or a list of only malformed keys, runs NO query and no transaction", async () => {
    expect((await getBlobStore().resolveMany({ organizationId: ORG, keys: [], audience: "private" })).size).toBe(0);
    expect(
      (await getBlobStore().resolveMany({ organizationId: ORG, keys: ["nope", "", `${uuid(1)}\n`, "../x"], audience: "private" })).size,
    ).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("validates and canonicalises keys: a malformed key never reaches the query, an upper-case uuid is queried lower-case, duplicates collapse", async () => {
    primeRows([]);
    await getBlobStore().resolveMany({
      organizationId: ORG,
      keys: ["not-a-uuid", uuid(1).toUpperCase(), uuid(1), uuid(1)],
      audience: "private",
    });
    const { params } = rendered();
    expect(params).toContain(uuid(1)); // lower-cased
    expect(params).not.toContain("not-a-uuid");
    expect(params.filter((p) => p === uuid(1))).toHaveLength(1);
  });

  it("carries the audience and the organization into the predicate", async () => {
    primeRows([]);
    await getBlobStore().resolveMany({ organizationId: ORG, keys: [uuid(1)], audience: "public_site" });
    const { sql, params } = rendered();
    expect(params).toContain("public_site");
    expect(params).toContain(ORG);
    expect(sql).toMatch(/"id" in \(/);
    expect(sql).toContain('"organization_id" = $');
    expect(sql).toContain('"audience" = $');
  });

  it(`accepts exactly ${RESOLVE_MANY_MAX} distinct keys and throws BlobValidationError for one more`, async () => {
    primeRows([]);
    const hundred = Array.from({ length: RESOLVE_MANY_MAX }, (_, i) => uuid(i + 1));
    await expect(getBlobStore().resolveMany({ organizationId: ORG, keys: hundred, audience: "private" })).resolves.toBeInstanceOf(Map);
    await expect(
      getBlobStore().resolveMany({ organizationId: ORG, keys: [...hundred, uuid(500)], audience: "private" }),
    ).rejects.toBeInstanceOf(BlobValidationError);
  });

  it("the cap counts DISTINCT keys: 150 repeats of one key is fine", async () => {
    primeRows([]);
    const keys = Array.from({ length: 150 }, () => uuid(1));
    await expect(getBlobStore().resolveMany({ organizationId: ORG, keys, audience: "private" })).resolves.toBeInstanceOf(Map);
  });

  it("a driver error propagates (the caller decides)", async () => {
    select.mockImplementation(() => ({ from: () => ({ where: () => Promise.reject(new Error("connection reset")) }) }));
    await expect(getBlobStore().resolveMany({ organizationId: ORG, keys: [uuid(1)], audience: "private" })).rejects.toThrow("connection reset");
  });
});
