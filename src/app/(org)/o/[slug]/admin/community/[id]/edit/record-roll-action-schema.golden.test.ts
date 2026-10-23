/**
 * Characterization tests for `recordRollActionSchema`, written on zod 3.25.76
 * before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests"
 * 1). `kind` carries a `{ message }`, so every failure on it (empty, absent,
 * unknown) reads "Choose a roll action".
 */
import { describe, expect, it } from "vitest";
import { EDIT_TIME_ROLL_ACTION_KINDS } from "@/lib/roll-action-kinds";
import { resolveForm } from "@/lib/testing/zod-golden";
import { recordRollActionSchema } from "./record-roll-action-schema";

const valid = { kind: EDIT_TIME_ROLL_ACTION_KINDS[0], effectiveDate: "2026-05-01", minuteReference: "" };

describe("recordRollActionSchema", () => {
  it("returns a valid value unchanged", async () => {
    expect(await resolveForm(recordRollActionSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
  });

  it("accepts every edit-time kind and an absent minute reference", async () => {
    for (const kind of EDIT_TIME_ROLL_ACTION_KINDS) {
      const out = await resolveForm(recordRollActionSchema, { kind, effectiveDate: "2026-05-01" });
      expect(out.failed).toBe(false);
      expect(out.values).toEqual({ kind, effectiveDate: "2026-05-01" });
    }
  });

  it('says "Choose a roll action" for an empty, absent and unknown kind', async () => {
    for (const kind of ["", undefined, "not-a-kind"]) {
      expect((await resolveForm(recordRollActionSchema, { ...valid, kind })).errors).toEqual({
        kind: "Choose a roll action",
      });
    }
  });

  it("pins the date messages", async () => {
    expect((await resolveForm(recordRollActionSchema, { ...valid, effectiveDate: "" })).errors).toEqual({
      effectiveDate: "Effective date is required",
    });
    for (const effectiveDate of ["2026-5-1", "05/01/2026", "tomorrow"]) {
      expect((await resolveForm(recordRollActionSchema, { ...valid, effectiveDate })).errors).toEqual({
        effectiveDate: "Enter a valid date",
      });
    }
  });

  it("reports the kind and the date together", async () => {
    expect((await resolveForm(recordRollActionSchema, { kind: "", effectiveDate: "" })).errors).toEqual({
      kind: "Choose a roll action",
      effectiveDate: "Effective date is required",
    });
  });
});
