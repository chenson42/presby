/**
 * Orchestration tests for `findPersonAction()` — the zero/one/many/forbidden
 * branching and the identity-re-derivation contract. `findPersonMatches()`'s
 * own SQL (the permission check, the eligibility predicate, the ILIKE match)
 * is exercised for real against Postgres in `find-person.test.ts`; every
 * collaborator here is mocked, so this file makes no DB connection.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => auth(),
}));

const resolveOrgContext = vi.fn();
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
}));

const findPersonMatches = vi.fn();
vi.mock("@/lib/org-portal/find-person", () => ({
  findPersonMatches: (...args: unknown[]) => findPersonMatches(...args),
}));

import { findPersonAction } from "./find-person-action";

afterEach(() => {
  auth.mockReset();
  resolveOrgContext.mockReset();
  findPersonMatches.mockReset();
});

const OK_RESOLVED = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};

describe("findPersonAction — the fast paths that never touch the DB search", () => {
  it("falls through on a blank query without calling auth() at all", async () => {
    const result = await findPersonAction("alder-creek", "   ");
    expect(result).toEqual({
      kind: "fallthrough",
      href: "/o/alder-creek/directory?search=",
    });
    expect(auth).not.toHaveBeenCalled();
  });

  it("falls through when there is no session", async () => {
    auth.mockResolvedValue(null);
    const result = await findPersonAction("alder-creek", "marguerite");
    expect(result).toEqual({
      kind: "fallthrough",
      href: "/o/alder-creek/directory?search=marguerite",
    });
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("falls through when resolveOrgContext does not resolve 'ok' (forbidden/ended/not-found)", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "forbidden" });
    const result = await findPersonAction("alder-creek", "marguerite");
    expect(result).toEqual({
      kind: "fallthrough",
      href: "/o/alder-creek/directory?search=marguerite",
    });
    expect(findPersonMatches).not.toHaveBeenCalled();
  });
});

describe("findPersonAction — identity re-derivation", () => {
  it("re-derives personId/organizationId from the session, not from any caller-supplied value", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    findPersonMatches.mockResolvedValue({ kind: "ok", personIds: [] });

    await findPersonAction("alder-creek", "marguerite");

    expect(resolveOrgContext).toHaveBeenCalledWith("u1", "alder-creek");
    expect(findPersonMatches).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "marguerite",
    );
  });
});

describe("findPersonAction — zero/one/many/forbidden branching", () => {
  it("falls through on zero matches", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    findPersonMatches.mockResolvedValue({ kind: "ok", personIds: [] });

    const result = await findPersonAction("alder-creek", "nobody");
    expect(result.kind).toBe("fallthrough");
    expect(result.href).toBe("/o/alder-creek/directory?search=nobody");
  });

  it("redirects to the real person-detail route (Increment 3) on exactly one match", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    findPersonMatches.mockResolvedValue({ kind: "ok", personIds: ["c1"] });

    const result = await findPersonAction("alder-creek", "marguerite");
    expect(result).toEqual({
      kind: "redirect",
      href: "/o/alder-creek/directory/c1",
    });
  });

  it("falls through on many matches", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    findPersonMatches.mockResolvedValue({ kind: "ok", personIds: ["c1", "c2"] });

    const result = await findPersonAction("alder-creek", "smith");
    expect(result.kind).toBe("fallthrough");
  });

  it("falls through when findPersonMatches reports forbidden (no directory.view grant)", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    findPersonMatches.mockResolvedValue({ kind: "forbidden" });

    const result = await findPersonAction("alder-creek", "marguerite");
    expect(result.kind).toBe("fallthrough");
    expect(result.href).toBe("/o/alder-creek/directory?search=marguerite");
  });
});

describe("findPersonAction — failure handling", () => {
  it("fails closed to the fallthrough on a thrown error, never rejects", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    findPersonMatches.mockRejectedValue(new Error("connection reset"));

    await expect(findPersonAction("alder-creek", "marguerite")).resolves.toEqual({
      kind: "fallthrough",
      href: "/o/alder-creek/directory?search=marguerite",
    });
  });
});
