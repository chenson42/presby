// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/groups/<groupId>/edit`'s
 * page.tsx — docs/work-log/2026-08-26-groups-admin.md, Phase 4 commit 2.
 *
 * `describe("EditGroupPage — the derived-group-guard regression ...")`
 * BELOW IS THE SINGLE MOST IMPORTANT BLOCK IN THIS FILE — Phase 3's Edge
 * Cases & Risks named this explicitly, load-bearing, not optional polish:
 * "`[groupId]/edit/page.tsx` reachability on a derived id must resolve
 * through `getGroup()`'s `invalid_target` (→ 404/redirect), not a
 * client-side 'no edit button' omission." This test proves a request that
 * reaches this ROUTE directly with a derived group's id — bypassing
 * whatever links this app happens to render — gets rejected with a real
 * 404, and `EditGroupForm` is never rendered at all.
 *
 * `groups.test.ts`'s own "derived-group guard" suite proves the same thing
 * one layer down, at `getGroup()` itself, against a real Postgres
 * connection; this file proves the PAGE correctly acts on that result — the
 * two together are the full regression this pipeline's brief requires.
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

const getGroup = vi.fn();
vi.mock("@/lib/groups", () => ({
  getGroup: (...args: unknown[]) => getGroup(...args),
}));

vi.mock("../../actions", () => ({
  updateGroupAction: vi.fn(),
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

import EditGroupPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getGroup.mockReset();
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

describe("EditGroupPage — the derived-group-guard regression (Phase 3's load-bearing rule)", () => {
  it("a derived group's id (getGroup() returns invalid_target) is rejected with a real 404 — EditGroupForm is NEVER rendered", async () => {
    await baseline();
    // This is exactly what getGroup() returns for a derived group's id
    // (Session/Board of Deacons/Active Membership) — indistinguishable, on
    // purpose, from a nonexistent id (groups.test.ts's own derived-group
    // suite proves this at the query layer).
    getGroup.mockResolvedValue({ kind: "invalid_target" });

    await expect(
      EditGroupPage({ params: makeParams("alder-creek", "session-group-id") }),
    ).rejects.toThrow("NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("a genuinely nonexistent group id gets the identical 404 treatment — the guard does not leak which case it is", async () => {
    await baseline();
    getGroup.mockResolvedValue({ kind: "invalid_target" });

    await expect(
      EditGroupPage({ params: makeParams("alder-creek", "does-not-exist") }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("a real managed group's id renders EditGroupForm normally (the guard is not overbroad)", async () => {
    await baseline();
    getGroup.mockResolvedValue({
      kind: "ok",
      data: {
        groupId: "group-2",
        name: "Property Committee",
        description: "Handles building maintenance",
        meetsWhen: "First Monday",
        groupTypeName: "Committee",
        roster: [],
      },
    });

    const el = await EditGroupPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /edit group/i })).toBeTruthy();
    expect(screen.getByDisplayValue("Property Committee")).toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});

describe("EditGroupPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling getGroup()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await EditGroupPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.groups");
    expect(getGroup).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });
});

describe("EditGroupPage — getGroup() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    await baseline();
    getGroup.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(EditGroupPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    await baseline();
    getGroup.mockRejectedValue(new Error("connection reset"));

    const el = await EditGroupPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load group records right now/i),
    ).toBeTruthy();
  });

  it("renders GroupsForbidden for { kind: 'forbidden' }", async () => {
    await baseline();
    getGroup.mockResolvedValue({ kind: "forbidden" });

    const el = await EditGroupPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage groups/i),
    ).toBeTruthy();
  });
});

describe("EditGroupPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to this page when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(EditGroupPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fgroups%2Fgroup-2%2Fedit",
    );
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(EditGroupPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});
