import { isUuid } from "@/lib/is-uuid";

/**
 * Shape validation for the move/assign action input, shared by the district
 * page's and the Unassigned page's `actions.ts` (two action files, one rule).
 * Not a `'use server'` module. A malformed id is `null` here and the caller
 * answers "not found", never a raw cast error; the library re-validates and is
 * the authority.
 */
export interface MoveInput {
  householdId: string;
  expectedOrgUnitId: string | null;
  targetOrgUnitId: string | null;
  undo: boolean;
}

function idOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isUuid(value) ? value : undefined;
}

export function parseMoveInput(input: unknown): MoveInput | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  if (!isUuid(raw.householdId)) return null;
  const expected = idOrNull(raw.expectedOrgUnitId);
  const target = idOrNull(raw.targetOrgUnitId);
  if (expected === undefined || target === undefined) return null;
  return {
    householdId: raw.householdId,
    expectedOrgUnitId: expected,
    targetOrgUnitId: target,
    undo: raw.undo === true,
  };
}
