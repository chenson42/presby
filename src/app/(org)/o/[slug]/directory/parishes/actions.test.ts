/**
 * Orchestration tests for the district lifecycle actions (tag ACT). Mocked at
 * the `@/lib/parishes` boundary: the SQL, the authority and the audit rows are
 * proven against Postgres in `parishes.test.ts`. What this file pins is what
 * `actions.ts` owns: identity from the session (never the client), shape
 * validation, the copy for each result kind, revalidation only after success,
 * and that thrown errors never leak.
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

const lib = vi.hoisted(() => ({
  defineDistrict: vi.fn(),
  renameDistrict: vi.fn(),
  archiveDistrict: vi.fn(),
  restoreDistrict: vi.fn(),
}));
vi.mock("@/lib/parishes", () => lib);
const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import {
  archiveDistrictAction,
  defineDistrictAction,
  renameDistrictAction,
  restoreDistrictAction,
} from "./actions";

const U1 = randomUUID();
const SESSION = { user: { id: "user-1", email: "admin@example.invalid" } };
const RESOLVED = {
  kind: "ok" as const,
  org: { personId: "person-1", organizationId: "org-1" },
};

function signedIn() {
  mockAuth.mockResolvedValue(SESSION);
  mockResolveOrgContext.mockResolvedValue(RESOLVED);
}

afterEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(lib)) fn.mockReset();
  mockAuth.mockReset();
  mockResolveOrgContext.mockReset();
});

const ACTOR = { userId: "user-1", email: "admin@example.invalid" };

describe("identity", () => {
  it("every action refuses when signed out, resolving nothing and calling no library function", async () => {
    mockAuth.mockResolvedValue(null);
    const results = await Promise.all([
      defineDistrictAction("alder-creek", { name: "North" }),
      renameDistrictAction("alder-creek", { orgUnitId: U1, name: "North" }),
      archiveDistrictAction("alder-creek", { orgUnitId: U1 }),
      restoreDistrictAction("alder-creek", { orgUnitId: U1 }),
    ]);
    for (const result of results) {
      expect(result).toEqual({ ok: false, error: "You must be signed in to do that." });
    }
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    for (const fn of Object.values(lib)) expect(fn).not.toHaveBeenCalled();
  });

  it("the library receives the session's own person and organization and an audit actor from the session - never client input", async () => {
    signedIn();
    lib.defineDistrict.mockResolvedValue({ kind: "ok", orgUnitId: U1, name: "North District" });
    await defineDistrictAction("alder-creek", {
      name: "North District",
      ...({ organizationId: "evil-org", personId: "evil-person" } as object),
    } as { name: string });
    expect(lib.defineDistrict).toHaveBeenCalledWith("person-1", "org-1", ACTOR, { name: "North District" });
    expect(mockResolveOrgContext).toHaveBeenCalledWith("user-1", "alder-creek");
  });
});

describe("defineDistrictAction", () => {
  it("ok: returns the new id, revalidates the whole parishes subtree", async () => {
    signedIn();
    lib.defineDistrict.mockResolvedValue({ kind: "ok", orgUnitId: U1, name: "North District" });
    expect(await defineDistrictAction("alder-creek", { name: "North District" })).toEqual({
      ok: true,
      data: { orgUnitId: U1, name: "North District" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/directory/parishes", "layout");
  });

  it("an empty or over-long name is refused before the library with the field copy", async () => {
    signedIn();
    expect(await defineDistrictAction("alder-creek", { name: "  " })).toEqual({
      ok: false,
      error: "Enter a name for the district.",
    });
    expect(await defineDistrictAction("alder-creek", { name: "x".repeat(81) })).toEqual({
      ok: false,
      error: "Use 80 characters or fewer.",
    });
    expect(lib.defineDistrict).not.toHaveBeenCalled();
  });

  it("a non-object input is a message, never a throw", async () => {
    signedIn();
    for (const bad of [null, undefined, "North", 7, {}, { name: 5 }]) {
      const result = await defineDistrictAction("alder-creek", bad as never);
      expect(result.ok).toBe(false);
    }
    expect(lib.defineDistrict).not.toHaveBeenCalled();
  });

  it("maps each library refusal to its copy, with no revalidation", async () => {
    signedIn();
    const cases: Array<[unknown, string]> = [
      [{ kind: "off" }, "You don't have permission to do that."],
      [{ kind: "forbidden" }, "You don't have permission to do that."],
      [{ kind: "name_taken" }, "A district with that name already exists."],
    ];
    for (const [result, error] of cases) {
      lib.defineDistrict.mockResolvedValueOnce(result);
      expect(await defineDistrictAction("alder-creek", { name: "North" })).toEqual({ ok: false, error });
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("a thrown error is `We couldn't save that. Nothing was changed.`; a lapsed membership is the refusal", async () => {
    signedIn();
    lib.defineDistrict.mockRejectedValueOnce(new Error("connection reset by peer"));
    expect(await defineDistrictAction("alder-creek", { name: "North" })).toEqual({
      ok: false,
      error: "We couldn't save that. Nothing was changed.",
    });
    lib.defineDistrict.mockRejectedValueOnce(new MockOrgAccessError());
    expect(await defineDistrictAction("alder-creek", { name: "North" })).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
    });
  });
});

describe("renameDistrictAction", () => {
  it("ok: revalidates and returns the stored name", async () => {
    signedIn();
    lib.renameDistrict.mockResolvedValue({ kind: "ok", changed: true, name: "Northside" });
    expect(await renameDistrictAction("alder-creek", { orgUnitId: U1, name: "Northside" })).toEqual({
      ok: true,
      data: { name: "Northside" },
    });
    expect(lib.renameDistrict).toHaveBeenCalledWith("person-1", "org-1", ACTOR, { orgUnitId: U1, name: "Northside" });
    expect(mockRevalidatePath).toHaveBeenCalled();
  });

  it("a malformed id is `not found`, never a cast error, and the library is not called", async () => {
    signedIn();
    expect(await renameDistrictAction("alder-creek", { orgUnitId: "nope", name: "X" })).toEqual({
      ok: false,
      error: "We couldn't find that district. We've refreshed the list.",
    });
    expect(lib.renameDistrict).not.toHaveBeenCalled();
  });

  it("maps wrong_state and name_taken", async () => {
    signedIn();
    lib.renameDistrict.mockResolvedValueOnce({ kind: "wrong_state" });
    expect(await renameDistrictAction("alder-creek", { orgUnitId: U1, name: "X" })).toEqual({
      ok: false,
      error: "This district was just changed by someone else. We've refreshed the list.",
    });
    lib.renameDistrict.mockResolvedValueOnce({ kind: "name_taken" });
    expect((await renameDistrictAction("alder-creek", { orgUnitId: U1, name: "X" })).ok).toBe(false);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("archiveDistrictAction and restoreDistrictAction", () => {
  it("archive ok returns only the name (no counts, no deacon, no ids), and revalidates", async () => {
    signedIn();
    lib.archiveDistrict.mockResolvedValue({
      kind: "ok",
      name: "North District",
      householdCount: 4,
      openDeaconName: "Dee Deaconson",
    });
    const result = await archiveDistrictAction("alder-creek", { orgUnitId: U1 });
    expect(result).toEqual({ ok: true, data: { name: "North District" } });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/o/alder-creek/directory/parishes", "layout");
  });

  it("restore maps a name collision to the restore copy", async () => {
    signedIn();
    lib.restoreDistrict.mockResolvedValue({ kind: "name_taken" });
    expect(await restoreDistrictAction("alder-creek", { orgUnitId: U1 })).toEqual({
      ok: false,
      error: "Another district already uses that name. Rename that one first, or leave this one archived.",
    });
  });

  it("both refuse a malformed id before the library", async () => {
    signedIn();
    expect((await archiveDistrictAction("alder-creek", { orgUnitId: "x" })).ok).toBe(false);
    expect((await restoreDistrictAction("alder-creek", { orgUnitId: "x" })).ok).toBe(false);
    expect(lib.archiveDistrict).not.toHaveBeenCalled();
    expect(lib.restoreDistrict).not.toHaveBeenCalled();
  });

  it("a thrown error never leaks its message", async () => {
    signedIn();
    lib.archiveDistrict.mockRejectedValue(new Error("secret internal detail"));
    const result = await archiveDistrictAction("alder-creek", { orgUnitId: U1 });
    expect(result).toEqual({ ok: false, error: "We couldn't save that. Nothing was changed." });
  });
});
