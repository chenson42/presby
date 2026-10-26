/**
 * The shared acting-identity helper (tag ACT). `organizationId` is never client
 * input: the slug is re-resolved through the signed-in user's own memberships.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

import { resolveActingIdentity } from "./acting-identity";

afterEach(() => vi.clearAllMocks());

describe("resolveActingIdentity", () => {
  it("not signed in is a message, and the organization is never resolved", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await resolveActingIdentity("alder-creek")).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
  });

  it("resolves the slug with the session's own user id and returns both ids, never conflated", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "user-1", email: "a@example.invalid" } });
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "ok",
      org: { personId: "person-1", organizationId: "org-1" },
    });
    expect(await resolveActingIdentity("alder-creek")).toEqual({
      ok: true,
      userId: "user-1",
      email: "a@example.invalid",
      personId: "person-1",
      organizationId: "org-1",
    });
    expect(mockResolveOrgContext).toHaveBeenCalledWith("user-1", "alder-creek");
  });

  it("a slug the user has no active relationship with (not-found, forbidden, ended) is the same refusal", async () => {
    for (const kind of ["not-found", "forbidden", "ended"]) {
      mockAuth.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockResolveOrgContext.mockResolvedValueOnce({ kind });
      expect(await resolveActingIdentity("elsewhere"), kind).toEqual({
        ok: false,
        error: "You don't have access to that organization.",
      });
    }
  });

  it("a missing email is null, not undefined", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "ok",
      org: { personId: "p", organizationId: "o" },
    });
    const result = await resolveActingIdentity("alder-creek");
    expect(result.ok && result.email).toBeNull();
  });
});
