/**
 * Characterization tests for `buildSchema` (exported for this purpose), written
 * on zod 3.25.76 before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md,
 * Phase 3 "Tests" 1). Through the real `zodResolver`, so the nested
 * `fields.<key>` paths are the ones react-hook-form renders. `../actions` is
 * mocked for the same reason `statistics-submit-form.test.tsx` documents.
 * `attestedRole` is an enum with no message: tamper-only, path only.
 */
import { describe, expect, it, vi } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import type { SasrFieldGroup } from "@/lib/sasr-fields";

vi.mock("../actions", () => ({ submitGrantedReturnAction: vi.fn() }));

import { buildSchema, type SasrFieldBounds } from "./statistics-submit-form";

const GROUPS: SasrFieldGroup[] = [
  {
    title: "Gains",
    fields: [
      { key: "gains_other", label: "Other means", inputType: "count" },
      { key: "avg_attendance", label: "Average attendance", inputType: "count" },
    ],
  },
];
const BOUNDS: Record<string, SasrFieldBounds> = {
  gains_other: { min: 0, max: 50, type: "integer" },
};

const valid = {
  attestedByName: "Imogen Thackeray",
  attestedRole: "clerk_of_session",
  attestedRoleOther: "",
  fields: { gains_other: "", avg_attendance: "" },
};

const schema = buildSchema(GROUPS, BOUNDS);
const errorsOf = async (over: Record<string, unknown>) => (await resolveForm(schema, { ...valid, ...over })).errors;
const fieldsOf = async (fields: Record<string, string>) => (await resolveForm(schema, { ...valid, fields })).errors;

describe("buildSchema (the statistics submit form)", () => {
  it("returns a valid value unchanged, with blank and numeric fields", async () => {
    expect(await resolveForm(schema, valid)).toEqual({ values: valid, errors: {}, failed: false });
    const filled = { ...valid, fields: { gains_other: "50", avg_attendance: "120" } };
    expect(await resolveForm(schema, filled)).toEqual({ values: filled, errors: {}, failed: false });
  });

  it("trims the name and the other-role text", async () => {
    const out = await resolveForm(schema, { ...valid, attestedByName: "  Imogen ", attestedRole: "other", attestedRoleOther: " Treasurer " });
    expect(out.values).toMatchObject({ attestedByName: "Imogen", attestedRoleOther: "Treasurer" });
    expect(out.failed).toBe(false);
  });

  it("pins the bounded field message, at its exact bounds", async () => {
    expect(await fieldsOf({ gains_other: "51", avg_attendance: "" })).toEqual({
      "fields.gains_other": "Enter a whole number between 0 and 50.",
    });
    for (const bad of ["-1", "1.5", "abc"]) {
      expect(await fieldsOf({ gains_other: bad, avg_attendance: "" })).toEqual({
        "fields.gains_other": "Enter a whole number between 0 and 50.",
      });
    }
    expect(await fieldsOf({ gains_other: "0", avg_attendance: "" })).toEqual({});
    expect(await fieldsOf({ gains_other: "50", avg_attendance: "" })).toEqual({});
  });

  it("pins the unbounded field message", async () => {
    for (const bad of ["-1", "1.5", "abc"]) {
      expect(await fieldsOf({ gains_other: "", avg_attendance: bad })).toEqual({
        "fields.avg_attendance": "Enter a non-negative whole number.",
      });
    }
    expect(await fieldsOf({ gains_other: "", avg_attendance: "999999" })).toEqual({});
  });

  it("pins the attestation messages", async () => {
    expect(await errorsOf({ attestedByName: "   " })).toEqual({
      attestedByName: "Enter the name of the person attesting to this report.",
    });
    expect(await errorsOf({ attestedByName: "n".repeat(256) })).toEqual({
      attestedByName: "Must be 255 characters or fewer.",
    });
    expect(await errorsOf({ attestedRole: "other", attestedRoleOther: "r".repeat(101) })).toEqual({
      attestedRoleOther: "Must be 100 characters or fewer.",
    });
  });

  it('pins the object-level "Enter their role." rule at attestedRoleOther', async () => {
    expect(await errorsOf({ attestedRole: "other", attestedRoleOther: "" })).toEqual({
      attestedRoleOther: "Enter their role.",
    });
    expect(await errorsOf({ attestedRole: "other", attestedRoleOther: "   " })).toEqual({
      attestedRoleOther: "Enter their role.",
    });
    expect(await errorsOf({ attestedRole: "moderator", attestedRoleOther: "" })).toEqual({});
  });

  it("runs the object-level rule alongside a field-level failure", async () => {
    expect(
      await errorsOf({
        attestedByName: "",
        attestedRole: "other",
        attestedRoleOther: "",
        fields: { gains_other: "99", avg_attendance: "x" },
      }),
    ).toEqual({
      attestedByName: "Enter the name of the person attesting to this report.",
      attestedRoleOther: "Enter their role.",
      "fields.gains_other": "Enter a whole number between 0 and 50.",
      "fields.avg_attendance": "Enter a non-negative whole number.",
    });
  });

  it("fails (path only: enum with no message is tamper-only) on an unknown role", async () => {
    expect(Object.keys(await errorsOf({ attestedRole: "bishop" }))).toEqual(["attestedRole"]);
  });
});
