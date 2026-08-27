// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/oversight/<aboutOrgId>`'s
 * page.tsx — Presbytery program Increment 3
 * (`docs/work-log/2026-08-27-presbytery-program.md`). Mirrors
 * `../../officers/[personId]/page.test.tsx`'s assertion style for a
 * per-congregation detail route:
 *
 *   1. `isFlagEnabled("org_portal.oversight")` is checked BEFORE
 *      `getCongregationOversightDetail()` is ever called.
 *   2. `OrgAccessError` is RE-THROWN, not swallowed into the load-error
 *      state.
 *   3. Any other thrown error renders the load-error state.
 *   4. `{ kind: "forbidden" }` renders `OversightForbidden`.
 *   5. `{ kind: "invalid_target" }` (the parent-path check — an aboutOrgId
 *      belonging to a different presbytery, or nonexistent) calls
 *      `notFound()` — a real 404, not a load error.
 *   6. The ok path renders the congregation's name and the edit form.
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

const getCongregationOversightDetail = vi.fn();
vi.mock("@/lib/presbytery", () => ({
  getCongregationOversightDetail: (...args: unknown[]) =>
    getCongregationOversightDetail(...args),
}));

vi.mock("./actions", () => ({
  setCongregationOversightAction: vi.fn(),
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

import OversightDetailPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getCongregationOversightDetail.mockReset();
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

const DETAIL_ROW = {
  organizationId: "cong-1",
  name: "Alder Creek Presbyterian Church",
  platformStatus: "managed",
  hasData: true,
  viabilityScore: 3,
  redevelopmentNotes: null,
  buildingsNotes: null,
  insuranceCarrier: null,
  insuranceExpiresOn: null,
  latitude: null,
  longitude: null,
  updatedAt: null,
};

function makeParams(slug = "northern-reach", aboutOrgId = "cong-1") {
  return Promise.resolve({ slug, aboutOrgId });
}

describe("OversightDetailPage — the ordering/error-handling contract", () => {
  it("redirects to /signin with a callbackUrl back to this route when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(OversightDetailPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Fnorthern-reach%2Fadmin%2Foversight%2Fcong-1",
    );
  });

  it("checks the flag BEFORE calling getCongregationOversightDetail()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await OversightDetailPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.oversight");
    expect(getCongregationOversightDetail).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t turned on for Presbytery of the Northern Reach/i),
    ).toBeTruthy();
  });

  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightDetail.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(OversightDetailPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightDetail.mockRejectedValue(new Error("connection reset"));

    const el = await OversightDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load oversight records right now/i),
    ).toBeTruthy();
  });

  it("renders OversightForbidden for a forbidden result", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightDetail.mockResolvedValue({ kind: "forbidden" });

    const el = await OversightDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage congregation oversight/i),
    ).toBeTruthy();
  });

  it("calls notFound() for invalid_target — the parent-path check rejecting an aboutOrgId outside this presbytery", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightDetail.mockResolvedValue({ kind: "invalid_target" });

    await expect(OversightDetailPage({ params: makeParams() })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("renders the congregation's name and the edit form on the ok path", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightDetail.mockResolvedValue({ kind: "ok", data: DETAIL_ROW });

    const el = await OversightDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Alder Creek Presbyterian Church" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeTruthy();
  });
});
