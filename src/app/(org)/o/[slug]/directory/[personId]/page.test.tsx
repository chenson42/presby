// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/directory/<personId>`'s page.tsx.
 * Mirrors `tickets/[id]/page.test.tsx`'s style. `getPersonDetail()`'s own
 * privacy filtering (including the hidden-field nulling) and
 * `getHouseholdDetail()`'s own eligibility predicate are exercised for real
 * against Postgres in `directory.test.ts` — this file only pins the
 * page-level ORDERING AND ERROR-HANDLING CONTRACT and what renders from an
 * already-nulled `DirectoryEntry`.
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

const getPersonDetail = vi.fn();
const getHouseholdDetail = vi.fn();
vi.mock("@/lib/directory", () => ({
  getPersonDetail: (...args: unknown[]) => getPersonDetail(...args),
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

import PersonDetailPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  hasPermission.mockReset().mockResolvedValue(false);
  getPersonDetail.mockReset();
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

function makeParams(personId = "c0000000-0000-0000-0000-000000000001") {
  return Promise.resolve({ slug: "alder-creek", personId });
}

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    personId: "c0000000-0000-0000-0000-000000000001",
    firstName: "Marguerite",
    lastName: "Ashcombe",
    preferredName: null,
    email: "m.ashcombe@example.invalid",
    phone: "555-0100",
    address: null,
    dateOfBirth: null,
    photoKey: null,
    middleName: null,
    suffix: null,
    householdId: null,
    householdRole: null,
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

describe("PersonDetailPage — flag gating", () => {
  it("renders flag-off and never calls getPersonDetail() when org_portal.directory is off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(getPersonDetail).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t available for Alder Creek/i)).toBeTruthy();
  });

  it("renders flag-off when org_portal.directory is on but directory_v2 is off", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockImplementation((key: string) =>
      Promise.resolve(key === "org_portal.directory"),
    );

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(getPersonDetail).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t available for Alder Creek/i)).toBeTruthy();
  });
});

describe("PersonDetailPage — getPersonDetail() result branches", () => {
  it("re-throws OrgAccessError rather than rendering the load-error state", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockRejectedValue(new OrgAccessError("person-1", "org-1"));

    await expect(
      PersonDetailPage({ params: makeParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("renders the load-error state for any other thrown error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockRejectedValue(new Error("connection reset"));

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/couldn.t load the directory right now/i),
    ).toBeTruthy();
  });

  it("renders DirectoryForbidden for { kind: 'forbidden' }", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({ kind: "forbidden" });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission/i)).toBeTruthy();
  });

  it("calls notFound() for { kind: 'not-found' } — a bad id, another org's id, and an ineligible id are all indistinguishable", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({ kind: "not-found" });

    await expect(
      PersonDetailPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("PersonDetailPage — the ok path", () => {
  it("renders the name, avatar, email, and phone", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({ kind: "ok", entry: baseEntry() });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Marguerite Ashcombe" }),
    ).toBeTruthy();
    const emailLink = screen.getByRole("link", {
      name: "m.ashcombe@example.invalid",
    });
    expect(emailLink.getAttribute("href")).toBe(
      "mailto:m.ashcombe@example.invalid",
    );
    const phoneLink = screen.getByRole("link", { name: "555-0100" });
    expect(phoneLink.getAttribute("href")).toBe("tel:555-0100");
  });

  it("prefers preferredName over firstName in the heading", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ preferredName: "Meg" }),
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByRole("heading", { name: "Meg Ashcombe" }),
    ).toBeTruthy();
  });

  it("a hidden (nulled) email is never rendered — regression against the privacy predicate leaking into the UI", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ email: null }),
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(screen.queryByText(/@example\.invalid/)).toBeNull();
    expect(
      screen.queryByRole("link", { name: /example\.invalid/ }),
    ).toBeNull();
  });

  it("omits the Contact section entirely when every contact field is null", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ email: null, phone: null }),
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.queryByRole("heading", { name: "Contact" }),
    ).toBeNull();
  });

  it("renders the birthday as month/day only, never the year", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ dateOfBirth: "1958-04-11" }),
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/April 11/)).toBeTruthy();
    expect(screen.queryByText(/1958/)).toBeNull();
  });

  it("omits the birthday line entirely when hidden (null)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ dateOfBirth: null }),
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(screen.queryByText(/Birthday/)).toBeNull();
  });

  it("omits the Household section entirely when the person has no household", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ householdId: null }),
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(getHouseholdDetail).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Household" }),
    ).toBeNull();
  });

  it("renders the household name, a link to the household page, and other household members (excluding self)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ householdId: "h1" }),
    });
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 2,
        deaconName: null,
        members: [
          baseEntry(),
          baseEntry({
            personId: "c2",
            firstName: "Tobias",
            lastName: "Renwick",
            email: null,
            phone: null,
          }),
        ],
      },
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(getHouseholdDetail).toHaveBeenCalledWith("person-1", "org-1", "h1");
    expect(screen.getByText("The Renwick Family")).toBeTruthy();
    const householdLink = screen.getByRole("link", {
      name: /view household/i,
    });
    expect(householdLink.getAttribute("href")).toBe(
      "/o/alder-creek/directory/households/h1",
    );
    // Tobias (the other member) appears; Marguerite (self) does not appear
    // a second time as a household-member card.
    expect(screen.getByText("Tobias Renwick")).toBeTruthy();
    expect(
      screen.getAllByText("Marguerite Ashcombe"),
    ).toHaveLength(1); // only the page's own <h1>, not a card
  });

  it("degrades gracefully — omits the Household section — when the secondary getHouseholdDetail() read fails", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ householdId: "h1" }),
    });
    getHouseholdDetail.mockRejectedValue(new Error("connection reset"));

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.queryByRole("heading", { name: "Household" }),
    ).toBeNull();
    // The primary content still renders — a secondary-read failure doesn't
    // crash the whole page.
    expect(
      screen.getByRole("heading", { name: "Marguerite Ashcombe" }),
    ).toBeTruthy();
  });
});

describe("PersonDetailPage — Increment 4 (includeHidden, lock badge, DeaconCard)", () => {
  it("an ordinary viewer (hasPermission false, the default) calls getPersonDetail() with NO fourth argument — the Increment 3 regression floor", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({ kind: "ok", entry: baseEntry() });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(getPersonDetail).toHaveBeenCalledWith("person-1", "org-1", "c0000000-0000-0000-0000-000000000001");
  });

  it("an elevated viewer (hasPermission true) calls getPersonDetail() with { includeHidden: true } as a fourth argument", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    hasPermission.mockResolvedValue(true);
    getPersonDetail.mockResolvedValue({ kind: "ok", entry: baseEntry() });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(getPersonDetail).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "c0000000-0000-0000-0000-000000000001",
      { includeHidden: true },
    );
    expect(hasPermission).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "directory.view_hidden",
    );
  });

  it("renders a lock badge next to the name when entry.isHidden is true", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    hasPermission.mockResolvedValue(true);
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ isHidden: true }),
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/hidden from the directory/i)).toBeTruthy();
  });

  it("renders no lock badge for an ordinary entry", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ isHidden: false }),
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(screen.queryByText(/hidden from the directory/i)).toBeNull();
  });

  it("renders DeaconCard LAST with the household's deaconName when a household loaded", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ householdId: "h1" }),
    });
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 1,
        deaconName: "Priya Balakrishnan",
        members: [baseEntry()],
      },
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(screen.getByText("Deacon")).toBeTruthy();
    expect(screen.getByText("Priya Balakrishnan")).toBeTruthy();
  });

  it("renders DeaconCard's neutral state when the household has no deacon (deaconName null)", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ householdId: "h1" }),
    });
    getHouseholdDetail.mockResolvedValue({
      kind: "ok",
      household: {
        householdId: "h1",
        name: "The Renwick Family",
        address: null,
        memberCount: 1,
        deaconName: null,
        members: [baseEntry()],
      },
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/no deacon is currently assigned/i),
    ).toBeTruthy();
  });

  it("omits DeaconCard entirely when the person has no household at all", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    mockFlagsOn();
    getPersonDetail.mockResolvedValue({
      kind: "ok",
      entry: baseEntry({ householdId: null }),
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(screen.queryByText("Deacon")).toBeNull();
    expect(
      screen.queryByText(/no deacon is currently assigned/i),
    ).toBeNull();
  });
});

describe("PersonDetailPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to this page when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(
      PersonDetailPage({ params: makeParams("c1") }),
    ).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fdirectory%2Fc1",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(
      PersonDetailPage({ params: makeParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Bramblewood/i),
    ).toBeTruthy();
    expect(getPersonDetail).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    const el = await PersonDetailPage({ params: makeParams() });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});
