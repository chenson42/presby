// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/groups/<groupId>`'s page.tsx —
 * docs/work-log/2026-08-26-groups-admin.md, Phase 4 commit 2. Mirrors
 * `officers/[personId]/page.test.tsx`'s style.
 *
 * `getGroup()`'s `invalid_target` → `notFound()` here is the SAME
 * derived-group-guard rule the sibling `edit/page.test.tsx` proves in full —
 * pinned again here because the roster/"End membership" surface is reached
 * through this route, not just the edit form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const getGroup = vi.fn();
const getGroupFormOptions = vi.fn();
vi.mock("@/lib/groups", () => ({
  getGroup: (...args: unknown[]) => getGroup(...args),
  getGroupFormOptions: (...args: unknown[]) => getGroupFormOptions(...args),
}));

vi.mock("../actions", () => ({
  addGroupMemberAction: vi.fn(),
  endGroupMembershipAction: vi.fn(),
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
  useRouter: () => ({ refresh: vi.fn() }),
}));

import GroupDetailPage from "./page";
import { OrgAccessError } from "@/lib/authz";

beforeEach(() => {
  getGroupFormOptions.mockResolvedValue({
    kind: "ok",
    data: { groupTypes: [], people: [] },
  });
});

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getGroup.mockReset();
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

function makeParams(slug = "alder-creek", groupId = "group-2") {
  return Promise.resolve({ slug, groupId });
}

async function baseline() {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
  isFlagEnabled.mockResolvedValue(true);
}

describe("GroupDetailPage — derived-group-guard: invalid_target is a real 404", () => {
  it("a derived group's id resolves invalid_target and calls notFound(), never rendering the roster", async () => {
    await baseline();
    getGroup.mockResolvedValue({ kind: "invalid_target" });

    await expect(
      GroupDetailPage({ params: makeParams("alder-creek", "session-group-id") }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("GroupDetailPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling getGroup()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await GroupDetailPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.groups");
    expect(getGroup).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });
});

describe("GroupDetailPage — getGroup() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    await baseline();
    getGroup.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(GroupDetailPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    await baseline();
    getGroup.mockRejectedValue(new Error("connection reset"));

    const el = await GroupDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load group records right now/i),
    ).toBeTruthy();
  });
});

describe("GroupDetailPage — result branches", () => {
  it("renders GroupsForbidden for { kind: 'forbidden' }", async () => {
    await baseline();
    getGroup.mockResolvedValue({ kind: "forbidden" });

    const el = await GroupDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage groups/i),
    ).toBeTruthy();
  });

  it("renders the group's name, roster table, edit link, and add-member form when ok", async () => {
    await baseline();
    getGroup.mockResolvedValue({
      kind: "ok",
      data: {
        groupId: "group-2",
        name: "Property Committee",
        description: "Handles building maintenance",
        meetsWhen: "First Monday",
        groupTypeName: "Committee",
        roster: [
          {
            groupMembershipId: "gm-1",
            personId: "person-3",
            displayName: "Tobias Renwick",
            groupRole: "chair",
            startsOn: "2026-01-01",
            endsOn: null,
          },
        ],
      },
    });

    const el = await GroupDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: /property committee/i }),
    ).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Tobias Renwick")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /edit group/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /end membership/i }),
    ).toBeTruthy();
  });

  it("renders the empty-roster state when the group has zero members", async () => {
    await baseline();
    getGroup.mockResolvedValue({
      kind: "ok",
      data: {
        groupId: "group-2",
        name: "Property Committee",
        description: null,
        meetsWhen: null,
        groupTypeName: "Committee",
        roster: [],
      },
    });

    const el = await GroupDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/no members yet/i)).toBeTruthy();
  });
});
