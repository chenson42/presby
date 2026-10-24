/**
 * Regression for GHSA-mrhx-c7xc-m3w5, "Zod can exhaust memory while validating
 * oversized constrained collections" (docs/work-log/2026-10-23-zod-4.md, Phase 2
 * Ruling 1, Phase 3 "Tests" 3) — regression for the zod 3 array memory advisory.
 *
 * zod 3 adds the `too_big` issue for an oversized array and then parses every
 * element anyway; zod >= 4.6.7 stops early on a size check that comes BEFORE
 * every other check. `revokeHolderFieldsSchema.expectedGrantIds` is the one
 * server-side array and has exactly that shape: `.min(1).max(20)` and nothing
 * ahead of them.
 *
 * Size checks first: a `.refine()` placed ahead of `.max()` on a collection
 * switches the early stop off. The 100,000-element case below is the proof, on
 * the real schema, that it is still on. This fails on zod 3 and passes on 4.6.7.
 */
import { describe, expect, it } from "vitest";
import { revokeHolderFieldsSchema } from "./designation-holder-copy";

const ORG = "d9100000-0000-0000-0000-000000000010";
const PERSON = "00000000-0000-0000-0000-000000000005";

// Distinct ids: the action de-duplicates, so the test must not rely on repeats.
const grantIds = (n: number, valid: boolean): string[] =>
  Array.from({ length: n }, (_, i) =>
    valid ? `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}` : `not-a-grant-id-${i}`,
  );

const input = (expectedGrantIds: string[]) => ({
  organizationId: ORG,
  slot: "founding_administrator",
  subjectKind: "person",
  subjectId: PERSON,
  expectedGrantIds,
});

const summary = (result: ReturnType<typeof revokeHolderFieldsSchema.safeParse>) =>
  result.success ? [] : result.error.issues.map((i) => [i.code, i.path.join(".")]);

describe("revokeHolderFieldsSchema: oversized expectedGrantIds (GHSA-mrhx-c7xc-m3w5)", () => {
  it("returns exactly one too_big issue for 100,000 distinct invalid ids, well inside the time budget", () => {
    const oversized = grantIds(100_000, false);
    const started = performance.now();
    const result = revokeHolderFieldsSchema.safeParse(input(oversized));
    const elapsed = performance.now() - started;
    expect(result.success).toBe(false);
    expect(summary(result)).toEqual([["too_big", "expectedGrantIds"]]);
    expect(elapsed).toBeLessThan(2000);
  });

  it("also stops early for 100,000 valid ids", () => {
    const result = revokeHolderFieldsSchema.safeParse(input(grantIds(100_000, true)));
    expect(summary(result)).toEqual([["too_big", "expectedGrantIds"]]);
  });

  it("returns exactly one too_small issue for an empty list", () => {
    expect(summary(revokeHolderFieldsSchema.safeParse(input([])))).toEqual([["too_small", "expectedGrantIds"]]);
  });

  it("passes 20 valid ids and returns exactly one too_big for 21", () => {
    expect(revokeHolderFieldsSchema.safeParse(input(grantIds(20, true))).success).toBe(true);
    expect(summary(revokeHolderFieldsSchema.safeParse(input(grantIds(21, true))))).toEqual([
      ["too_big", "expectedGrantIds"],
    ]);
  });
});
