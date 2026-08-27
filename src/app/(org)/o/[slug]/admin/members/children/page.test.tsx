// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/members/children`'s page.tsx —
 * the roster (docs/work-log/2026-08-26-childrens-ministry.md, Phase 3,
 * Increment A). Checked bare (no org toggle), gated on `children.roster`
 * inside `getChildrenRoster()` itself.
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

const getChildrenRoster = vi.fn();
vi.mock("@/lib/children", () => ({
  getChildrenRoster: (...args: unknown[]) => getChildrenRoster(...args),
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
}));

import ChildrenRosterPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getChildrenRoster.mockReset();
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

describe("ChildrenRosterPage — gate composition (bare flag, no org toggle)", () => {
  it("flag off → renders flag-off, never looks up the roster", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await ChildrenRosterPage({ params: makeParams() });
    render(el);

    expect(getChildrenRoster).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for/i)).toBeTruthy();
  });
});

describe("ChildrenRosterPage — children.roster permission collapse", () => {
  it("forbidden → shared MembersForbidden state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getChildrenRoster.mockResolvedValue({ kind: "forbidden" });

    const el = await ChildrenRosterPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
  });

  it("re-throws OrgAccessError", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getChildrenRoster.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(ChildrenRosterPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getChildrenRoster.mockRejectedValue(new Error("connection reset"));

    const el = await ChildrenRosterPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/couldn.t load this right now/i)).toBeTruthy();
  });

  it("ok with zero children renders the empty state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getChildrenRoster.mockResolvedValue({ kind: "ok", children: [] });

    const el = await ChildrenRosterPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: /children.s roster/i }),
    ).toBeTruthy();
    expect(screen.getByText(/no children recorded yet/i)).toBeTruthy();
  });

  it("ok with children renders each row", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getChildrenRoster.mockResolvedValue({
      kind: "ok",
      children: [
        {
          personId: "child-1",
          firstName: "Hallie",
          lastName: "Vandermeer",
          preferredName: null,
          dateOfBirth: "2011-03-08",
          ageYears: 15,
          householdId: "h-1",
          householdName: "The Renwick Family",
          guardianCount: 1,
        },
      ],
    });

    const el = await ChildrenRosterPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/Hallie Vandermeer/i)).toBeTruthy();
    expect(screen.getByText(/Age 15/i)).toBeTruthy();
  });
});
