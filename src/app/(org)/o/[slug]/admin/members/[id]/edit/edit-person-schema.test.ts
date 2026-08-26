import { describe, expect, it } from "vitest";
import { editPersonSchema } from "./edit-person-schema";

const BASE = {
  identity: { firstName: "Nora", lastName: "Ashgrove" },
  contact: {},
  address: {},
  household: { mode: "none" as const },
};

describe("editPersonSchema", () => {
  it("accepts the minimal valid shape", () => {
    expect(editPersonSchema.safeParse(BASE).success).toBe(true);
  });

  it("requires firstName/lastName", () => {
    const result = editPersonSchema.safeParse({
      ...BASE,
      identity: { firstName: "", lastName: "" },
    });
    expect(result.success).toBe(false);
  });

  it("household mode 'new' requires a household name", () => {
    const result = editPersonSchema.safeParse({
      ...BASE,
      household: { mode: "new", name: "" },
    });
    expect(result.success).toBe(false);
  });

  it("household mode 'existing' requires a householdId", () => {
    const result = editPersonSchema.safeParse({
      ...BASE,
      household: { mode: "existing", householdId: "" },
    });
    expect(result.success).toBe(false);
  });

  it("household mode 'existing' with an id, and mode 'new' with a name, both pass", () => {
    expect(
      editPersonSchema.safeParse({
        ...BASE,
        household: { mode: "existing", householdId: "hh-1" },
      }).success,
    ).toBe(true);
    expect(
      editPersonSchema.safeParse({
        ...BASE,
        household: { mode: "new", name: "The Ashgroves" },
      }).success,
    ).toBe(true);
  });
});
