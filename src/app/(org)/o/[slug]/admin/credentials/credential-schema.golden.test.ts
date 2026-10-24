/**
 * Characterization tests for the credential form schemas, written on zod
 * 3.25.76 before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3
 * "Tests" 1). Enums with no message are tamper-only: path only.
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { APPOINTMENT_CALL_TYPES, ORDAINED_MINISTRIES } from "./credential-labels";
import { recordAppointmentSchema, recordOrdinationSchema } from "./credential-schema";

const ordination = {
  personId: "00000000-0000-0000-0000-000000000005",
  ministry: ORDAINED_MINISTRIES[0],
  ordainedOn: "2020-06-14",
  minuteReference: "",
};
const appointment = {
  personId: "00000000-0000-0000-0000-000000000005",
  servingOrgId: "d9100000-0000-0000-0000-000000000010",
  callType: APPOINTMENT_CALL_TYPES[0],
  startsOn: "2026-01-04",
  minuteReference: "",
};
const MINUTE_MAX = "Minute reference must be 500 characters or fewer";

describe("recordOrdinationSchema", () => {
  it("returns a valid value unchanged, with every ministry and the minute reference absent", async () => {
    expect(await resolveForm(recordOrdinationSchema, ordination)).toEqual({ values: ordination, errors: {}, failed: false });
    for (const ministry of ORDAINED_MINISTRIES) {
      const { minuteReference: _m, ...rest } = ordination;
      const out = await resolveForm(recordOrdinationSchema, { ...rest, ministry });
      expect(out.failed).toBe(false);
      expect(out.values).toEqual({ ...rest, ministry });
    }
  });

  it("pins the messages", async () => {
    expect((await resolveForm(recordOrdinationSchema, { ...ordination, personId: "" })).errors).toEqual({
      personId: "Choose a person",
    });
    expect((await resolveForm(recordOrdinationSchema, { ...ordination, ordainedOn: "" })).errors).toEqual({
      ordainedOn: "Ordination date is required",
    });
    expect((await resolveForm(recordOrdinationSchema, { ...ordination, minuteReference: "m".repeat(501) })).errors).toEqual({
      minuteReference: MINUTE_MAX,
    });
    expect((await resolveForm(recordOrdinationSchema, { ...ordination, minuteReference: "m".repeat(500) })).failed).toBe(false);
  });

  it("reports several failures together", async () => {
    expect((await resolveForm(recordOrdinationSchema, { ...ordination, personId: "", ordainedOn: "" })).errors).toEqual({
      personId: "Choose a person",
      ordainedOn: "Ordination date is required",
    });
  });

  it("fails (path only) on an unknown ministry", async () => {
    expect(Object.keys((await resolveForm(recordOrdinationSchema, { ...ordination, ministry: "pope" })).errors)).toEqual([
      "ministry",
    ]);
  });
});

describe("recordAppointmentSchema", () => {
  it("returns a valid value unchanged, for every call type", async () => {
    expect(await resolveForm(recordAppointmentSchema, appointment)).toEqual({ values: appointment, errors: {}, failed: false });
    for (const callType of APPOINTMENT_CALL_TYPES) {
      expect((await resolveForm(recordAppointmentSchema, { ...appointment, callType })).failed).toBe(false);
    }
  });

  it("pins the messages", async () => {
    expect(
      (await resolveForm(recordAppointmentSchema, { ...appointment, personId: "", servingOrgId: "", startsOn: "" })).errors,
    ).toEqual({
      personId: "Choose a person",
      servingOrgId: "Choose a congregation",
      startsOn: "Start date is required",
    });
    expect((await resolveForm(recordAppointmentSchema, { ...appointment, minuteReference: "m".repeat(501) })).errors).toEqual({
      minuteReference: MINUTE_MAX,
    });
  });

  it("fails (path only) on an unknown call type", async () => {
    expect(Object.keys((await resolveForm(recordAppointmentSchema, { ...appointment, callType: "wandering" })).errors)).toEqual([
      "callType",
    ]);
  });
});
