/**
 * Characterization tests for the reason schema's issue behavior and the revoke
 * action's field schema, written on zod 3.25.76 before the zod 4 upgrade
 * (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests" 1 and 2). It adds only
 * what `designation-holder-copy.test.ts` does not already pin; that file is
 * not edited. The revoke action turns any failure of `revokeHolderFieldsSchema`
 * into the fixed "Invalid request." string (no zod text reaches a user), so
 * only failure, path and issue code are pinned for it.
 */
import { describe, expect, it } from "vitest";
import {
  OUTCOME_COPY,
  REASON_COPY,
  parseReason,
  reasonSchema,
  revokeHolderFieldsSchema,
} from "./designation-holder-copy";

const NON_RFC_ROLE_ID = "00000000-0000-0000-0000-000000000005";
const NON_RFC_FIXTURE_ID = "d9100000-0000-0000-0000-000000000010";

describe("reasonSchema issues", () => {
  it("reports exactly one issue per failure, first message the one shown", () => {
    for (const [value, message] of [
      ["too short", REASON_COPY.short],
      ["x".repeat(501), REASON_COPY.long],
      ["has a bell \u0007 inside it", REASON_COPY.control],
    ] as const) {
      const result = reasonSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message)).toEqual([message]);
        expect(result.error.issues[0]?.path).toEqual([]);
      }
    }
  });

  it("reports the control-character message first when the reason is also too short", () => {
    expect(parseReason("\u0007")).toEqual({ ok: false, message: REASON_COPY.control });
  });

  it("counts the trimmed length: padding does not rescue a short reason", () => {
    expect(parseReason("         ab         ")).toEqual({ ok: false, message: REASON_COPY.short });
  });

  it("accepts exactly 10 emoji", () => {
    expect(parseReason("\u{1F600}".repeat(10))).toEqual({ ok: true, reason: "\u{1F600}".repeat(10) });
  });

  it("returns the fixed invalid copy untouched", () => {
    expect(OUTCOME_COPY.invalid).toBe("Invalid request.");
  });
});

describe("revokeHolderFieldsSchema", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`);
  const valid = {
    organizationId: NON_RFC_FIXTURE_ID,
    slot: "founding_administrator",
    subjectKind: "person",
    subjectId: NON_RFC_ROLE_ID,
    expectedGrantIds: [NON_RFC_ROLE_ID],
  };

  it("returns a valid value unchanged (ids are shape-checked, not RFC-checked)", () => {
    expect(revokeHolderFieldsSchema.parse(valid)).toEqual(valid);
    expect(revokeHolderFieldsSchema.parse({ ...valid, slot: "treasurer", subjectKind: "group" })).toMatchObject({
      slot: "treasurer",
      subjectKind: "group",
    });
  });

  it("accepts one to twenty grant ids and rejects none or twenty-one", () => {
    expect(revokeHolderFieldsSchema.safeParse({ ...valid, expectedGrantIds: ids(1) }).success).toBe(true);
    expect(revokeHolderFieldsSchema.safeParse({ ...valid, expectedGrantIds: ids(20) }).success).toBe(true);
    const none = revokeHolderFieldsSchema.safeParse({ ...valid, expectedGrantIds: [] });
    const many = revokeHolderFieldsSchema.safeParse({ ...valid, expectedGrantIds: ids(21) });
    expect(none.success).toBe(false);
    expect(many.success).toBe(false);
    if (!none.success) expect(none.error.issues.map((i) => [i.code, i.path.join(".")])).toEqual([["too_small", "expectedGrantIds"]]);
    if (!many.success) expect(many.error.issues.map((i) => [i.code, i.path.join(".")])).toEqual([["too_big", "expectedGrantIds"]]);
  });

  it("rejects a malformed id at its own path", () => {
    for (const [field, value, path] of [
      ["organizationId", "not-a-uuid", "organizationId"],
      ["subjectId", "", "subjectId"],
      ["expectedGrantIds", ["not-a-uuid"], "expectedGrantIds.0"],
    ] as const) {
      const result = revokeHolderFieldsSchema.safeParse({ ...valid, [field]: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((i) => i.path.join("."))).toEqual([path]);
    }
  });

  it("rejects an unknown slot, an unknown subject kind and missing fields", () => {
    for (const [field, value] of [
      ["slot", "owner"],
      ["subjectKind", "team"],
    ] as const) {
      const result = revokeHolderFieldsSchema.safeParse({ ...valid, [field]: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((i) => i.path.join("."))).toEqual([field]);
    }
    const result = revokeHolderFieldsSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join(".")).sort()).toEqual(
        ["expectedGrantIds", "organizationId", "slot", "subjectId", "subjectKind"].sort(),
      );
    }
  });
});
