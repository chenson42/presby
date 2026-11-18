// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/oversight/<aboutOrgId>`'s
 * page.tsx — Presbytery program Increment 3
 * (`docs/work-log/2026-08-27-presbytery-program.md`), moved to `assessment/edit/`
 * and put behind `gateOversightPage` by the congregation-records pipeline (T1,
 * F452). Mirrors
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

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const mapTileConfig = vi.fn();
vi.mock("@/lib/presbytery-reports/map-config", () => ({
  mapTileConfig: () => mapTileConfig(),
}));

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
  mapTileConfig.mockReset().mockReturnValue(null);
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
  latitude: null,
  longitude: null,
  updatedAt: null,
};

const CONG_ID = "00000000-0000-4000-8000-000000000001";

function makeParams(slug = "northern-reach", aboutOrgId = CONG_ID) {
  return Promise.resolve({ slug, aboutOrgId });
}

describe("OversightDetailPage — the ordering/error-handling contract", () => {
  it("redirects to /signin with a callbackUrl back to this route when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(OversightDetailPage({ params: makeParams() })).rejects.toThrow(
      `REDIRECT:/signin?callbackUrl=${encodeURIComponent(`/o/northern-reach/admin/oversight/${CONG_ID}/assessment/edit`)}`,
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

    expect(screen.getByRole("heading", { name: "Edit assessment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeTruthy();
  });

  it("renders the 'Map location' group (not the old 'future viability map' legend) with both hints", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightDetail.mockResolvedValue({ kind: "ok", data: DETAIL_ROW });

    render(await OversightDetailPage({ params: makeParams() }));

    expect(screen.getByText("Map location")).toBeTruthy();
    expect(screen.queryByText(/future viability map/i)).toBeNull();
    expect(screen.getByText(/between -90 and 90, for example 39\.9612\. Enter this first\./)).toBeTruthy();
    expect(screen.getByText(/negative\s+longitude, for example -82\.9988\./)).toBeTruthy();
  });

  it("reads the Insights flag and the tile key only after every gate, and only to word the toast", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false); // oversight off: the page stops at the placeholder
    render(await OversightDetailPage({ params: makeParams() }));
    expect(isFlagEnabled).not.toHaveBeenCalledWith("org_portal.insights");
    expect(mapTileConfig).not.toHaveBeenCalled();
  });

  it("asks for the tile key only when Insights is on (a flag off short-circuits), on the ok path", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    getCongregationOversightDetail.mockResolvedValue({ kind: "ok", data: DETAIL_ROW });

    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.oversight");
    render(await OversightDetailPage({ params: makeParams() }));
    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.insights");
    expect(mapTileConfig).not.toHaveBeenCalled();
    cleanup();

    isFlagEnabled.mockResolvedValue(true);
    render(await OversightDetailPage({ params: makeParams() }));
    expect(mapTileConfig).toHaveBeenCalledTimes(1);
  });
  it("a stale second-factor claim redirects to /totp BEFORE the organization or the flag is read (F452)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: false } });

    await expect(OversightDetailPage({ params: makeParams() })).rejects.toThrow(
      `REDIRECT:/totp?callbackUrl=${encodeURIComponent(`/o/northern-reach/admin/oversight/${CONG_ID}/assessment/edit`)}`,
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
    expect(isFlagEnabled).not.toHaveBeenCalled();
    expect(getCongregationOversightDetail).not.toHaveBeenCalled();
  });

  it("a non-UUID aboutOrgId is a 404 before any read, not a load error (F452)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);

    await expect(OversightDetailPage({ params: makeParams("northern-reach", "not-a-uuid") })).rejects.toThrow("NOT_FOUND");
    expect(getCongregationOversightDetail).not.toHaveBeenCalled();
  });

  it("the page is the assessment form: an h1, a back link naming the congregation, and no carrier or expiry field", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationOversightDetail.mockResolvedValue({ kind: "ok", data: DETAIL_ROW });

    render(await OversightDetailPage({ params: makeParams() }));

    expect(screen.getByRole("heading", { name: "Edit assessment" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to Alder Creek Presbyterian Church/ }).getAttribute("href")).toBe(
      `/o/northern-reach/admin/oversight/${CONG_ID}`,
    );
    expect(screen.getByLabelText("Property notes")).toBeTruthy();
    expect(screen.queryByLabelText(/insurance/i)).toBeNull();
  });
});
