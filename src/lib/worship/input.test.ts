import { describe, expect, it } from "vitest";
import {
  addPositionSchema,
  createServiceTypeSchema,
  createTeamSchema,
  setQualificationsSchema,
  updateServiceTypeSchema,
} from "./input";

describe("worship action inputs", () => {
  it("strip keys a client should not be able to send (an organization id, an acting person, a status)", () => {
    const parsed = createTeamSchema.parse({ name: "Band", kind: "team", organizationId: "x", personId: "y", status: "z" });
    expect(parsed).toEqual({ name: "Band", kind: "team" });
    const typed = createServiceTypeSchema.parse({ name: "Sunday", startTime: "09:00", organizationId: "x" });
    expect(typed).toEqual({ name: "Sunday", startTime: "09:00" });
  });

  it("refuse the wrong type (the TypeScript types do not survive the wire)", () => {
    expect(createTeamSchema.safeParse({ name: 5, kind: "team" }).success).toBe(false);
    expect(createTeamSchema.safeParse({ name: "Band", kind: "orchestra" }).success).toBe(false);
    expect(createTeamSchema.safeParse({ name: "Band", kind: "choir", starter: "kazoos" }).success).toBe(false);
    expect(addPositionSchema.safeParse({ groupId: "g", name: "Drums", slots: "2" }).success).toBe(false);
    expect(setQualificationsSchema.safeParse({ groupId: "g", personId: "p", positionIds: "a" }).success).toBe(false);
    expect(updateServiceTypeSchema.safeParse({ name: "x", startTime: "09:00" }).success).toBe(false);
  });

  it("leave lengths and ranges to the store, which answers with the Copy sentence", () => {
    expect(addPositionSchema.safeParse({ groupId: "g", name: "x".repeat(500), slots: 999 }).success).toBe(true);
  });
});
