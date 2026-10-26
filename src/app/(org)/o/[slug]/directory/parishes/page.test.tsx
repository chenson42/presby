// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/directory/parishes`'s page.tsx.
 * Mirrors `directory/page.tsx`'s own test style. `getParishesOverview()`'s own
 * SQL (permission re-check, derivation, household counts) is exercised for
 * real in `directory.test.ts`; this file pins the page-level flag-gating and
 * result-branch contract, and what renders from an already-resolved
 * overview.
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

const getParishesOverview = vi.fn();
vi.mock("@/lib/parishes", () => ({
  getParishesOverview: (...args: unknown[]) => getParishesOverview(...args),
}));

vi.mock("./actions", () => ({
  defineDistrictAction: vi.fn(),
  renameDistrictAction: vi.fn(),
  archiveDistrictAction: vi.fn(),
  restoreDistrictAction: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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

import ParishesPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getParishesOverview.mockReset();
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

function mockFlagsOn() {
  isFlagEnabled.mockImplementation((key: string) =>
    Promise.resolve(
      key === "org_portal.directory" || key === "org_portal.directory_v2",
    ),
  );
}

describe("ParishesPage — flag gating", () => {
  it("renders flag-off and never calls getParishesOverview() when org_portal.directory is off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(getParishesOverview).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t available for Alder Creek/i)).toBeTruthy();
  });

  it("renders flag-off when directory is on but directory_v2 is off — Parishes rides on directory_v2, no new flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation((key: string) =>
      Promise.resolve(key === "org_portal.directory"),
    );

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(getParishesOverview).not.toHaveBeenCalled();
  });
});

describe("ParishesPage — getParishesOverview() result branches", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishesOverview.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(
      ParishesPage({ params: makeParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishesOverview.mockRejectedValue(new Error("connection reset"));

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load the directory right now/i),
    ).toBeTruthy();
  });

  it("renders the existing DirectoryForbidden-shaped state (not a 404) for { kind: 'forbidden' } — a deep link without any parishes authority", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishesOverview.mockResolvedValue({ kind: "forbidden" });

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});

describe("ParishesPage — the ok path", () => {
  it("renders one card per parish, deacon names, vacancy, and household counts", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishesOverview.mockResolvedValue({
      kind: "ok",
      managed: false,
      districts: [
        {
          orgUnitId: "u1",
          name: "North District",
          unitType: "district",
          archived: false,
          deaconName: "Priya Balakrishnan",
          householdCount: 3,
        },
        {
          orgUnitId: "u2",
          name: "South District",
          unitType: "district",
          archived: false,
          deaconName: null,
          householdCount: 1,
        },
      ],
    });

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(screen.getByText("North District")).toBeTruthy();
    expect(screen.getByText(/Priya Balakrishnan/)).toBeTruthy();
    expect(screen.getByText("South District")).toBeTruthy();
    expect(screen.getByText(/Vacant/)).toBeTruthy();
    expect(screen.getByText(/3 households/i)).toBeTruthy();
    expect(screen.getByText(/1 household$/i)).toBeTruthy();
  });

  it("renders the empty-roster copy when the organization has no org units at all", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishesOverview.mockResolvedValue({ kind: "ok", managed: false, districts: [] });

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/has no districts or parishes set up yet/i),
    ).toBeTruthy();
  });

  it("renders the Members/Households/Parishes nav with Parishes marked current", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishesOverview.mockResolvedValue({ kind: "ok", managed: false, districts: [] });

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    const parishesTab = screen.getByRole("link", { name: "Parishes" });
    expect(parishesTab.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Households" })).toBeTruthy();
  });
});

describe("ParishesPage - managed mode (the org toggle on)", () => {
  const AUTHORITY = {
    canDefine: true,
    canMove: true,
    canListHouseholds: true,
    canReadRoster: true,
    seesHiddenNames: true,
    holdsSeatKey: false,
  };

  it("renders linked districts, the Add form, archived districts and the unassigned card from the overview", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishesOverview.mockResolvedValue({
      kind: "ok",
      managed: true,
      authority: AUTHORITY,
      districts: [
        { orgUnitId: "u1", name: "North District", unitType: "district", archived: false, deaconName: null, householdCount: 2 },
      ],
      archived: [
        { orgUnitId: "u2", name: "East District", unitType: "district", archived: true, deaconName: null, householdCount: 1 },
      ],
      unassignedCount: 5,
      seatFilled: false,
    });

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("link", { name: "View households in North District" }).getAttribute("href")).toBe(
      "/o/alder-creek/directory/parishes/u1",
    );
    expect(screen.getByRole("heading", { name: "Archived districts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add district" })).toBeTruthy();
    expect(screen.getByText("5 households aren't in a district.")).toBeTruthy();
    expect(screen.getByTestId("seat-callout")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Parishes" }).getAttribute("aria-current")).toBe("page");
  });

  it("a seat holder (cannot define) sees districts and the unassigned card but no Add form", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishesOverview.mockResolvedValue({
      kind: "ok",
      managed: true,
      authority: { ...AUTHORITY, canDefine: false, holdsSeatKey: true },
      districts: [
        { orgUnitId: "u1", name: "North District", unitType: "district", archived: false, deaconName: null, householdCount: 2 },
      ],
      archived: [],
      unassignedCount: 0,
      seatFilled: null,
    });

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(screen.queryByRole("button", { name: "Add district" })).toBeNull();
    expect(screen.queryByTestId("seat-callout")).toBeNull();
    expect(screen.getByRole("link", { name: "View households in North District" })).toBeTruthy();
  });
});

describe("ParishesPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to this page when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(
      ParishesPage({ params: makeParams() }),
    ).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fdirectory%2Fparishes",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(
      ParishesPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(getParishesOverview).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
