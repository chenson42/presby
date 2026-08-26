// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/members/<id>/edit`'s page.tsx —
 * same gate-composition contract as `admin/members/new/page.test.tsx`, plus
 * the person-lookup three-way split (`ok` / `forbidden` / `not_found`).
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

const isOrgFeatureEnabled = vi.fn();
vi.mock("@/lib/org-features", () => ({
  isOrgFeatureEnabled: (...args: unknown[]) => isOrgFeatureEnabled(...args),
}));

const getHouseholds = vi.fn();
vi.mock("@/lib/directory", () => ({
  getHouseholds: (...args: unknown[]) => getHouseholds(...args),
}));

const getPersonForEdit = vi.fn();
vi.mock("@/lib/people", () => ({
  getPersonForEdit: (...args: unknown[]) => getPersonForEdit(...args),
}));

vi.mock("./actions", () => ({
  updatePersonAction: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

import EditMemberPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  isOrgFeatureEnabled.mockReset();
  getHouseholds.mockReset();
  getPersonForEdit.mockReset();
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

const PERSON = {
  personId: "p-1",
  firstName: "Nora",
  lastName: "Ashgrove",
  middleName: null,
  preferredName: null,
  suffix: null,
  email: "nora@example.invalid",
  phone: null,
  address: null,
  householdId: null,
};

function makeParams(slug = "alder-creek", id = "p-1") {
  return Promise.resolve({ slug, id });
}

describe("EditMemberPage — gate composition (DECISION-097)", () => {
  it("flag off → renders flag-off, never looks up the person", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(isOrgFeatureEnabled).not.toHaveBeenCalled();
    expect(getPersonForEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("flag on but org toggle off → renders the SAME flag-off copy (no axis leak)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(false);

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(getPersonForEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });

  it("both on and the person is found → renders the edit form prefilled", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "ok", person: PERSON });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /edit person/i })).toBeTruthy();
    expect(
      (screen.getByLabelText(/^first name$/i) as HTMLInputElement).value,
    ).toBe("Nora");
  });
});

describe("EditMemberPage — person lookup", () => {
  it("forbidden → renders the shared MembersForbidden state, not a 404", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "forbidden" });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("not_found → calls next/navigation's notFound()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockResolvedValue({ kind: "not_found" });
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    await expect(EditMemberPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("re-throws OrgAccessError", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(EditMemberPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    getPersonForEdit.mockRejectedValue(new Error("connection reset"));

    const el = await EditMemberPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load this right now/i)).toBeTruthy();
  });
});
