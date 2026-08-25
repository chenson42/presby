// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/directory/parishes`'s page.tsx.
 * Mirrors `directory/page.tsx`'s own test style. `getParishRoster()`'s own
 * SQL (permission re-check, derivation, household counts) is exercised for
 * real in `directory.test.ts`; this file pins the page-level flag-gating and
 * result-branch contract, and what renders from an already-resolved
 * `ParishRosterEntry[]`.
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

const getParishRoster = vi.fn();
vi.mock("@/lib/directory", () => ({
  getParishRoster: (...args: unknown[]) => getParishRoster(...args),
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

import ParishesPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getParishRoster.mockReset();
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
  it("renders flag-off and never calls getParishRoster() when org_portal.directory is off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(getParishRoster).not.toHaveBeenCalled();
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

    expect(getParishRoster).not.toHaveBeenCalled();
  });
});

describe("ParishesPage — getParishRoster() result branches", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishRoster.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(
      ParishesPage({ params: makeParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishRoster.mockRejectedValue(new Error("connection reset"));

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load the directory right now/i),
    ).toBeTruthy();
  });

  it("renders the existing DirectoryForbidden-shaped state (not a 404) for { kind: 'forbidden' } — a deep link without directory.view_hidden", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getParishRoster.mockResolvedValue({ kind: "forbidden" });

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
    getParishRoster.mockResolvedValue({
      kind: "ok",
      parishes: [
        {
          orgUnitId: "u1",
          orgUnitName: "North District",
          deaconName: "Priya Balakrishnan",
          householdCount: 3,
        },
        {
          orgUnitId: "u2",
          orgUnitName: "South District",
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
    getParishRoster.mockResolvedValue({ kind: "ok", parishes: [] });

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
    getParishRoster.mockResolvedValue({ kind: "ok", parishes: [] });

    const el = await ParishesPage({ params: makeParams() });
    render(el);

    const parishesTab = screen.getByRole("link", { name: "Parishes" });
    expect(parishesTab.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Households" })).toBeTruthy();
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
    expect(getParishRoster).not.toHaveBeenCalled();
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
