// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/groups`'s page.tsx — docs/
 * work-log/2026-08-26-groups-admin.md, Phase 4 commit 2. Mirrors
 * `officers/page.test.tsx`'s exact assertion style: the ordering and
 * error-handling contract, not the SQL correctness already proven in
 * `groups.test.ts`.
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

const listGroups = vi.fn();
const listDerivedGroups = vi.fn();
vi.mock("@/lib/groups", () => ({
  listGroups: (...args: unknown[]) => listGroups(...args),
  listDerivedGroups: (...args: unknown[]) => listDerivedGroups(...args),
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

import GroupsPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listGroups.mockReset();
  listDerivedGroups.mockReset();
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

describe("GroupsPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling listGroups()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await GroupsPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.groups");
    expect(listGroups).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await GroupsPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("GroupsPage — listGroups() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGroups.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(GroupsPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGroups.mockRejectedValue(new Error("connection reset"));

    const el = await GroupsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load group records right now/i),
    ).toBeTruthy();
  });
});

describe("GroupsPage — result branches", () => {
  it("renders GroupsForbidden when listGroups() returns { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGroups.mockResolvedValue({ kind: "forbidden" });

    const el = await GroupsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage groups/i),
    ).toBeTruthy();
  });

  it("renders the list and a 'New group' link when ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGroups.mockResolvedValue({
      kind: "ok",
      data: [
        {
          groupId: "group-1",
          name: "Property Committee",
          groupTypeName: "Committee",
          memberCount: 3,
        },
      ],
    });
    listDerivedGroups.mockResolvedValue({ kind: "ok", data: [] });

    const el = await GroupsPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /^groups$/i })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Property Committee")).toBeTruthy();
    const newGroupLink = screen.getByRole("link", { name: /new group/i });
    expect(newGroupLink.getAttribute("href")).toBe(
      "/o/alder-creek/admin/groups/new",
    );
  });

  it("renders the empty state when listGroups() returns ok with zero entries", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGroups.mockResolvedValue({ kind: "ok", data: [] });
    listDerivedGroups.mockResolvedValue({ kind: "ok", data: [] });

    const el = await GroupsPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/no committees or groups yet/i)).toBeTruthy();
  });
});

describe("GroupsPage — listDerivedGroups() renders the 'Automatic rosters' section", () => {
  it("only calls listDerivedGroups() after listGroups() resolves ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGroups.mockResolvedValue({ kind: "forbidden" });

    await GroupsPage({ params: makeParams() });

    expect(listDerivedGroups).not.toHaveBeenCalled();
  });

  it("renders derived rows with their member counts and no 'New group'-style affordance beside them", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGroups.mockResolvedValue({ kind: "ok", data: [] });
    listDerivedGroups.mockResolvedValue({
      kind: "ok",
      data: [
        {
          groupId: "session-1",
          name: "Session",
          groupTypeName: "Court",
          memberCount: 7,
          derivedFrom: "session",
        },
        {
          groupId: "roster-1",
          name: "Active Membership",
          groupTypeName: "Roster",
          memberCount: 210,
          derivedFrom: "active_membership",
        },
      ],
    });

    const el = await GroupsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: /automatic rosters/i }),
    ).toBeTruthy();
    expect(screen.getByText("Session")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    const officersLink = screen.getByRole("link", { name: /officers/i });
    expect(officersLink.getAttribute("href")).toBe(
      "/o/alder-creek/admin/officers",
    );
    expect(
      screen.queryByRole("link", { name: /^session$/i }),
    ).toBeNull();
  });

  it("renders the load-error state when listDerivedGroups() throws a non-OrgAccessError", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listGroups.mockResolvedValue({ kind: "ok", data: [] });
    listDerivedGroups.mockRejectedValue(new Error("connection reset"));

    const el = await GroupsPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load group records right now/i),
    ).toBeTruthy();
  });
});

describe("GroupsPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/groups when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(GroupsPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgroups",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(GroupsPage({ params: makeParams() })).rejects.toThrow(
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

    const el = await GroupsPage({ params: makeParams("bramblewood") });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(listGroups).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await GroupsPage({ params: makeParams("fernwood") });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
