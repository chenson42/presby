/**
 * Characterization tests for the group form schemas, written on zod 3.25.76
 * before the zod 4 upgrade (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests"
 * 1). `groupRole` is an enum with no message: tamper-only, path only.
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { GROUP_ROLES } from "./group-type-labels";
import { addGroupMemberSchema, createGroupSchema, editGroupSchema, endGroupMembershipSchema } from "./group-schema";

const NAME_MAX = "Name must be 200 characters or fewer";

describe("createGroupSchema", () => {
  const valid = { groupTypeId: "d9100000-0000-0000-0000-000000000010", name: "Choir", description: "", meetsWhen: "" };

  it("returns a valid value unchanged and trims the name", async () => {
    expect(await resolveForm(createGroupSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
    expect((await resolveForm(createGroupSchema, { ...valid, name: " Choir  " })).values).toEqual(valid);
    const { description: _d, meetsWhen: _m, ...required } = valid;
    expect(await resolveForm(createGroupSchema, required)).toEqual({ values: required, errors: {}, failed: false });
  });

  it("pins the messages", async () => {
    expect((await resolveForm(createGroupSchema, { ...valid, groupTypeId: "" })).errors).toEqual({
      groupTypeId: "Choose a group type",
    });
    expect((await resolveForm(createGroupSchema, { ...valid, name: " " })).errors).toEqual({ name: "Name is required" });
    expect((await resolveForm(createGroupSchema, { ...valid, name: "n".repeat(201) })).errors).toEqual({ name: NAME_MAX });
    expect((await resolveForm(createGroupSchema, { ...valid, description: "d".repeat(2001) })).errors).toEqual({
      description: "Description is too long",
    });
    expect((await resolveForm(createGroupSchema, { ...valid, meetsWhen: "w".repeat(201) })).errors).toEqual({
      meetsWhen: "That's too long",
    });
  });
});

describe("editGroupSchema", () => {
  const valid = { name: "Choir", description: "Sings", meetsWhen: "Thursdays" };

  it("returns a valid value unchanged", async () => {
    expect(await resolveForm(editGroupSchema, valid)).toEqual({ values: valid, errors: {}, failed: false });
  });

  it("pins the messages", async () => {
    expect((await resolveForm(editGroupSchema, { ...valid, name: "" })).errors).toEqual({ name: "Name is required" });
    expect((await resolveForm(editGroupSchema, { ...valid, name: "n".repeat(201) })).errors).toEqual({ name: NAME_MAX });
    expect((await resolveForm(editGroupSchema, { ...valid, description: "d".repeat(2001) })).errors).toEqual({
      description: "Description is too long",
    });
    expect((await resolveForm(editGroupSchema, { ...valid, meetsWhen: "w".repeat(201) })).errors).toEqual({
      meetsWhen: "That's too long",
    });
  });
});

describe("addGroupMemberSchema", () => {
  const valid = { personId: "00000000-0000-0000-0000-000000000005", groupRole: GROUP_ROLES[0], startsOn: "2026-01-04" };

  it("returns a valid value unchanged for every role", async () => {
    for (const groupRole of GROUP_ROLES) {
      expect(await resolveForm(addGroupMemberSchema, { ...valid, groupRole })).toEqual({
        values: { ...valid, groupRole },
        errors: {},
        failed: false,
      });
    }
  });

  it("pins the messages", async () => {
    expect((await resolveForm(addGroupMemberSchema, { ...valid, personId: "", startsOn: "" })).errors).toEqual({
      personId: "Choose a person",
      startsOn: "Start date is required",
    });
  });

  it("fails (path only) on an unknown role", async () => {
    expect(Object.keys((await resolveForm(addGroupMemberSchema, { ...valid, groupRole: "boss" })).errors)).toEqual(["groupRole"]);
  });
});

describe("endGroupMembershipSchema", () => {
  it("returns a valid value unchanged and pins the message", async () => {
    expect(await resolveForm(endGroupMembershipSchema, { endsOn: "2026-02-01" })).toEqual({
      values: { endsOn: "2026-02-01" },
      errors: {},
      failed: false,
    });
    expect((await resolveForm(endGroupMembershipSchema, { endsOn: "" })).errors).toEqual({ endsOn: "End date is required" });
  });
});
