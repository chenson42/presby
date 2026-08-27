import { describe, expect, it } from "vitest";
import {
  addGroupMemberSchema,
  createGroupSchema,
  editGroupSchema,
  endGroupMembershipSchema,
} from "./group-schema";

describe("createGroupSchema", () => {
  it("accepts a minimal valid submission", () => {
    const result = createGroupSchema.safeParse({
      groupTypeId: "type-1",
      name: "Property Committee",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty groupTypeId", () => {
    const result = createGroupSchema.safeParse({
      groupTypeId: "",
      name: "Property Committee",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty (or whitespace-only) name", () => {
    const result = createGroupSchema.safeParse({
      groupTypeId: "type-1",
      name: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name over 200 characters", () => {
    const result = createGroupSchema.safeParse({
      groupTypeId: "type-1",
      name: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional description and meetsWhen", () => {
    const result = createGroupSchema.safeParse({
      groupTypeId: "type-1",
      name: "Property Committee",
      description: "Handles building maintenance",
      meetsWhen: "First Monday, 7pm",
    });
    expect(result.success).toBe(true);
  });
});

describe("editGroupSchema", () => {
  it("accepts a minimal valid submission", () => {
    const result = editGroupSchema.safeParse({ name: "Renamed Committee" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = editGroupSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});

describe("addGroupMemberSchema", () => {
  it("accepts a valid submission", () => {
    const result = addGroupMemberSchema.safeParse({
      personId: "person-1",
      groupRole: "chair",
      startsOn: "2026-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty personId", () => {
    const result = addGroupMemberSchema.safeParse({
      personId: "",
      groupRole: "member",
      startsOn: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized groupRole", () => {
    const result = addGroupMemberSchema.safeParse({
      personId: "person-1",
      groupRole: "president",
      startsOn: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing startsOn", () => {
    const result = addGroupMemberSchema.safeParse({
      personId: "person-1",
      groupRole: "member",
      startsOn: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("endGroupMembershipSchema", () => {
  it("accepts a valid endsOn", () => {
    const result = endGroupMembershipSchema.safeParse({ endsOn: "2026-01-01" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing endsOn", () => {
    const result = endGroupMembershipSchema.safeParse({ endsOn: "" });
    expect(result.success).toBe(false);
  });
});
