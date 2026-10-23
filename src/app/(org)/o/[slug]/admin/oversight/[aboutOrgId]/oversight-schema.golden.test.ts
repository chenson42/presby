/**
 * Characterization tests for `oversightSchema`, written on zod 3.25.76 before
 * the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests" 1).
 * The two latitude/longitude fields chain refinements; the FIRST message wins.
 * `viabilityScore` is an enum with no message: tamper-only, path only.
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { oversightSchema } from "./oversight-schema";

const valid = {
  viabilityScore: "2",
  redevelopmentNotes: "",
  buildingsNotes: "",
  insuranceCarrier: "",
  insuranceExpiresOn: "",
  latitude: "",
  longitude: "",
};

const errorsOf = async (over: Record<string, unknown>) => (await resolveForm(oversightSchema, { ...valid, ...over })).errors;

describe("oversightSchema", () => {
  it("returns a valid value unchanged, for every score", async () => {
    expect(await resolveForm(oversightSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
    for (const viabilityScore of ["", "1", "2", "3"]) {
      expect((await resolveForm(oversightSchema, { ...valid, viabilityScore })).failed).toBe(false);
    }
    const located = { ...valid, latitude: "-90", longitude: "180" };
    expect(await resolveForm(oversightSchema, located)).toEqual({ values: located, errors: {}, failed: false });
  });

  it('says "Must be a number" first for a non-numeric coordinate', async () => {
    expect(await errorsOf({ latitude: "north", longitude: "far" })).toEqual({
      latitude: "Must be a number",
      longitude: "Must be a number",
    });
  });

  it("says the range message for an out-of-range number", async () => {
    expect(await errorsOf({ latitude: "90.5" })).toEqual({ latitude: "Must be between -90 and 90" });
    expect(await errorsOf({ latitude: "-91" })).toEqual({ latitude: "Must be between -90 and 90" });
    expect(await errorsOf({ longitude: "181" })).toEqual({ longitude: "Must be between -180 and 180" });
    expect(await errorsOf({ longitude: "-180.1" })).toEqual({ longitude: "Must be between -180 and 180" });
  });

  it("pins the length messages and their exact bounds", async () => {
    expect(await errorsOf({ redevelopmentNotes: "r".repeat(4001) })).toEqual({
      redevelopmentNotes: "Must be 4000 characters or fewer",
    });
    expect(await errorsOf({ buildingsNotes: "b".repeat(4001) })).toEqual({
      buildingsNotes: "Must be 4000 characters or fewer",
    });
    expect(await errorsOf({ insuranceCarrier: "i".repeat(256) })).toEqual({
      insuranceCarrier: "Must be 255 characters or fewer",
    });
    expect(
      (await resolveForm(oversightSchema, { ...valid, redevelopmentNotes: "r".repeat(4000), insuranceCarrier: "i".repeat(255) })).failed,
    ).toBe(false);
  });

  it("reports several failures together", async () => {
    expect(await errorsOf({ latitude: "x", longitude: "999", insuranceCarrier: "i".repeat(256) })).toEqual({
      latitude: "Must be a number",
      longitude: "Must be between -180 and 180",
      insuranceCarrier: "Must be 255 characters or fewer",
    });
  });

  it("fails (path only: enum with no message is tamper-only) on an unknown score", async () => {
    expect(Object.keys(await errorsOf({ viabilityScore: "9" }))).toEqual(["viabilityScore"]);
  });
});
