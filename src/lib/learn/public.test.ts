/**
 * T5a - the Learn anonymous reader (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3
 * Tests T5a). No database: `@/lib/db` is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { execute: (...args: unknown[]) => mockExecute(...args) } }));

import { SPOT_THE_SCAM_FEATURE_KEY } from "./contract";
import { mapPublicLearnRow, readPublicLearn } from "./public";

describe("mapPublicLearnRow", () => {
  it("exactly one row of a known state is the answer", () => {
    expect(mapPublicLearnRow([{ state: "available" }])).toEqual({ state: "available" });
    expect(mapPublicLearnRow([{ state: "unavailable" }])).toEqual({ state: "unavailable" });
  });

  it.each([
    ["no row", []],
    ["two rows", [{ state: "available" }, { state: "available" }]],
    ["an unknown state", [{ state: "open" }]],
    ["a wrong type", [{ state: true }]],
    ["a missing column", [{}]],
    ["a differently-cased state", [{ state: "Available" }]],
  ])("%s is failed, never an assumed answer", (_label, rows) => {
    expect(mapPublicLearnRow(rows as Array<Record<string, unknown>>)).toEqual({ state: "failed" });
  });
});

describe("readPublicLearn", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a string that is not slug-shaped is unavailable WITHOUT a query", async () => {
    for (const bad of ["", "Alder Creek", "a/b", "church.example.invalid", "x".repeat(300), "-bad", "UPPER"]) {
      expect(await readPublicLearn(bad, SPOT_THE_SCAM_FEATURE_KEY), bad).toEqual({ state: "unavailable" });
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("a key outside LEARN_PUBLIC_KEYS is unavailable WITHOUT a query (the type forbids it; a cast cannot get past the reader)", async () => {
    for (const bad of ["org_portal.giving", "org_portal.careers", "", "learn"]) {
      expect(await readPublicLearn("alder-creek", bad as never), bad).toEqual({ state: "unavailable" });
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("available and unavailable come straight from the one row (driver shapes: array and { rows })", async () => {
    mockExecute.mockResolvedValueOnce([{ state: "available" }]);
    expect(await readPublicLearn("alder-creek", SPOT_THE_SCAM_FEATURE_KEY)).toEqual({ state: "available" });
    mockExecute.mockResolvedValueOnce({ rows: [{ state: "unavailable" }] });
    expect(await readPublicLearn("alder-two", SPOT_THE_SCAM_FEATURE_KEY)).toEqual({ state: "unavailable" });
  });

  it("a malformed answer is failed", async () => {
    mockExecute.mockResolvedValueOnce([]);
    expect(await readPublicLearn("alder-three", SPOT_THE_SCAM_FEATURE_KEY)).toEqual({ state: "failed" });
  });

  it("a throw is failed, never thrown, and the log names the slug only (never the error, which embeds SQL and parameters)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecute.mockRejectedValueOnce(new Error("connection terminated: select * from presby_public_learn('alder-four')"));
    expect(await readPublicLearn("alder-four", SPOT_THE_SCAM_FEATURE_KEY)).toEqual({ state: "failed" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(["[public-learn] read failed", { slug: "alder-four" }]);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("connection terminated");
  });

  it("the executed SQL is `select * from presby_public_learn(slug, key)` with both as text parameters", async () => {
    mockExecute.mockResolvedValueOnce([{ state: "available" }]);
    await readPublicLearn("alder-five", SPOT_THE_SCAM_FEATURE_KEY);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const query = mockExecute.mock.calls[0]![0] as { queryChunks: unknown[] };
    const text = query.queryChunks
      .map((c) => (typeof c === "object" && c !== null && "value" in c ? (c as { value: string[] }).value.join("") : "?"))
      .join("");
    expect(text.replace(/\s+/g, " ")).toBe("select * from presby_public_learn(?::text, ?::text)");
    const params = query.queryChunks.filter((c) => typeof c === "string");
    expect(params).toEqual(["alder-five", SPOT_THE_SCAM_FEATURE_KEY]);
  });
});
