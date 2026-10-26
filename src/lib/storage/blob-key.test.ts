/**
 * U1 - parseBlobKey(): the one uuid-shape gate in front of every public asset
 * read (F289, DECISION-277; docs/work-log/2026-10-25-public-asset-allowlist.md,
 * Phase 3 "Uuid key validator").
 *
 * A malformed key must never reach Postgres (a cast error is a free log-noise
 * lever for a prober), and a case variant of a uuid must collapse onto the one
 * canonical lowercase form so there is no second answer path.
 */
import { describe, it, expect } from "vitest";
import { parseBlobKey } from "./blob-key";

const CANON = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("parseBlobKey", () => {
  it("returns a canonical lowercase uuid unchanged", () => {
    expect(parseBlobKey(CANON)).toBe(CANON);
  });

  it("lowercases an uppercase uuid: a case variant gets the canonical key", () => {
    expect(parseBlobKey(CANON.toUpperCase())).toBe(CANON);
    expect(parseBlobKey("0F8fAD5b-D9CB-469f-A165-70867728950E")).toBe(CANON);
  });

  it("accepts the nil uuid and any hex version/variant digit (fixtures use e2e93001-0000-4000-8000-...)", () => {
    expect(parseBlobKey("00000000-0000-0000-0000-000000000000")).toBe("00000000-0000-0000-0000-000000000000");
    expect(parseBlobKey("e2e93001-0000-4000-8000-000000000001")).toBe("e2e93001-0000-4000-8000-000000000001");
    expect(parseBlobKey("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe("ffffffff-ffff-ffff-ffff-ffffffffffff");
  });

  it.each([
    ["35 characters", CANON.slice(0, -1)],
    ["37 characters", `${CANON}0`],
    ["no hyphens", CANON.replaceAll("-", "")],
    ["braces", `{${CANON}}`],
    ["urn:uuid: prefix", `urn:uuid:${CANON}`],
    ["a leading space", ` ${CANON}`],
    ["a trailing space", `${CANON} `],
    ["a trailing newline", `${CANON}\n`],
    ["a leading newline", `\n${CANON}`],
    ["empty", ""],
    ["a path traversal", "../../etc/passwd"],
    ["a percent-encoded uuid", CANON.replaceAll("-", "%2d")],
    ["a non-hex digit", CANON.replace("0f8f", "0g8f")],
    ["non-ASCII digits (Arabic-Indic)", CANON.replace("70867728950e", "٠١٢٣٤٥٦٧٨٩٠e")],
    ["full-width hex digits", CANON.replace("0f8f", "０ｆ８ｆ")],
    ["a hyphen in the wrong place", "0f8fad5bd-9cb-469f-a165-70867728950e"],
    ["not-a-uuid", "not-a-uuid"],
  ])("rejects %s", (_label, raw) => {
    expect(parseBlobKey(raw)).toBeNull();
  });
});
