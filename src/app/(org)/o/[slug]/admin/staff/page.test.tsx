// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/staff`'s page.tsx —
 * staff-and-personnel Phase 3, ux-developer slice.
 *
 * Everything this page delegates to is already tested elsewhere —
 * `resolveOrgContext`/`assertOrgAccess` in authz's own suite,
 * `listStaffRoster`/`getStaffFormOptions`'s SQL correctness in
 * `staff.test.ts`, the three states' copy in `staff-states.test.tsx`, the
 * table in `staff-roster.test.tsx`, the form in
 * `add-staff-position-form.test.tsx`. What is NOT tested anywhere else, and
 * what this file exists to pin — mirroring
 * `admin/officers/page.test.tsx`'s exact assertion style — is the ORDERING
 * AND ERROR-HANDLING CONTRACT:
 *
 *   1. `isFlagEnabled("org_portal.staff")` is checked BEFORE
 *      `listStaffRoster()` is ever called.
 *   2. `OrgAccessError` thrown by `listStaffRoster()`/`getStaffFormOptions()`
 *      is RE-THROWN, not swallowed into the load-error state.
 *   3. Any OTHER thrown error renders the load-error state, not a crash.
 *   4. `{ kind: "forbidden" }` from `listStaffRoster()` renders
 *      `StaffForbidden` WITHOUT ever calling `getStaffFormOptions()`.
 *   5. The ok path renders the roster table and the add-position form.
 *   6. `?includeEnded=1` is threaded through to `listStaffRoster()`'s
 *      `includeEnded` option, and the toggle link points the OTHER
 *      direction from whichever state is currently showing.
 *   7. `canCreatePeople` is computed via `hasPermission(..., "people.manage")`
 *      and passed to the form (the architect's visible-permission-split
 *      ruling) — this is asserted through `hasPermission`'s call args, since
 *      the form's own rendering of that prop is `add-staff-position-form.
 *      test.tsx`'s job, not this file's.
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

const listStaffRoster = vi.fn();
const getStaffFormOptions = vi.fn();
// A plain, full mock — none of this page's rendered children
// (`StaffRoster`, `AddStaffPositionForm`, `EndPositionDialog`) import a
// RUNTIME value from `@/lib/staff` (only types), so there is no real export
// to preserve via `importActual` here. Mirrors `admin/officers/page.test.
// tsx`'s identical full-mock shape.
vi.mock("@/lib/staff", () => ({
  listStaffRoster: (...args: unknown[]) => listStaffRoster(...args),
  getStaffFormOptions: (...args: unknown[]) => getStaffFormOptions(...args),
}));

vi.mock("./actions", () => ({
  startStaffPositionAction: vi.fn(),
  endStaffPositionAction: vi.fn(),
  createStaffPersonAction: vi.fn(),
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

import StaffPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  hasPermission.mockReset().mockResolvedValue(false);
  isFlagEnabled.mockReset();
  listStaffRoster.mockReset();
  getStaffFormOptions.mockReset();
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

const EMPTY_OPTIONS = { kind: "ok" as const, data: { people: [] } };

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}
function makeSearchParams(includeEnded?: string) {
  return Promise.resolve({ includeEnded });
}

describe("StaffPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling listStaffRoster()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await StaffPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.staff");
    expect(listStaffRoster).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });

  it("calls assertOrgAccess before checking the flag (the authoritative gate still runs)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    await StaffPage({ params: makeParams(), searchParams: makeSearchParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });
});

describe("StaffPage — listStaffRoster() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listStaffRoster.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(
      StaffPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listStaffRoster.mockRejectedValue(new Error("connection reset"));

    const el = await StaffPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/couldn.t load staff records right now/i),
    ).toBeTruthy();
  });
});

describe("StaffPage — getStaffFormOptions() error handling", () => {
  it("re-throws OrgAccessError from getStaffFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listStaffRoster.mockResolvedValue({ kind: "ok", data: [] });
    getStaffFormOptions.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(
      StaffPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error from getStaffFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listStaffRoster.mockResolvedValue({ kind: "ok", data: [] });
    getStaffFormOptions.mockRejectedValue(new Error("connection reset"));

    const el = await StaffPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/couldn.t load staff records right now/i),
    ).toBeTruthy();
  });
});

describe("StaffPage — result branches", () => {
  it("renders StaffForbidden when listStaffRoster() returns { kind: 'forbidden' }, WITHOUT calling getStaffFormOptions()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listStaffRoster.mockResolvedValue({ kind: "forbidden" });

    const el = await StaffPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage staff/i),
    ).toBeTruthy();
    expect(getStaffFormOptions).not.toHaveBeenCalled();
  });

  it("renders the roster table and the add-position form, plus the two-systems copy, when both calls return ok", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    hasPermission.mockResolvedValue(true);
    listStaffRoster.mockResolvedValue({
      kind: "ok",
      data: [
        {
          positionId: "position-1",
          personId: "person-2",
          displayName: "Marisol Windham",
          position: "Church Secretary",
          department: null,
          startsOn: "2023-01-08",
          endsOn: null,
          minuteReference: null,
        },
      ],
    });
    getStaffFormOptions.mockResolvedValue({
      kind: "ok",
      data: {
        people: [{ personId: "person-2", displayName: "Marisol Windham" }],
      },
    });

    const el = await StaffPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(screen.getByRole("heading", { name: /^staff$/i })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /add staff position/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/granting software access.*is done separately/i),
    ).toBeTruthy();
  });

  it("renders the empty-roster state when listStaffRoster() returns ok with zero entries", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listStaffRoster.mockResolvedValue({ kind: "ok", data: [] });
    getStaffFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const el = await StaffPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/no staff positions recorded yet/i),
    ).toBeTruthy();
  });
});

describe("StaffPage — the include-ended toggle", () => {
  it("passes includeEnded: false to listStaffRoster() and links to the 'show' state by default", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listStaffRoster.mockResolvedValue({ kind: "ok", data: [] });
    getStaffFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const el = await StaffPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(listStaffRoster).toHaveBeenCalledWith("person-1", "org-1", {
      includeEnded: false,
    });
    const toggle = screen.getByRole("link", { name: /show ended positions/i });
    expect(toggle.getAttribute("href")).toBe(
      "/o/alder-creek/admin/staff?includeEnded=1",
    );
  });

  it("passes includeEnded: true to listStaffRoster() and links back to the 'hide' state when ?includeEnded=1", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listStaffRoster.mockResolvedValue({ kind: "ok", data: [] });
    getStaffFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    const el = await StaffPage({
      params: makeParams(),
      searchParams: makeSearchParams("1"),
    });
    render(el);

    expect(listStaffRoster).toHaveBeenCalledWith("person-1", "org-1", {
      includeEnded: true,
    });
    const toggle = screen.getByRole("link", { name: /hide ended positions/i });
    expect(toggle.getAttribute("href")).toBe("/o/alder-creek/admin/staff");
  });
});

describe("StaffPage — canCreatePeople (the architect's visible-permission-split ruling)", () => {
  it("checks people.manage via hasPermission() and threads it to the form", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    hasPermission.mockResolvedValue(true);
    listStaffRoster.mockResolvedValue({ kind: "ok", data: [] });
    getStaffFormOptions.mockResolvedValue(EMPTY_OPTIONS);

    await StaffPage({ params: makeParams(), searchParams: makeSearchParams() });

    expect(hasPermission).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "people.manage",
    );
  });
});

describe("StaffPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/staff when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(
      StaffPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fstaff");
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(
      StaffPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await StaffPage({
      params: makeParams("bramblewood"),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(listStaffRoster).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await StaffPage({
      params: makeParams("fernwood"),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
