/**
 * Shape validation for the move/assign action input. A bad id is `null` here
 * (the action answers "not found"), never a raw cast error.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMoveInput } from "./move-input";

const A = randomUUID();
const B = randomUUID();
const H = randomUUID();

describe("parseMoveInput", () => {
  it("accepts uuids and nulls for expected and target, and defaults undo to false", () => {
    expect(
      parseMoveInput({ householdId: H, expectedOrgUnitId: null, targetOrgUnitId: A }),
    ).toEqual({ householdId: H, expectedOrgUnitId: null, targetOrgUnitId: A, undo: false });
    expect(
      parseMoveInput({ householdId: H, expectedOrgUnitId: A, targetOrgUnitId: null, undo: true }),
    ).toEqual({ householdId: H, expectedOrgUnitId: A, targetOrgUnitId: null, undo: true });
  });

  it("only a literal `true` is an undo (a truthy string is not)", () => {
    expect(
      parseMoveInput({ householdId: H, expectedOrgUnitId: A, targetOrgUnitId: B, undo: "true" })?.undo,
    ).toBe(false);
  });

  it("refuses a malformed or missing id, an undefined (not null) district, and a non-object", () => {
    for (const bad of [
      { householdId: "nope", expectedOrgUnitId: null, targetOrgUnitId: A },
      { householdId: H, expectedOrgUnitId: "nope", targetOrgUnitId: A },
      { householdId: H, expectedOrgUnitId: null, targetOrgUnitId: "nope" },
      { householdId: H, expectedOrgUnitId: undefined, targetOrgUnitId: A },
      { householdId: H, targetOrgUnitId: A },
      { expectedOrgUnitId: null, targetOrgUnitId: A },
      { householdId: 42, expectedOrgUnitId: null, targetOrgUnitId: A },
      null,
      undefined,
      "string",
      42,
    ]) {
      expect(parseMoveInput(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("ignores extra keys (an organizationId from a client is never read)", () => {
    const parsed = parseMoveInput({
      householdId: H,
      expectedOrgUnitId: null,
      targetOrgUnitId: A,
      organizationId: randomUUID(),
    });
    expect(parsed).toEqual({ householdId: H, expectedOrgUnitId: null, targetOrgUnitId: A, undo: false });
    expect(Object.keys(parsed!)).not.toContain("organizationId");
  });
});
