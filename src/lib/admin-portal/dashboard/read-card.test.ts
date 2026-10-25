import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readCard, rowsOf, toCount } from "./read-card";

afterEach(() => vi.restoreAllMocks());

describe("readCard", () => {
  it("returns the read's fields beside kind: ok", async () => {
    expect(await readCard("x", async () => ({ n: 3 }))).toEqual({ kind: "ok", n: 3 });
  });

  it("catches a failure and returns kind: error, with no count on it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await readCard("x", async () => {
      throw new Error("boom");
    });
    expect(result).toEqual({ kind: "error" });
  });

  it("logs the error class only, never the message (E6)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await readCard("tickets", async () => {
      throw new Error("select * from tickets where secret = 'sql text'");
    });
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("[admin-dashboard] tickets failed: Error");
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("sql text");
  });

  it("includes a database error code when the error has one, and never an unsafe one", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await readCard("a", async () => {
      throw Object.assign(new Error("relation does not exist"), { name: "DatabaseError", code: "42P01" });
    });
    await readCard("b", async () => {
      throw Object.assign(new Error("m"), { code: "not safe: select 1" });
    });
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines[0]).toBe("[admin-dashboard] a failed: DatabaseError/42P01");
    expect(lines[1]).toBe("[admin-dashboard] b failed: Error");
  });

  it("copes with a thrown non-error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readCard("x", async () => Promise.reject("a string with secrets"))).toEqual({ kind: "error" });
    expect(String(spy.mock.calls[0]![0])).toBe("[admin-dashboard] x failed: unknown");
  });
});

describe("rowsOf and toCount", () => {
  it("reads rows from a result object or a bare array", () => {
    expect(rowsOf({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(rowsOf(null)).toEqual([]);
  });

  it("normalizes counts: bigint strings, junk and negatives", () => {
    expect(toCount("12")).toBe(12);
    expect(toCount(3.9)).toBe(3);
    expect(toCount(undefined)).toBe(0);
    expect(toCount(null)).toBe(0);
    expect(toCount("abc")).toBe(0);
    expect(toCount(-4)).toBe(0);
  });
});
