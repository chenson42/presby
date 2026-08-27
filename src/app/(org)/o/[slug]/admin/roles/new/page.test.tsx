// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/roles/new`'s page.tsx — mirrors
 * `../page.test.tsx`'s own assertion style for the same reasons.
 *
 * What this file exists to pin:
 *   1. The auth/flag/gate chain matches every other `(org)` page.
 *   2. `listTemplateRoles()` DOUBLES AS THE `roles.manage` GATE for this
 *      page — `{ kind: "forbidden" }` renders `RoleDefinitionForbidden`
 *      WITHOUT ever calling `listPermissionCatalog()`.
 *   3. `OrgAccessError` from `listTemplateRoles()` is RE-THROWN, not
 *      swallowed.
 *   4. Any other thrown error renders `RoleDefinitionLoadError`.
 *   5. The ok path renders `<CreateRoleForm>` with both the catalog and the
 *      template list.
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

const listPermissionCatalog = vi.fn();
const listTemplateRoles = vi.fn();
vi.mock("@/lib/role-definitions", () => ({
  listPermissionCatalog: (...args: unknown[]) => listPermissionCatalog(...args),
  listTemplateRoles: (...args: unknown[]) => listTemplateRoles(...args),
}));

vi.mock("./actions", () => ({
  createRoleAction: vi.fn(),
  adoptTemplateAction: vi.fn(),
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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import NewRolePage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listPermissionCatalog.mockReset();
  listTemplateRoles.mockReset();
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

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

describe("NewRolePage — flag gate", () => {
  it("renders flag-off WITHOUT ever calling listTemplateRoles()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await NewRolePage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.roles");
    expect(listTemplateRoles).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });
});

describe("NewRolePage — listTemplateRoles() as the roles.manage gate", () => {
  it("renders RoleDefinitionForbidden WITHOUT calling listPermissionCatalog()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTemplateRoles.mockResolvedValue({ kind: "forbidden" });

    const el = await NewRolePage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to create or edit role definitions/i),
    ).toBeTruthy();
    expect(listPermissionCatalog).not.toHaveBeenCalled();
  });

  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTemplateRoles.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(NewRolePage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTemplateRoles.mockRejectedValue(new Error("connection reset"));

    const el = await NewRolePage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load that right now/i)).toBeTruthy();
  });
});

describe("NewRolePage — ok path", () => {
  it("renders the create-role form with the catalog and template list", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listTemplateRoles.mockResolvedValue({
      kind: "ok",
      templates: [
        {
          id: "template-1",
          key: "committee_chair",
          name: "Committee Chair",
          permissionKeys: ["directory.view"],
        },
      ],
    });
    listPermissionCatalog.mockResolvedValue([
      {
        key: "directory.view",
        module: "directory",
        description: "View the directory.",
        sensitivityTier: 1,
      },
    ]);

    const el = await NewRolePage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /create a role/i })).toBeTruthy();
    expect(screen.getByLabelText(/^key$/i, { selector: "#role-key" })).toBeTruthy();
    expect(screen.getByText(/or adopt a template/i)).toBeTruthy();
  });
});

describe("NewRolePage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to this page when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(NewRolePage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Froles%2Fnew",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(NewRolePage({ params: makeParams() })).rejects.toThrow(
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

    const el = await NewRolePage({ params: makeParams("bramblewood") });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(listTemplateRoles).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await NewRolePage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
