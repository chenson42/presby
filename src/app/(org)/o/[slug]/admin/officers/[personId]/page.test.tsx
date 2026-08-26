// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/officers/<personId>`'s page.tsx —
 * groups-and-officers Phase 3, commit 3/3.
 *
 * Mirrors `../page.test.tsx`'s ordering/error-handling assertion style, for
 * the per-person history route:
 *
 *   1. `isFlagEnabled("org_portal.officers")` is checked BEFORE
 *      `getOfficerHistory()` is ever called.
 *   2. `OrgAccessError` is RE-THROWN, not swallowed into the load-error
 *      state.
 *   3. Any other thrown error renders the load-error state.
 *   4. `{ kind: "forbidden" }` renders `OfficersForbidden`.
 *   5. `{ kind: "invalid_target" }` calls `notFound()` — a real 404, not a
 *      load error (same discipline `admin/members/[id]/edit/page.tsx`'s
 *      `not_found` branch documents).
 *   6. The ok path renders the history table, using the `?name=` query
 *      param for the heading, falling back to generic copy when absent.
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

const getOfficerHistory = vi.fn();
vi.mock("@/lib/officers", () => ({
  getOfficerHistory: (...args: unknown[]) => getOfficerHistory(...args),
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

import OfficerHistoryPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getOfficerHistory.mockReset();
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

function makeParams(slug = "alder-creek", personId = "person-2") {
  return Promise.resolve({ slug, personId });
}
function makeSearchParams(name?: string) {
  return Promise.resolve({ name });
}

describe("OfficerHistoryPage — the flag-before-permission ordering contract", () => {
  it("checks the flag and renders flag-off WITHOUT ever calling getOfficerHistory()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await OfficerHistoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.officers");
    expect(getOfficerHistory).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });
});

describe("OfficerHistoryPage — getOfficerHistory() error handling", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOfficerHistory.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(
      OfficerHistoryPage({
        params: makeParams(),
        searchParams: makeSearchParams(),
      }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOfficerHistory.mockRejectedValue(new Error("connection reset"));

    const el = await OfficerHistoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/couldn.t load officer records right now/i),
    ).toBeTruthy();
  });
});

describe("OfficerHistoryPage — result branches", () => {
  it("renders OfficersForbidden for { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOfficerHistory.mockResolvedValue({ kind: "forbidden" });

    const el = await OfficerHistoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage officer terms/i),
    ).toBeTruthy();
  });

  it("calls notFound() for { kind: 'invalid_target' } — a real 404, not a load error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOfficerHistory.mockResolvedValue({ kind: "invalid_target" });

    await expect(
      OfficerHistoryPage({
        params: makeParams(),
        searchParams: makeSearchParams(),
      }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders the history table using the ?name= query param for the heading", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOfficerHistory.mockResolvedValue({
      kind: "ok",
      data: [
        {
          termId: "term-1",
          office: "ruling_elder",
          classYear: 2028,
          startsOn: "2023-01-08",
          endsOn: null,
          endReason: null,
          yearsServed: 3,
        },
      ],
    });

    const el = await OfficerHistoryPage({
      params: makeParams(),
      searchParams: makeSearchParams("Tobias Renwick"),
    });
    render(el);

    expect(
      screen.getByRole("heading", { name: /tobias renwick.s officer history/i }),
    ).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("falls back to generic copy when ?name= is absent", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getOfficerHistory.mockResolvedValue({ kind: "ok", data: [] });

    const el = await OfficerHistoryPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByRole("heading", { name: /this person.s officer history/i }),
    ).toBeTruthy();
    expect(screen.getByText(/no officer history recorded/i)).toBeTruthy();
  });
});

describe("OfficerHistoryPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to this page when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(
      OfficerHistoryPage({
        params: makeParams(),
        searchParams: makeSearchParams(),
      }),
    ).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fofficers%2Fperson-2",
    );
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(
      OfficerHistoryPage({
        params: makeParams(),
        searchParams: makeSearchParams(),
      }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await OfficerHistoryPage({
      params: makeParams("bramblewood"),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(getOfficerHistory).not.toHaveBeenCalled();
  });
});
