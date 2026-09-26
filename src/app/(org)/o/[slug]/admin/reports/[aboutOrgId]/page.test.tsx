// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/reports/<aboutOrgId>`'s page.tsx
 * — architect Phase 2 ruling 1d, `docs/work-log/2026-09-26-withdraw-publication.md`.
 * Mirrors `../../oversight/[aboutOrgId]/page.test.tsx`'s assertion style:
 *
 *   1. `isFlagEnabled("org_portal.reports")` is checked BEFORE
 *      `getCongregationFilingHistory()` is ever called.
 *   2. Flag on, wrong org type (non-presbytery) -> PlaceholderNotAvailable.
 *   3. `OrgAccessError` is RE-THROWN, not swallowed into the load-error state.
 *   4. Any other thrown error renders the load-error state.
 *   5. `{ kind: "forbidden" }` renders `ReportsSectionForbidden`.
 *   6. `{ kind: "invalid_target" }` (the parent-path check — an `aboutOrgId`
 *      belonging to a different presbytery, or a non-congregation type)
 *      calls `notFound()` — a real 404, not a load error.
 *   7. Empty rows -> the sub-view's own empty state.
 *   8. Non-empty rows -> withdrawn history is INCLUDED and marked, never
 *      filtered (Option A) — the point of this sub-view.
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

const getCongregationFilingHistory = vi.fn();
vi.mock("@/lib/presbytery", () => ({
  getCongregationFilingHistory: (...args: unknown[]) =>
    getCongregationFilingHistory(...args),
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

import CongregationFilingHistoryPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getCongregationFilingHistory.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

const OK_RESOLVED = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Presbytery of the Northern Reach",
    organizationType: "presbytery" as const,
    slug: "northern-reach",
    platformStatus: "managed" as const,
  },
};

function makeParams(slug = "northern-reach", aboutOrgId = "cong-1") {
  return Promise.resolve({ slug, aboutOrgId });
}

describe("CongregationFilingHistoryPage — the ordering/error-handling contract", () => {
  it("redirects to /signin with a callbackUrl back to this route when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(
      CongregationFilingHistoryPage({ params: makeParams() }),
    ).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Fnorthern-reach%2Fadmin%2Freports%2Fcong-1",
    );
  });

  it("checks the flag BEFORE calling getCongregationFilingHistory()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await CongregationFilingHistoryPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.reports");
    expect(getCongregationFilingHistory).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t turned on for Presbytery of the Northern Reach/i),
    ).toBeTruthy();
  });

  it("renders PlaceholderNotAvailable for a non-presbytery org type, without reading data", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ok",
      org: { ...OK_RESOLVED.org, organizationType: "congregation" },
    });
    isFlagEnabled.mockResolvedValue(true);

    const el = await CongregationFilingHistoryPage({ params: makeParams() });
    render(el);

    expect(getCongregationFilingHistory).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t available for Presbytery of the Northern Reach/i),
    ).toBeTruthy();
  });

  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationFilingHistory.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(
      CongregationFilingHistoryPage({ params: makeParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationFilingHistory.mockRejectedValue(new Error("connection reset"));

    const el = await CongregationFilingHistoryPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load this section right now/i),
    ).toBeTruthy();
  });

  it("renders ReportsSectionForbidden for a forbidden result", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationFilingHistory.mockResolvedValue({ kind: "forbidden" });

    const el = await CongregationFilingHistoryPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage filing history/i),
    ).toBeTruthy();
  });

  it("calls notFound() for invalid_target — the parent-path check rejecting an aboutOrgId outside this presbytery", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationFilingHistory.mockResolvedValue({ kind: "invalid_target" });

    await expect(
      CongregationFilingHistoryPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders the sub-view's own empty state for zero filings", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationFilingHistory.mockResolvedValue({
      kind: "ok",
      data: { congregationName: "Alder Creek Presbyterian Church", rows: [] },
    });

    const el = await CongregationFilingHistoryPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Alder Creek Presbyterian Church" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/no filings on record for this congregation/i),
    ).toBeTruthy();
  });

  it("includes and marks a withdrawn row — Option A, never filtered here", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationFilingHistory.mockResolvedValue({
      kind: "ok",
      data: {
        congregationName: "Alder Creek Presbyterian Church",
        rows: [
          {
            publicationId: "pub-1",
            reportYear: 2026,
            publishedAt: "2026-02-01T00:00:00.000Z",
            minuteReference: "Session, 2026-01-30, item 3",
            attestedByName: "Tobias Renwick",
            attestedRole: "Stated Clerk",
            withdrawnAt: "2026-03-01T00:00:00.000Z",
            withdrawnBy: "user-1",
            withdrawnMinuteReference: "Session, 2026-02-28, item 5",
          },
        ],
      },
    });

    const el = await CongregationFilingHistoryPage({ params: makeParams() });
    render(el);

    expect(screen.getByText("Withdrawn")).toBeTruthy();
    expect(screen.getByText("Session, 2026-02-28, item 5")).toBeTruthy();
    expect(screen.getByText("Tobias Renwick (Stated Clerk)")).toBeTruthy();
  });
});
