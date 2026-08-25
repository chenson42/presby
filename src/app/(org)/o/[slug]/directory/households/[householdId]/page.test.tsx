// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/directory/households/<householdId>`'s
 * page.tsx. Mirrors `directory/[personId]/page.test.tsx`'s style —
 * `getHouseholdDetail()`'s own SQL is exercised for real in
 * `directory.test.ts`; this file pins the page-level ordering/error-handling
 * contract and what renders from an already-resolved `HouseholdDetail`.
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

const getHouseholdDetail = vi.fn();
vi.mock("@/lib/directory", () => ({
  getHouseholdDetail: (...args: unknown[]) => getHouseholdDetail(...args),
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

import HouseholdDetailPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  hasPermission.mockReset().mockResolvedValue(false);
  getHouseholdDetail.mockReset();
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

function makeParams(householdId = "h1") {
  return Promise.resolve({ slug: "alder-creek", householdId });
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    personId: "c1",
    firstName: "Tobias",
    lastName: "Renwick",
    preferredName: null,
    email: null,
    phone: null,
    address: null,
    dateOfBirth: null,
    photoKey: null,
    middleName: null,
    suffix: null,
    householdId: "h1",
    householdRole: "head",
    ...overrides,
  };
}

function mockFlagsOn() {
  isFlagEnabled.mockImplementation((key: string) =>
    Promise.resolve(
      key === "org_portal.directory" || key === "org_portal.directory_v2",
    ),
  );
}

describe("HouseholdDetailPage — flag gating", () => {
  it("renders flag-off and never calls getHouseholdDetail() when org_portal.directory is off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(getHouseholdDetail).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t available for Alder Creek/i)).toBeTruthy();
  });

  it("renders flag-off when directory is on but directory_v2 is off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation((key: string) =>
      Promise.resolve(key === "org_portal.directory"),
    );

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(getHouseholdDetail).not.toHaveBeenCalled();
  });
});

describe("HouseholdDetailPage — getHouseholdDetail() result branches", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );

    await expect(
      HouseholdDetailPage({ params: makeParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockRejectedValue(new Error("connection reset"));

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load the directory right now/i),
    ).toBeTruthy();
  });

  it("renders DirectoryForbidden for { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockResolvedValue({ kind: "forbidden" });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
  });

  it("calls notFound() for { kind: 'not-found' } — nonexistent, another org's, and zero-visible-member ids are all indistinguishable", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockResolvedValue({ kind: "not-found" });

    await expect(
      HouseholdDetailPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("HouseholdDetailPage — the ok path", () => {
  it("renders the household name, member count, and member cards", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: {
          line1: "1 Fixture Way",
          city: "Fixtureville",
          region: "OH",
          postalCode: "00000",
        },
        memberCount: 2,
        deaconName: null,
        members: [
          member(),
          member({ personId: "c2", firstName: "Priya", lastName: "Balakrishnan" }),
        ],
      },
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: "The Renwick Family" }),
    ).toBeTruthy();
    expect(screen.getByText("1 Fixture Way")).toBeTruthy();
    expect(screen.getByText("Fixtureville, OH, 00000")).toBeTruthy();
    expect(screen.getByText(/2 members/i)).toBeTruthy();
    expect(screen.getByText("Tobias Renwick")).toBeTruthy();
    expect(screen.getByText("Priya Balakrishnan")).toBeTruthy();
    // Each member card links to their own person-detail page.
    const tobiasLink = screen.getByRole("link", { name: "Tobias Renwick" });
    expect(tobiasLink.getAttribute("href")).toBe("/o/alder-creek/directory/c1");
  });

  it("renders a singular member count for exactly one member", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h2",
        name: "Marguerite Ashcombe",
        address: null,
        memberCount: 1,
        deaconName: null,
        members: [member({ personId: "c3", firstName: "Marguerite", lastName: "Ashcombe" })],
      },
    });

    const el = await HouseholdDetailPage({ params: makeParams("h2") });
    render(el);

    expect(screen.getByText(/1 member$/i)).toBeTruthy();
  });

  it("omits the address block entirely when the household has no mailing address", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 1,
        deaconName: null,
        members: [member()],
      },
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(screen.queryByText("1 Fixture Way")).toBeNull();
  });

  it("has a back link to the households view", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 1,
        deaconName: null,
        members: [member()],
      },
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    const back = screen.getByRole("link", { name: /back to households/i });
    expect(back.getAttribute("href")).toBe(
      "/o/alder-creek/directory?view=households",
    );
  });
});

describe("HouseholdDetailPage — Increment 4 (includeHidden, DeaconCard)", () => {
  it("an ordinary viewer (hasPermission false, the default) calls getHouseholdDetail() with NO fourth argument — the Increment 3 regression floor", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 1,
        deaconName: null,
        members: [member()],
      },
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(getHouseholdDetail).toHaveBeenCalledWith("person-1", "org-1", "h1");
  });

  it("an elevated viewer (hasPermission true) calls getHouseholdDetail() with { includeHidden: true } as a fourth argument", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    hasPermission.mockResolvedValue(true);
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 1,
        deaconName: null,
        members: [member()],
      },
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(getHouseholdDetail).toHaveBeenCalledWith("person-1", "org-1", "h1", {
      includeHidden: true,
    });
    expect(hasPermission).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "directory.view_hidden",
    );
  });

  it("renders DeaconCard LAST (after the member grid) with the household's deaconName", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 1,
        deaconName: "Priya Balakrishnan",
        members: [member()],
      },
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText("Deacon")).toBeTruthy();
    expect(screen.getByText("Priya Balakrishnan")).toBeTruthy();
    const heading = screen.getByRole("heading", { name: /1 member/i });
    const deaconLabel = screen.getByText("Deacon");
    // DeaconCard follows the member-count heading in document order.
    expect(
      heading.compareDocumentPosition(deaconLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders DeaconCard's neutral state when the household has no deacon (deaconName null) — never omitted", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 1,
        deaconName: null,
        members: [member()],
      },
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/no deacon is currently assigned/i),
    ).toBeTruthy();
  });

  it("renders a lock badge on a member card whose isHidden is true", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    hasPermission.mockResolvedValue(true);
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 1,
        deaconName: null,
        members: [member({ isHidden: true })],
      },
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/hidden from the directory/i)).toBeTruthy();
  });
});

describe("HouseholdDetailPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to this page when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(
      HouseholdDetailPage({ params: makeParams() }),
    ).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fdirectory%2Fhouseholds%2Fh1",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(
      HouseholdDetailPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(getHouseholdDetail).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await HouseholdDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
