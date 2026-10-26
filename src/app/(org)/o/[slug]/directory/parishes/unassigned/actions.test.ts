/**
 * Orchestration tests for the Unassigned page's assign action (tag ACT). Mocked
 * at the `@/lib/parishes` boundary; see `../actions.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
  OrgAccessError: class extends Error {},
}));
const lib = vi.hoisted(() => ({ moveHousehold: vi.fn() }));
vi.mock("@/lib/parishes", () => lib);
const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { assignHouseholdAction } from "./actions";

const H = randomUUID();
const A = randomUUID();

function signedIn() {
  mockAuth.mockResolvedValue({ user: { id: "user-1", email: "m@example.invalid" } });
  mockResolveOrgContext.mockResolvedValue({
    kind: "ok",
    org: { personId: "person-1", organizationId: "org-1" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  lib.moveHousehold.mockReset();
  mockAuth.mockReset();
  mockResolveOrgContext.mockReset();
});

describe("assignHouseholdAction", () => {
  it("a first assignment passes expected null and the chosen district, with the session's identity", async () => {
    signedIn();
    lib.moveHousehold.mockResolvedValue({
      kind: "ok",
      changed: true,
      fromOrgUnitId: null,
      toOrgUnitId: A,
      fromName: null,
      toName: "North",
    });
    const result = await assignHouseholdAction("alder-creek", {
      householdId: H,
      expectedOrgUnitId: null,
      targetOrgUnitId: A,
    });
    expect(lib.moveHousehold).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      { userId: "user-1", email: "m@example.invalid" },
      { householdId: H, expectedOrgUnitId: null, targetOrgUnitId: A, undo: false },
    );
    expect(result).toEqual({
      ok: true,
      data: { changed: true, fromOrgUnitId: null, toOrgUnitId: A, fromName: null, toName: "North" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/directory/parishes", "layout");
  });

  it("Undo passes the assigned district as expected and null as the target (a clear is a write, not a delete)", async () => {
    signedIn();
    lib.moveHousehold.mockResolvedValue({
      kind: "ok",
      changed: true,
      fromOrgUnitId: A,
      toOrgUnitId: null,
      fromName: "North",
      toName: null,
    });
    await assignHouseholdAction("alder-creek", {
      householdId: H,
      expectedOrgUnitId: A,
      targetOrgUnitId: null,
      undo: true,
    });
    expect(lib.moveHousehold.mock.calls[0]![3]).toEqual({
      householdId: H,
      expectedOrgUnitId: A,
      targetOrgUnitId: null,
      undo: true,
    });
  });

  it("signed out, malformed and refused inputs each answer in copy and write nothing", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await assignHouseholdAction("alder-creek", { householdId: H, expectedOrgUnitId: null, targetOrgUnitId: A })).ok).toBe(false);
    signedIn();
    expect(await assignHouseholdAction("alder-creek", { householdId: "x", expectedOrgUnitId: null, targetOrgUnitId: A })).toEqual({
      ok: false,
      error: "We couldn't find that household. We've refreshed the list.",
    });
    lib.moveHousehold.mockResolvedValueOnce({ kind: "forbidden" });
    expect(await assignHouseholdAction("alder-creek", { householdId: H, expectedOrgUnitId: null, targetOrgUnitId: A })).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
    });
    lib.moveHousehold.mockResolvedValueOnce({ kind: "conflict" });
    expect((await assignHouseholdAction("alder-creek", { householdId: H, expectedOrgUnitId: null, targetOrgUnitId: A })).ok).toBe(false);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("a thrown error is the `nothing was changed` line", async () => {
    signedIn();
    lib.moveHousehold.mockRejectedValue(new Error("boom"));
    expect(await assignHouseholdAction("alder-creek", { householdId: H, expectedOrgUnitId: null, targetOrgUnitId: A })).toEqual({
      ok: false,
      error: "Could not move the household. Nothing was changed.",
    });
  });
});
