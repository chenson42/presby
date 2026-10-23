import { describe, expect, it } from "vitest";
import {
  RECORD_ROLL_ACTION_DEFAULT_VALUES,
  recordRollActionSchema,
} from "./record-roll-action-schema";

describe("recordRollActionSchema", () => {
  it("accepts a valid submission", () => {
    const result = recordRollActionSchema.safeParse({
      kind: "restoration",
      effectiveDate: "2026-06-01",
      minuteReference: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a kind outside EDIT_TIME_ROLL_ACTION_KINDS (a terminating kind, F19-excluded)", () => {
    const result = recordRollActionSchema.safeParse({
      kind: "death",
      effectiveDate: "2026-06-01",
      minuteReference: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects certificate_dismissed specifically (Phase 3's contradiction fix)", () => {
    const result = recordRollActionSchema.safeParse({
      kind: "certificate_dismissed",
      effectiveDate: "2026-06-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects void", () => {
    const result = recordRollActionSchema.safeParse({
      kind: "void",
      effectiveDate: "2026-06-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank effective date", () => {
    const result = recordRollActionSchema.safeParse({
      kind: "restoration",
      effectiveDate: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed effective date", () => {
    const result = recordRollActionSchema.safeParse({
      kind: "restoration",
      effectiveDate: "06/01/2026",
    });
    expect(result.success).toBe(false);
  });

  it("minuteReference is optional", () => {
    const result = recordRollActionSchema.safeParse({
      kind: "restoration",
      effectiveDate: "2026-06-01",
    });
    expect(result.success).toBe(true);
  });

  it("RECORD_ROLL_ACTION_DEFAULT_VALUES parses (a blank effectiveDate is expected pre-fill state, not a valid submission)", () => {
    const result = recordRollActionSchema.safeParse(
      RECORD_ROLL_ACTION_DEFAULT_VALUES,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("effectiveDate");
    }
  });
});
