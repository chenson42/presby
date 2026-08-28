/**
 * Tests for `staffPositionSchema`/`newStaffPersonSchema` —
 * staff-and-personnel Phase 3, ux-developer slice.
 */
import { describe, expect, it } from "vitest";
import { newStaffPersonSchema, staffPositionSchema } from "./position-schema";

const BASE = {
  personId: "person-1",
  position: "Church Secretary",
  department: "",
  startsOn: "2026-01-08",
  minuteReference: "",
};

describe("staffPositionSchema — required fields", () => {
  it("rejects an empty personId", () => {
    expect(staffPositionSchema.safeParse({ ...BASE, personId: "" }).success).toBe(
      false,
    );
  });

  it("rejects an empty position", () => {
    expect(staffPositionSchema.safeParse({ ...BASE, position: "" }).success).toBe(
      false,
    );
  });

  it("rejects a position that is only whitespace", () => {
    const result = staffPositionSchema.safeParse({ ...BASE, position: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects an empty startsOn", () => {
    expect(
      staffPositionSchema.safeParse({ ...BASE, startsOn: "" }).success,
    ).toBe(false);
  });

  it("trims position via the schema's own transform", () => {
    const result = staffPositionSchema.safeParse({
      ...BASE,
      position: "  Church Secretary  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.position).toBe("Church Secretary");
    }
  });

  it("rejects a position longer than 200 characters", () => {
    const result = staffPositionSchema.safeParse({
      ...BASE,
      position: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe("staffPositionSchema — optional fields", () => {
  it("accepts empty department and minuteReference", () => {
    expect(staffPositionSchema.safeParse(BASE).success).toBe(true);
  });

  it("accepts a populated department and minuteReference", () => {
    const result = staffPositionSchema.safeParse({
      ...BASE,
      department: "Facilities",
      minuteReference: "Session minutes, 12 Jan 2026",
    });
    expect(result.success).toBe(true);
  });
});

describe("newStaffPersonSchema — required fields", () => {
  it("rejects an empty firstName", () => {
    const result = newStaffPersonSchema.safeParse({
      firstName: "",
      lastName: "Windham",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty lastName", () => {
    const result = newStaffPersonSchema.safeParse({
      firstName: "Marisol",
      lastName: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts first/last name alone, with no contact fields", () => {
    const result = newStaffPersonSchema.safeParse({
      firstName: "Marisol",
      lastName: "Windham",
    });
    expect(result.success).toBe(true);
  });

  it("trims firstName/lastName via the schema's own transform", () => {
    const result = newStaffPersonSchema.safeParse({
      firstName: "  Marisol  ",
      lastName: "  Windham  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe("Marisol");
      expect(result.data.lastName).toBe("Windham");
    }
  });
});
