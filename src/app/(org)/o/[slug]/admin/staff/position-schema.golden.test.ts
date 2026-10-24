/**
 * Characterization tests for the staff form schemas, written on zod 3.25.76
 * before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests"
 * 1 and Conversion E). The first-name and last-name length messages are the
 * one zod DEFAULT a user can reach (`add-staff-position-form.tsx` renders them
 * and the inputs have no maxLength), so the v3 default string is pinned and
 * the upgrade must keep it. `email` and `phone` render no error line, so
 * failure and path only.
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { newStaffPersonSchema, staffPositionSchema } from "./position-schema";

const LENGTH_200 = "String must contain at most 200 character(s)";

describe("newStaffPersonSchema", () => {
  const person = { firstName: "Imogen", lastName: "Thackeray", phone: "", contact: { emails: [] } };

  it("accepts exactly 200 characters of first and last name", async () => {
    const out = await resolveForm(newStaffPersonSchema, {
      ...person,
      firstName: "a".repeat(200),
      lastName: "b".repeat(200),
    });
    expect(out.failed).toBe(false);
  });

  it("pins the 201-character first and last name message", async () => {
    expect(
      (await resolveForm(newStaffPersonSchema, { ...person, firstName: "a".repeat(201) })).errors,
    ).toEqual({ firstName: LENGTH_200 });
    expect(
      (await resolveForm(newStaffPersonSchema, { ...person, lastName: "b".repeat(201) })).errors,
    ).toEqual({ lastName: LENGTH_200 });
    expect(
      (
        await resolveForm(newStaffPersonSchema, {
          ...person,
          firstName: "a".repeat(201),
          lastName: "b".repeat(201),
        })
      ).errors,
    ).toEqual({ firstName: LENGTH_200, lastName: LENGTH_200 });
  });

  it("pins the required-name messages, counted after trimming", async () => {
    expect((await resolveForm(newStaffPersonSchema, { ...person, firstName: "   " })).errors).toEqual({
      firstName: "First name is required",
    });
    expect((await resolveForm(newStaffPersonSchema, { ...person, lastName: "" })).errors).toEqual({
      lastName: "Last name is required",
    });
  });

  it("trims the parsed values", async () => {
    const out = await resolveForm(newStaffPersonSchema, {
      firstName: "  Imogen ",
      lastName: " Thackeray  ",
      phone: " 555-0100 ",
      contact: { emails: [] },
    });
    expect(out.values).toEqual({
      firstName: "Imogen",
      lastName: "Thackeray",
      phone: "555-0100",
      contact: { emails: [] },
    });
  });

  it("accepts phone absent", async () => {
    const out = await resolveForm(newStaffPersonSchema, { firstName: "A", lastName: "B", contact: { emails: [] } });
    expect(out.failed).toBe(false);
    expect(out.values).toEqual({ firstName: "A", lastName: "B", contact: { emails: [] } });
  });

  it("fails (path only: no error line is rendered) at a 41-character phone", async () => {
    expect(Object.keys((await resolveForm(newStaffPersonSchema, { ...person, phone: "5".repeat(41) })).errors)).toEqual([
      "phone",
    ]);
    expect((await resolveForm(newStaffPersonSchema, { ...person, phone: "5".repeat(40) })).failed).toBe(
      false,
    );
  });
});

describe("staffPositionSchema", () => {
  const position = {
    personId: "00000000-0000-0000-0000-000000000005",
    position: "Director of Music",
    department: "",
    startsOn: "2026-06-01",
    minuteReference: "",
  };

  it("parses a valid position unchanged and trims the position", async () => {
    expect(await resolveForm(staffPositionSchema, position)).toEqual({ values: position, errors: {}, failed: false });
    const out = await resolveForm(staffPositionSchema, { ...position, position: "  Sexton " });
    expect((out.values as { position: string }).position).toBe("Sexton");
  });

  it("pins the messages", async () => {
    expect((await resolveForm(staffPositionSchema, { ...position, personId: "" })).errors).toEqual({
      personId: "Choose a person",
    });
    expect((await resolveForm(staffPositionSchema, { ...position, position: "  " })).errors).toEqual({
      position: "Position is required",
    });
    expect((await resolveForm(staffPositionSchema, { ...position, position: "p".repeat(201) })).errors).toEqual({
      position: "Position must be 200 characters or fewer",
    });
    expect((await resolveForm(staffPositionSchema, { ...position, department: "d".repeat(201) })).errors).toEqual({
      department: "That's too long",
    });
    expect((await resolveForm(staffPositionSchema, { ...position, startsOn: "" })).errors).toEqual({
      startsOn: "Start date is required",
    });
    expect((await resolveForm(staffPositionSchema, { ...position, minuteReference: "m".repeat(501) })).errors).toEqual({
      minuteReference: "That's too long",
    });
  });

  it("accepts the optional fields absent", async () => {
    const { department: _d, minuteReference: _m, ...required } = position;
    expect((await resolveForm(staffPositionSchema, required)).failed).toBe(false);
  });
});
