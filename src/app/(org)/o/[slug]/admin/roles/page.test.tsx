// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/roles`'s page.tsx.
 *
 * Everything this page delegates to is already tested elsewhere —
 * `resolveOrgContext`/`assertOrgAccess` in authz's own suite, `listGrants`/
 * `getGrantFormOptions`'s SQL correctness in role-grants.test.ts, the three
 * states' copy in roles-states.test.tsx, the table in roles-list.test.tsx,
 * the form in grant-role-form.test.tsx. What is NOT tested anywhere else,
 * and what this file exists to pin — mirroring
 * `directory/page.test.tsx`'s exact assertion style — is the ORDERING AND
 * ERROR-HANDLING CONTRACT the Phase 3 design and this pipeline's brief both
 * call mandatory:
 *
 *   1. `isFlagEnabled("org_portal.roles")` is checked BEFORE `listGrants()`
 *      is ever called — a congregation with the feature off must never pay
 *      for (or be exposed to) a permission-resolver round trip.
 *   2. `OrgAccessError` thrown by `listGrants()`/`getGrantFormOptions()` is
 *      RE-THROWN, not swallowed into the load-error state.
 *   3. Any OTHER thrown error renders the load-error state, not a crash.
 *   4. `{ kind: "forbidden" }` from `listGrants()` renders `RolesForbidden`
 *      WITHOUT ever calling `getGrantFormOptions()`.
 *   5. The ok path renders the roles table and the grant form.
 *
 * `./actions` is mocked even though page.tsx never imports it directly — it
 * is pulled in transitively by `<RolesList>` → `<RevokeDialog>` and by
 * `<GrantRoleForm>`, both real (unmocked) components rendered by this page,
 * and it is a "use server" module whose real implementation pulls
 * `@/lib/role-grants` into the module graph. Same reasoning as
 * `grant-role-form.test.tsx`'s header.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
vi.mock("@/lib/authz", () => {
  class MockOrgAccessError extends Error {
    constructor() {
      super("mock: no active membership");
      this.name = "OrgAccessError";
    }
  }
  return {
    OrgAccessError: MockOrgAccessError,
    resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
    assertOrgAccess: (...args: unknown[]) => assertOrgAccess(...args),
  };
});

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const listGrants = vi.fn();
const getGrantFormOptions = vi.fn();
vi.mock("@/lib/role-grants", () => ({
  listGrants: (...args: unknown[]) => listGrants(...args),
  getGrantFormOptions: (...args: unknown[]) => getGrantFormOptions(...args),
}));

vi.mock("./actions", () => ({
  grantRoleAction: vi.fn(),
  revokeRoleAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import RolesPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listGrants.mockReset();
  getGrantFormOptions.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
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

const EMPTY_OPTIONS = {
  kind: "ok" as const,
  options: { roles: [], people: [], groups: [] },
};

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

describe("RolesPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling listGrants()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await RolesPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.roles");
    expect(listGrants).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t turned on for Alder Creek/i),
    ).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag (the authoritative gate still runs)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await RolesPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("RolesPage — listGrants() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGrants.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(RolesPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGrants.mockRejectedValue(new Error("connection reset"));

    const el = await RolesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load role assignments right now/i),
    ).toBeTruthy();
    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/admin/roles");
  });
});

describe("RolesPage — getGrantFormOptions() error handling", () => {
  it("re-throws OrgAccessError from getGrantFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGrants.mockResolvedValue({ kind: "ok", grants: [] });
    getGrantFormOptions.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(RolesPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error from getGrantFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGrants.mockResolvedValue({ kind: "ok", grants: [] });
    getGrantFormOptions.mockRejectedValue(new Error("connection reset"));

    const el = await RolesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load role assignments right now/i),
    ).toBeTruthy();
  });
});

describe("RolesPage — result branches", () => {
  it("renders RolesForbidden when listGrants() returns { kind: 'forbidden' }, WITHOUT calling getGrantFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGrants.mockResolvedValue({ kind: "forbidden" });

    const el = await RolesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to grant or revoke roles/i),
    ).toBeTruthy();
    expect(getGrantFormOptions).not.toHaveBeenCalled();
  });

  it("renders the roles table and the grant form when both calls return ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGrants.mockResolvedValue({
      kind: "ok",
      grants: [
        {
          grantId: "grant-1",
          roleId: "role-1",
          roleKey: "stated_clerk",
          roleName: "Stated Clerk",
          grantee: {
            kind: "person",
            personId: "person-2",
            displayName: "Tobias Renwick",
            membershipEnded: null,
          },
          startsOn: "2023-01-08",
          grantedByEmail: "clerk@example.invalid",
          grantReason: null,
        },
      ],
    });
    getGrantFormOptions.mockResolvedValue({
      kind: "ok",
      options: {
        roles: [{ id: "role-1", key: "stated_clerk", name: "Stated Clerk" }],
        people: [{ personId: "person-2", displayName: "Tobias Renwick" }],
        groups: [],
      },
    });

    const el = await RolesPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^roles$/i })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    // The grant form's own role select carries the same catalog.
    expect(screen.getByRole("button", { name: /grant role/i })).toBeTruthy();
  });

  it("renders the empty-list state when listGrants() returns ok with zero grants", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGrants.mockResolvedValue({ kind: "ok", grants: [] });
    getGrantFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const el = await RolesPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/no roles are granted yet/i)).toBeTruthy();
    expect(
      screen.getByText(/no roles have been set up for this organization/i),
    ).toBeTruthy();
  });
});

describe("RolesPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/roles when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(RolesPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Froles",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(RolesPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await RolesPage({ params: makeParams("bramblewood") });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    // The whole-portal denial, never the roles page's own single-capability copy.
    expect(listGrants).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await RolesPage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
