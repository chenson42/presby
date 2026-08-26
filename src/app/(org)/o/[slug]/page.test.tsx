// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>`'s page.tsx.
 *
 * The four-way-miss branches (not-found/forbidden/ended) are unchanged from
 * P0 and already covered by e2e (post-login-routing.spec.ts). What Increment
 * 1 adds, and what is NOT tested anywhere else, is the ORDERING AND
 * ERROR-HANDLING CONTRACT this pipeline's design calls mandatory:
 *
 *   1. `org_portal.home_v2` OFF renders the unchanged `OrgPortalStub` and
 *      never calls `getPortalHomeData()` or `visiblePortalTiles()`.
 *   2. `org_portal.home_v2` ON renders the new home, with a greeting, the
 *      find-a-person form, the "yours" zone, and the tile grid.
 *   3. A non-`OrgAccessError` failure from `getPortalHomeData()` degrades
 *      to a `null` home data (greeting says "Welcome.", no "yours" zone) —
 *      never a crash.
 *   4. `OrgAccessError` from `getPortalHomeData()` is RE-THROWN, not
 *      swallowed — `[slug]/error.tsx` owns that copy.
 *
 * Every collaborator is mocked; this file makes no DB connection.
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

const getPortalHomeData = vi.fn();
vi.mock("@/lib/org-portal/home-data", () => ({
  getPortalHomeData: (...args: unknown[]) => getPortalHomeData(...args),
}));

const visiblePortalTiles = vi.fn();
vi.mock("@/lib/org-portal/tiles", () => ({
  visiblePortalTiles: (category: string) => visiblePortalTiles(category),
}));

vi.mock("@/components/org-portal/find-person-form", () => ({
  FindPersonForm: () => null,
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

import OrgPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getPortalHomeData.mockReset();
  visiblePortalTiles.mockReset().mockResolvedValue([]);
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

describe("OrgPage — org_portal.home_v2 OFF (the regression floor)", () => {
  it("renders the unchanged OrgPortalStub and never calls the v2 data functions", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => {
      if (key === "org_portal.home_v2") return false;
      return false;
    });

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.home_v2");
    expect(getPortalHomeData).not.toHaveBeenCalled();
    expect(visiblePortalTiles).not.toHaveBeenCalled();
    expect(screen.getByText(/you're in/i)).toBeTruthy();
  });
});

describe("OrgPage — org_portal.home_v2 ON", () => {
  it("renders the greeting, and passes the household through to the yours zone", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.home_v2");
    getPortalHomeData.mockResolvedValue({
      displayName: "Sam",
      household: { id: "h1", name: "The Fennimore Family", memberCount: 2 },
    });
    visiblePortalTiles.mockResolvedValue([]);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /Sam\.$/,
    );
    expect(screen.getByText("The Fennimore Family")).toBeTruthy();
    expect(screen.queryByText(/you're in/i)).toBeNull();
    // Guards against an accidental swap to "administer" here, which would
    // silently list permission-gated setup tools on the main page instead of
    // the day-to-day tools (Phase 3 design, page.test.tsx call-site note).
    expect(visiblePortalTiles).toHaveBeenCalledWith("operate");
    // org_portal.motion (docs/work-log/2026-08-26-portal-visual-modernization.md)
    // must be read alongside org_portal.home_v2, and — mocked false here — must
    // NOT leave the greeting band's mount fade-in classes present. This is the
    // wiring itself, not just the flag's own on/off behavior (covered in
    // greeting.test.tsx): a future refactor that drops this read, swaps the
    // key, or inverts the boolean would otherwise ship with every test green.
    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.motion");
    const bandOff = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(bandOff?.className).not.toContain("animate-in");
    expect(bandOff?.className).not.toContain("fade-in-0");
  });

  it("threads org_portal.motion ON to Greeting's motionEnabled prop", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(
      async (key: string) =>
        key === "org_portal.home_v2" || key === "org_portal.motion",
    );
    getPortalHomeData.mockResolvedValue({
      displayName: "Sam",
      household: null,
    });
    visiblePortalTiles.mockResolvedValue([]);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.motion");
    const bandOn = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(bandOn?.className).toContain("animate-in");
    expect(bandOn?.className).toContain("fade-in-0");
  });

  it("degrades to a null home data (no crash) on a non-OrgAccessError failure", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.home_v2");
    getPortalHomeData.mockRejectedValue(new Error("connection reset"));
    visiblePortalTiles.mockResolvedValue([]);

    const el = await OrgPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Welcome.",
    );
  });

  it("re-throws OrgAccessError from getPortalHomeData rather than degrading", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.home_v2");
    getPortalHomeData.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(OrgPage({ params: makeParams() })).rejects.toThrow(
      "mock: no active membership",
    );
  });
});

describe("OrgPage — the shared four-way miss response is unchanged", () => {
  it("redirects to /signin with a callbackUrl when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(OrgPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(OrgPage({ params: makeParams() })).rejects.toThrow("NOT_FOUND");
  });
});
