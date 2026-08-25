// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/directory`'s page.tsx.
 *
 * Everything this page delegates to is already tested elsewhere —
 * `resolveOrgContext`/`assertOrgAccess` in authz's own suite,
 * `getDirectory()`'s privacy filtering (and, since Increment 2, its search
 * filter) in directory.test.ts, the four states' copy in
 * directory-states.test.tsx / directory-list.test.tsx, and `DirectoryGrid`'s
 * own card/search/empty-state rendering in directory-grid.test.tsx. What is
 * NOT tested anywhere else, and what this file exists to pin, is the
 * ORDERING AND ERROR-HANDLING CONTRACT the Phase 3 design and this
 * pipeline's brief both call mandatory:
 *
 *   1. `isFlagEnabled("org_portal.directory")` is checked BEFORE
 *      `getDirectory()` is ever called — a congregation with the feature
 *      off must never pay for (or be exposed to) a permission-resolver
 *      round trip.
 *   2. `OrgAccessError` thrown by `getDirectory()` is RE-THROWN, not
 *      swallowed into the load-error state — `[slug]/error.tsx` owns that
 *      copy.
 *   3. Any OTHER thrown error renders the load-error state, not a crash.
 *   4. `{ kind: "forbidden" }` and `{ kind: "ok", entries }` render the
 *      correct branch.
 *   5. (Increment 2) `isFlagEnabled("org_portal.directory_v2")` decides
 *      DirectoryList vs. DirectoryGrid — never which questions get asked,
 *      only which UI renders the SAME `getDirectory()` result. OFF passes
 *      no `opts` to `getDirectory()` at all (today's exact call shape,
 *      unaffected by whatever is in `?search=`); ON passes
 *      `{ search }` through from `searchParams`.
 *
 * `@/lib/storage/blob-store` is mocked wholesale, not because this file
 * tests avatar rendering (it doesn't — that's `directory-grid.test.tsx`'s
 * job), but because `page.tsx` statically imports `./directory-grid` →
 * `./person-avatar` → `@/lib/storage/blob-store` → `@/lib/db`, and `@/lib/db`
 * opens a real connection pool at module-import time and throws when
 * DATABASE_URL is unset (this file's own environment, same as every other
 * mocked-suite test in this tree). Mocking the module one hop before
 * `@/lib/db` keeps that import chain from ever being evaluated for real,
 * the same reason `@/lib/directory` itself is mocked below rather than
 * imported.
 *
 * Every collaborator is mocked; this file makes no DB connection. The mock
 * `@/lib/authz` module supplies a REAL (mock-module-scoped) `OrgAccessError`
 * class rather than a bare Error, because the page's `instanceof` check is
 * exactly what's under test — a stub with the same name would pass a
 * message-matching assertion but not this one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
const hasPermission = vi.fn();
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
    hasPermission: (...args: unknown[]) => hasPermission(...args),
  };
});

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const getDirectory = vi.fn();
const getHouseholds = vi.fn();
vi.mock("@/lib/directory", () => ({
  getDirectory: (...args: unknown[]) => getDirectory(...args),
  getHouseholds: (...args: unknown[]) => getHouseholds(...args),
}));

vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({
    resolve: vi.fn().mockResolvedValue(null),
    resolveMeta: vi.fn().mockResolvedValue(null),
    store: vi.fn(),
  }),
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

import DirectoryPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  hasPermission.mockReset().mockResolvedValue(false);
  getDirectory.mockReset();
  getHouseholds.mockReset();
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

function makeSearchParams(
  overrides: { search?: string; view?: string } = {},
) {
  return Promise.resolve(overrides);
}

/** directory ON, directory_v2 OFF — today's exact flag-resolution shape. */
function mockFlagsV1Only() {
  isFlagEnabled.mockImplementation((key: string) =>
    Promise.resolve(key === "org_portal.directory"),
  );
}

/** directory ON, directory_v2 ON. */
function mockFlagsV2() {
  isFlagEnabled.mockImplementation((key: string) =>
    Promise.resolve(
      key === "org_portal.directory" || key === "org_portal.directory_v2",
    ),
  );
}

describe("DirectoryPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling getDirectory()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.directory");
    expect(getDirectory).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t available for Alder Creek/i),
    ).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag (the authoritative gate still runs)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("DirectoryPage — getDirectory() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV1Only();
    getDirectory.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(
      DirectoryPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV1Only();
    getDirectory.mockRejectedValue(new Error("connection reset"));

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/couldn.t load the directory right now/i),
    ).toBeTruthy();
    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/directory");
  });
});

describe("DirectoryPage — result branches (org_portal.directory_v2 OFF, the regression floor)", () => {
  it("renders the forbidden state when getDirectory() returns { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV1Only();
    getDirectory.mockResolvedValue({ kind: "forbidden" });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
  });

  it("renders the entry list when getDirectory() returns ok, called with NO opts", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV1Only();
    getDirectory.mockResolvedValue({
      kind: "ok",
      entries: [
        {
          personId: "c1",
          firstName: "Marguerite",
          lastName: "Ashcombe",
          preferredName: null,
          email: null,
          phone: null,
          address: null,
          dateOfBirth: null,
          photoKey: null,
        },
      ],
    });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams({ search: "ignored while v2 is off" }),
    });
    render(el);

    expect(screen.getByText("Marguerite Ashcombe")).toBeTruthy();
    // Increment 2's contract: v2 OFF means today's exact call shape — no
    // third argument at all, regardless of what's in the URL.
    expect(getDirectory).toHaveBeenCalledWith("person-1", "org-1", undefined);
  });

  it("renders zero visible members honestly when getDirectory() returns ok with no entries", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV1Only();
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/no one is listed in the directory yet/i),
    ).toBeTruthy();
  });
});

describe("DirectoryPage — org_portal.directory_v2 ON", () => {
  it("passes the trimmed search param through to getDirectory()'s opts and renders the grid", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    getDirectory.mockResolvedValue({
      kind: "ok",
      entries: [
        {
          personId: "c1",
          firstName: "Marguerite",
          lastName: "Ashcombe",
          preferredName: null,
          email: "m.ashcombe@example.invalid",
          phone: null,
          address: null,
          dateOfBirth: null,
          photoKey: null,
        },
      ],
    });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams({ search: "  marguerite  " }),
    });
    render(el);

    expect(getDirectory).toHaveBeenCalledWith("person-1", "org-1", {
      search: "marguerite",
    });
    expect(getHouseholds).not.toHaveBeenCalled();
    expect(screen.getByText("Marguerite Ashcombe")).toBeTruthy();
    expect(screen.getByText(/showing 1 member/i)).toBeTruthy();
    // The search box round-trips the (trimmed) query as its default value.
    const searchBox = screen.getByLabelText(/search the directory/i);
    expect((searchBox as HTMLInputElement).value).toBe("marguerite");
    // Increment 3: the Members/Households toggle renders on the v2 path,
    // with "Members" marked current.
    const membersTab = screen.getByRole("link", { name: "Members" });
    expect(membersTab.getAttribute("aria-current")).toBe("page");
    const householdsTab = screen.getByRole("link", { name: "Households" });
    expect(householdsTab.getAttribute("aria-current")).toBeNull();
    expect(householdsTab.getAttribute("href")).toBe(
      "/o/alder-creek/directory?view=households&search=marguerite",
    );
  });

  it("renders the zero-match copy, naming the search back, when getDirectory() returns no entries with a search present", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams({ search: "zzz-nobody" }),
    });
    render(el);

    expect(screen.getByText(/no matches for.*zzz-nobody/i)).toBeTruthy();
  });

  it("renders the empty-directory copy (not the zero-match copy) when there is no search", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/no one is listed in Alder Creek.*directory yet/i),
    ).toBeTruthy();
    expect(screen.queryByText(/no matches for/i)).toBeNull();
  });
});

describe("DirectoryPage — ?view=households (Increment 3, directory_v2 ON only)", () => {
  it("calls getHouseholds(), never getDirectory(), and renders household cards", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    getHouseholds.mockResolvedValue({
      kind: "ok",
      households: [
        {
          householdId: "h1",
          name: "The Renwick Family",
          city: "Fixtureville",
          region: "OH",
          memberCount: 3,
          deaconName: null,
        },
      ],
    });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams({ view: "households" }),
    });
    render(el);

    expect(getHouseholds).toHaveBeenCalledWith("person-1", "org-1", {
      search: "",
    });
    expect(getDirectory).not.toHaveBeenCalled();
    expect(screen.getByText("The Renwick Family")).toBeTruthy();
    expect(screen.getByText(/3 members/i)).toBeTruthy();
    const householdsTab = screen.getByRole("link", { name: "Households" });
    expect(householdsTab.getAttribute("aria-current")).toBe("page");
  });

  it("passes the trimmed search through to getHouseholds()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams({ view: "households", search: "  renwick  " }),
    });

    expect(getHouseholds).toHaveBeenCalledWith("person-1", "org-1", {
      search: "renwick",
    });
  });

  it("renders the forbidden state when getHouseholds() returns { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    getHouseholds.mockResolvedValue({ kind: "forbidden" });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams({ view: "households" }),
    });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
  });

  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    getHouseholds.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(
      DirectoryPage({
        params: makeParams(),
        searchParams: makeSearchParams({ view: "households" }),
      }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("ignores ?view=households when directory_v2 is OFF — the v1 regression floor never branches on it", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV1Only();
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams({ view: "households" }),
    });
    render(el);

    expect(getHouseholds).not.toHaveBeenCalled();
    expect(getDirectory).toHaveBeenCalledWith("person-1", "org-1", undefined);
    expect(screen.queryByRole("link", { name: "Households" })).toBeNull();
  });
});

describe("DirectoryPage — Increment 4 (directory.view_hidden, Parishes tab)", () => {
  it("an ordinary viewer (hasPermission false, the default) never sees a Parishes tab, and getDirectory() is called without includeHidden", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(screen.queryByRole("link", { name: "Parishes" })).toBeNull();
    expect(getDirectory).toHaveBeenCalledWith("person-1", "org-1", {
      search: "",
    });
  });

  it("an elevated viewer (hasPermission true) sees a Parishes tab linking to the roster, and getDirectory() is called with includeHidden: true", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    hasPermission.mockResolvedValue(true);
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    const parishesTab = screen.getByRole("link", { name: "Parishes" });
    expect(parishesTab.getAttribute("href")).toBe(
      "/o/alder-creek/directory/parishes",
    );
    expect(hasPermission).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "directory.view_hidden",
    );
    expect(getDirectory).toHaveBeenCalledWith("person-1", "org-1", {
      search: "",
      includeHidden: true,
    });
  });

  it("hasPermission is never called when directory_v2 is OFF — Parishes rides on the SAME flag as the rest of Increment 4", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV1Only();
    getDirectory.mockResolvedValue({ kind: "ok", entries: [] });

    await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });

    expect(hasPermission).not.toHaveBeenCalled();
  });

  it("?view=households also gets includeHidden: true for an elevated viewer, and shows the Parishes tab", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsV2();
    hasPermission.mockResolvedValue(true);
    getHouseholds.mockResolvedValue({ kind: "ok", households: [] });

    const el = await DirectoryPage({
      params: makeParams(),
      searchParams: makeSearchParams({ view: "households" }),
    });
    render(el);

    expect(getHouseholds).toHaveBeenCalledWith("person-1", "org-1", {
      search: "",
      includeHidden: true,
    });
    expect(screen.getByRole("link", { name: "Parishes" })).toBeTruthy();
  });
});

describe("DirectoryPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to the directory when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(
      DirectoryPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fdirectory");
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(
      DirectoryPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await DirectoryPage({
      params: makeParams("bramblewood"),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    // The whole-portal denial, never the directory's own single-feature copy.
    expect(getDirectory).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await DirectoryPage({
      params: makeParams("fernwood"),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
