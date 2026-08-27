// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/groups/new`'s page.tsx — docs/
 * work-log/2026-08-26-groups-admin.md, Phase 4 commit 2. Mirrors
 * `admin/members/new/page.test.tsx`'s style for the ordering/error-handling
 * contract.
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

const getGroupFormOptions = vi.fn();
vi.mock("@/lib/groups", () => ({
  getGroupFormOptions: (...args: unknown[]) => getGroupFormOptions(...args),
}));

vi.mock("../actions", () => ({ createGroupAction: vi.fn() }));
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

import NewGroupPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getGroupFormOptions.mockReset();
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

describe("NewGroupPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling getGroupFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await NewGroupPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.groups");
    expect(getGroupFormOptions).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });
});

describe("NewGroupPage — getGroupFormOptions() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGroupFormOptions.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(NewGroupPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGroupFormOptions.mockRejectedValue(new Error("connection reset"));

    const el = await NewGroupPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load group records right now/i),
    ).toBeTruthy();
  });
});

describe("NewGroupPage — result branches", () => {
  it("renders GroupsForbidden for { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGroupFormOptions.mockResolvedValue({ kind: "forbidden" });

    const el = await NewGroupPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage groups/i),
    ).toBeTruthy();
  });

  it("renders the form when ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getGroupFormOptions.mockResolvedValue({
      kind: "ok",
      data: {
        groupTypes: [{ id: "type-1", key: "committee", name: "Committee" }],
        people: [{ personId: "person-2", displayName: "Tobias Renwick" }],
      },
    });

    const el = await NewGroupPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /new group/i })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /create group/i }),
    ).toBeTruthy();
  });
});

describe("NewGroupPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(NewGroupPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgroups%2Fnew",
    );
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(NewGroupPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});
