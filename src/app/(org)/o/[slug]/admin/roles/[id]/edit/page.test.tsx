// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/roles/[id]/edit`'s page.tsx.
 *
 * What this file exists to pin:
 *   1. The auth/flag/gate chain matches every other `(org)` page.
 *   2. `getRoleDefinition()`'s three result kinds (`forbidden`, `not_found`,
 *      `ok`) each render the DISTINCT state Phase 3 named.
 *   3. `ok` + `role.isProtected === true` renders `RoleDefinitionProtected`
 *      instead of the editable form — `isProtected` is the gate, checked
 *      by the PAGE, not a fourth result-kind from `getRoleDefinition()`.
 *   4. `OrgAccessError` is re-thrown; any other thrown error renders
 *      `RoleDefinitionLoadError`.
 *   5. The ok, non-protected path renders `<EditRoleForm>` and
 *      `<DeactivateRoleDialog>`.
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

const getRoleDefinition = vi.fn();
const listPermissionCatalog = vi.fn();
vi.mock("@/lib/role-definitions", () => ({
  getRoleDefinition: (...args: unknown[]) => getRoleDefinition(...args),
  listPermissionCatalog: (...args: unknown[]) => listPermissionCatalog(...args),
}));

vi.mock("./actions", () => ({
  setRolePermissionsAction: vi.fn(),
  deactivateRoleAction: vi.fn(),
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

import EditRolePage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getRoleDefinition.mockReset();
  listPermissionCatalog.mockReset();
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

function makeParams(slug = "alder-creek", id = "role-1") {
  return Promise.resolve({ slug, id });
}

const CUSTOM_ROLE = {
  id: "role-1",
  key: "worship_committee",
  name: "Worship Committee",
  roleKind: "custom",
  isProtected: false,
  deactivatedAt: null,
  permissionKeys: ["directory.view"],
  holderCount: 2,
};

describe("EditRolePage — flag gate", () => {
  it("renders flag-off WITHOUT ever calling getRoleDefinition()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await EditRolePage({ params: makeParams() });
    render(el);

    expect(getRoleDefinition).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });
});

describe("EditRolePage — getRoleDefinition() result kinds", () => {
  it("renders RoleDefinitionForbidden for { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getRoleDefinition.mockResolvedValue({ kind: "forbidden" });

    const el = await EditRolePage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to create or edit role definitions/i),
    ).toBeTruthy();
    expect(listPermissionCatalog).not.toHaveBeenCalled();
  });

  it("renders RoleDefinitionNotFound for { kind: 'not_found' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getRoleDefinition.mockResolvedValue({ kind: "not_found" });

    const el = await EditRolePage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/that role no longer exists at this organization/i),
    ).toBeTruthy();
  });

  it("renders RoleDefinitionProtected, no form, when role.isProtected is true", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getRoleDefinition.mockResolvedValue({
      kind: "ok",
      role: { ...CUSTOM_ROLE, id: "role-admin", isProtected: true, name: "Role Administrator", key: "role_admin" },
    });

    const el = await EditRolePage({ params: makeParams("alder-creek", "role-admin") });
    render(el);

    expect(screen.getByText(/can.t be edited or deactivated here/i)).toBeTruthy();
    expect(listPermissionCatalog).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getRoleDefinition.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(EditRolePage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getRoleDefinition.mockRejectedValue(new Error("connection reset"));

    const el = await EditRolePage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load that right now/i)).toBeTruthy();
  });
});

describe("EditRolePage — ok, non-protected path", () => {
  it("renders the edit form and the deactivate dialog", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getRoleDefinition.mockResolvedValue({ kind: "ok", role: CUSTOM_ROLE });
    listPermissionCatalog.mockResolvedValue([
      {
        key: "directory.view",
        module: "directory",
        description: "View the directory.",
        sensitivityTier: 1,
      },
    ]);

    const el = await EditRolePage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /edit role/i })).toBeTruthy();
    expect(screen.getByText("Worship Committee")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /deactivate role/i }),
    ).toBeTruthy();
  });
});

describe("EditRolePage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to this page when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(EditRolePage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Froles%2Frole-1%2Fedit",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(EditRolePage({ params: makeParams() })).rejects.toThrow(
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

    const el = await EditRolePage({
      params: makeParams("bramblewood"),
    });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(getRoleDefinition).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await EditRolePage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
