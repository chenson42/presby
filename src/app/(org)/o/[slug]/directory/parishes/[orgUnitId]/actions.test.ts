/**
 * Orchestration tests for the district page's move and bulk-move actions (tag
 * ACT). Mocked at the `@/lib/parishes` boundary; see `../actions.test.ts`. The
 * points that matter here: identity is the session's, a bulk request carries no
 * household ids, the bulk response carries counts only, and Undo has its own
 * truthful copy.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const mockResolveOrgContext = vi.hoisted(() => vi.fn());
const { MockOrgAccessError } = vi.hoisted(() => ({
  MockOrgAccessError: class extends Error {
    constructor() {
      super("mock: no active membership");
      this.name = "OrgAccessError";
    }
  },
}));
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
  OrgAccessError: MockOrgAccessError,
}));
const lib = vi.hoisted(() => ({ moveHousehold: vi.fn(), bulkMoveHouseholds: vi.fn() }));
vi.mock("@/lib/parishes", () => lib);
const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { bulkMoveAction, moveHouseholdAction } from "./actions";

const H = randomUUID();
const A = randomUUID();
const B = randomUUID();
const ACTOR = { userId: "user-1", email: "m@example.invalid" };

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
  lib.bulkMoveHouseholds.mockReset();
  mockAuth.mockReset();
  mockResolveOrgContext.mockReset();
});

describe("moveHouseholdAction", () => {
  const input = { householdId: H, expectedOrgUnitId: A, targetOrgUnitId: B };

  it("signed out: a message, nothing resolved or written", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await moveHouseholdAction("alder-creek", input)).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(lib.moveHousehold).not.toHaveBeenCalled();
  });

  it("passes the session's person/organization/actor and the validated input; returns names and ids of districts, not of people", async () => {
    signedIn();
    lib.moveHousehold.mockResolvedValue({
      kind: "ok",
      changed: true,
      fromOrgUnitId: A,
      toOrgUnitId: B,
      fromName: "East",
      toName: "North",
    });
    const result = await moveHouseholdAction("alder-creek", {
      ...input,
      ...({ organizationId: "evil" } as object),
    });
    expect(lib.moveHousehold).toHaveBeenCalledWith("person-1", "org-1", ACTOR, {
      householdId: H,
      expectedOrgUnitId: A,
      targetOrgUnitId: B,
      undo: false,
    });
    expect(result).toEqual({
      ok: true,
      data: { changed: true, fromOrgUnitId: A, toOrgUnitId: B, fromName: "East", toName: "North" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/directory/parishes", "layout");
  });

  it("a quiet no-op still succeeds with changed false", async () => {
    signedIn();
    lib.moveHousehold.mockResolvedValue({
      kind: "ok",
      changed: false,
      fromOrgUnitId: A,
      toOrgUnitId: A,
      fromName: "East",
      toName: "East",
    });
    const result = await moveHouseholdAction("alder-creek", { householdId: H, expectedOrgUnitId: A, targetOrgUnitId: A });
    expect(result.ok && result.data?.changed).toBe(false);
  });

  it("a malformed shape is `not found` before the library", async () => {
    signedIn();
    for (const bad of [
      { householdId: "x", expectedOrgUnitId: null, targetOrgUnitId: A },
      { householdId: H, expectedOrgUnitId: undefined, targetOrgUnitId: A },
      null,
    ]) {
      const result = await moveHouseholdAction("alder-creek", bad as never);
      expect(result).toEqual({ ok: false, error: "We couldn't find that household. We've refreshed the list." });
    }
    expect(lib.moveHousehold).not.toHaveBeenCalled();
  });

  it("maps each refusal; the same copy whether the toggle is off or authority is missing", async () => {
    signedIn();
    const table: Array<[unknown, string]> = [
      [{ kind: "off" }, "You don't have permission to do that."],
      [{ kind: "forbidden" }, "You don't have permission to do that."],
      [{ kind: "conflict" }, "This household was just moved by someone else. We've refreshed the list."],
      [{ kind: "not_found" }, "We couldn't find that household. We've refreshed the list."],
      [{ kind: "target_unavailable", reason: "archived", districtName: "East" }, "That district was just archived. Choose another."],
    ];
    for (const [result, error] of table) {
      lib.moveHousehold.mockResolvedValueOnce(result);
      expect(await moveHouseholdAction("alder-creek", input), JSON.stringify(result)).toEqual({ ok: false, error });
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("Undo has its own copy: a conflict can't be undone, and an archived previous district is named", async () => {
    signedIn();
    lib.moveHousehold.mockResolvedValueOnce({ kind: "conflict" });
    expect(await moveHouseholdAction("alder-creek", { ...input, undo: true })).toEqual({
      ok: false,
      error: "Can't undo: this household has been moved since.",
    });
    lib.moveHousehold.mockResolvedValueOnce({ kind: "target_unavailable", reason: "archived", districtName: "East" });
    expect(await moveHouseholdAction("alder-creek", { ...input, undo: true })).toEqual({
      ok: false,
      error: "Can't undo: East is archived.",
    });
    expect(lib.moveHousehold.mock.calls[0]![3].undo).toBe(true);
  });

  it("a thrown error is `Could not move the household. Nothing was changed.`; Undo's is its own", async () => {
    signedIn();
    lib.moveHousehold.mockRejectedValueOnce(new Error("deadlock detected"));
    expect(await moveHouseholdAction("alder-creek", input)).toEqual({
      ok: false,
      error: "Could not move the household. Nothing was changed.",
    });
    lib.moveHousehold.mockRejectedValueOnce(new Error("deadlock detected"));
    expect(await moveHouseholdAction("alder-creek", { ...input, undo: true })).toEqual({
      ok: false,
      error: "Could not undo. Nothing was changed.",
    });
  });
});

describe("bulkMoveAction", () => {
  const input = { sourceOrgUnitId: A, targetOrgUnitId: B, expectedCount: 12 };

  it("passes source, target and count - and NO household ids - and returns counts and a district name only", async () => {
    signedIn();
    lib.bulkMoveHouseholds.mockResolvedValue({ kind: "ok", moved: 11, skipped: 1, toName: "North" });
    const result = await bulkMoveAction("alder-creek", {
      ...input,
      ...({ householdIds: [H] } as object),
    });
    expect(lib.bulkMoveHouseholds).toHaveBeenCalledWith("person-1", "org-1", ACTOR, {
      sourceOrgUnitId: A,
      targetOrgUnitId: B,
      expectedCount: 12,
    });
    expect(result).toEqual({ ok: true, data: { moved: 11, skipped: 1, toName: "North" } });
    expect(JSON.stringify(result)).not.toContain(H);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/directory/parishes", "layout");
  });

  it("over 100 is the smaller-groups message before the library; 0, negative and fractional are the count-changed message", async () => {
    signedIn();
    expect(await bulkMoveAction("alder-creek", { ...input, expectedCount: 101 })).toEqual({
      ok: false,
      error: "This district has more than 100 households, so move them in smaller groups with Move.",
    });
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const result = await bulkMoveAction("alder-creek", { ...input, expectedCount: bad });
      expect(result.ok, String(bad)).toBe(false);
    }
    expect(lib.bulkMoveHouseholds).not.toHaveBeenCalled();
  });

  it("a malformed id is `not found`", async () => {
    signedIn();
    const result = await bulkMoveAction("alder-creek", { ...input, sourceOrgUnitId: "nope" });
    expect(result.ok).toBe(false);
    expect(lib.bulkMoveHouseholds).not.toHaveBeenCalled();
  });

  it("maps each library refusal", async () => {
    signedIn();
    const table: Array<[unknown, string]> = [
      [{ kind: "forbidden" }, "You don't have permission to do that."],
      [{ kind: "source_not_archived" }, "Only an archived district can be emptied this way."],
      [{ kind: "too_many" }, "This district has more than 100 households, so move them in smaller groups with Move."],
      [
        { kind: "count_changed" },
        "The households in this district changed while you were looking. We've refreshed the page. Check the count and try again.",
      ],
      [{ kind: "target_unavailable", reason: "archived" }, "That district was just archived. Choose another."],
    ];
    for (const [result, error] of table) {
      lib.bulkMoveHouseholds.mockResolvedValueOnce(result);
      expect(await bulkMoveAction("alder-creek", input), JSON.stringify(result)).toEqual({ ok: false, error });
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("a thrown error is `Could not move the households. Nothing was changed.`", async () => {
    signedIn();
    lib.bulkMoveHouseholds.mockRejectedValue(new Error("serialization failure"));
    expect(await bulkMoveAction("alder-creek", input)).toEqual({
      ok: false,
      error: "Could not move the households. Nothing was changed.",
    });
  });
});
