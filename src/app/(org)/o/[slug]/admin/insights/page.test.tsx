// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/insights`'s page.tsx - the presbytery
 * dashboard (DECISION-342, docs/work-log/2026-11-17-presbytery-dashboard.md),
 * which replaced the product-IA scaffold's inert stub for presbyteries only
 * (docs/work-log/2026-08-27-product-ia-scaffold.md, DECISION-117). The session,
 * the org resolver, the flags and the dashboard composition are mocked; the
 * gate (`gateInsightsPage`) and the views are real, so the order and the states
 * are what is under test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  FakeOrgAccessError: class FakeOrgAccessError extends Error {},
  getPresbyteryDashboard: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
vi.mock("@/lib/authz", () => ({
  OrgAccessError: mocks.FakeOrgAccessError,
  resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
  assertOrgAccess: (...args: unknown[]) => assertOrgAccess(...args),
}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

vi.mock("@/lib/presbytery-reports/dashboard", () => ({
  getPresbyteryDashboard: (...args: unknown[]) => mocks.getPresbyteryDashboard(...args),
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

import InsightsPage from "./page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  mocks.getPresbyteryDashboard.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

const org = (organizationType: "congregation" | "presbytery") => ({
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: organizationType === "presbytery" ? "Northern Reach Presbytery" : "Alder Creek Presbyterian Church",
    organizationType,
    slug: organizationType === "presbytery" ? "northern" : "alder-creek",
    platformStatus: "managed" as const,
  },
});
const OK_CONGREGATION = org("congregation");
const OK_PRESBYTERY = org("presbytery");

const signedIn = { user: { id: "u1", email: "clerk@example.invalid" } };

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

/** Every flag on except the ones named. */
function flagsOnExcept(...off: string[]) {
  isFlagEnabled.mockImplementation(async (key: string) => !off.includes(key));
}

const cards = (over: Record<string, unknown> = {}) => ({
  membership_trend: { kind: "ok", data: { kind: "figure", year: 2025, total: 4321, reporting: 9, members: 12, from: 2021, to: 2025 } },
  vacant_pulpits: { kind: "ok", data: { kind: "some", vacant: 3, total: 12 } },
  per_capita: { kind: "ok", data: { kind: "none", billingYear: 2026, rateSet: false } },
  viability: {
    kind: "ok",
    data: {
      rosterCount: 1,
      anyNotAssessed: false,
      rows: [{ organizationId: "x1", name: "Birch Hollow", score: 1, label: "At risk" }],
    },
  },
  ...over,
});
const okDashboard = (over: Record<string, unknown> = {}) => ({
  kind: "ok",
  roster: { kind: "ok", count: 12 },
  cards: cards(over),
});

describe("InsightsPage - the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/insights when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(InsightsPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Finsights",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("a stale second factor redirects to /totp with the page's own path", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: false } });

    await expect(InsightsPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/totp?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Finsights",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue(signedIn);
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(InsightsPage({ params: makeParams() })).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue(signedIn);
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Some Other Church",
      organizationType: "congregation",
    });

    render(await InsightsPage({ params: makeParams("other-church") }));

    expect(screen.getByText(/you don.t have access to Some Other Church/i)).toBeTruthy();
    expect(isFlagEnabled).not.toHaveBeenCalled();
    expect(mocks.getPresbyteryDashboard).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue(signedIn);
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbyterian Church",
      endedOn: "2026-03-31",
    });

    render(await InsightsPage({ params: makeParams("fernwood") }));

    expect(screen.getByText(/your access to Fernwood.*has ended/i)).toBeTruthy();
  });

  it("an OrgAccessError from the dashboard propagates to the error boundary", async () => {
    cachedAuth.mockResolvedValue(signedIn);
    resolveOrgContext.mockResolvedValue(OK_PRESBYTERY);
    flagsOnExcept();
    mocks.getPresbyteryDashboard.mockRejectedValue(new mocks.FakeOrgAccessError("ended"));

    await expect(InsightsPage({ params: makeParams("northern") })).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);
  });
});

describe("InsightsPage - auth gate ordering", () => {
  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue(signedIn);
    resolveOrgContext.mockResolvedValue(OK_CONGREGATION);
    isFlagEnabled.mockResolvedValue(false);

    await InsightsPage({ params: makeParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
    expect(assertOrgAccess.mock.invocationCallOrder[0]).toBeLessThan(isFlagEnabled.mock.invocationCallOrder[0]);
  });
});

describe("InsightsPage - flag and type states", () => {
  it("flag off renders PlaceholderFlagOff naming the org, checked with org_portal.insights, and reads nothing", async () => {
    cachedAuth.mockResolvedValue(signedIn);
    resolveOrgContext.mockResolvedValue(OK_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(false);

    render(await InsightsPage({ params: makeParams("northern") }));

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.insights");
    expect(screen.getByText(/isn.t turned on for Northern Reach Presbytery yet/i)).toBeTruthy();
    expect(mocks.getPresbyteryDashboard).not.toHaveBeenCalled();
  });

  it("a congregation with insights off still sees 'isn't turned on' (the flag is checked before the type)", async () => {
    cachedAuth.mockResolvedValue(signedIn);
    resolveOrgContext.mockResolvedValue(OK_CONGREGATION);
    isFlagEnabled.mockResolvedValue(false);

    render(await InsightsPage({ params: makeParams() }));

    expect(screen.getByText(/isn.t turned on for Alder Creek Presbyterian Church yet/i)).toBeTruthy();
  });

  it("a congregation with the flag on renders the unchanged ComingSoon stub and reads no data", async () => {
    cachedAuth.mockResolvedValue(signedIn);
    resolveOrgContext.mockResolvedValue(OK_CONGREGATION);
    isFlagEnabled.mockResolvedValue(true);

    render(await InsightsPage({ params: makeParams() }));

    expect(screen.getByRole("heading", { name: "Insights & Analytics" })).toBeTruthy();
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /want this sooner\? tell us\./i }).getAttribute("href")).toBe(
      "/o/alder-creek/feedback",
    );
    expect(mocks.getPresbyteryDashboard).not.toHaveBeenCalled();
  });
});

describe("InsightsPage - the presbytery dashboard", () => {
  const renderDashboard = async (dashboard: unknown, off: string[] = []) => {
    cachedAuth.mockResolvedValue(signedIn);
    resolveOrgContext.mockResolvedValue(OK_PRESBYTERY);
    flagsOnExcept(...off);
    mocks.getPresbyteryDashboard.mockResolvedValue(dashboard);
    render(await InsightsPage({ params: makeParams("northern") }));
  };

  it("renders the h1, the subtitle naming the presbytery, the cards, the list and the help link", async () => {
    await renderDashboard(okDashboard());

    expect(screen.getByRole("heading", { level: 1, name: "Insights & Analytics" })).toBeTruthy();
    expect(screen.getByText(/A quick look at the member congregations of Northern Reach Presbytery/)).toBeTruthy();
    expect(screen.getByText("4,321")).toBeTruthy();
    expect(screen.getByText("3 vacant of 12 congregations")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Per capita, 2026" })).toBeTruthy();
    expect(screen.getAllByText("Birch Hollow").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Help with Insights & Analytics" }).getAttribute("href")).toBe(
      "/help/presbytery-reports#insights-and-analytics",
    );
  });

  it("composes the dashboard for the gate's identity with a single now", async () => {
    await renderDashboard(okDashboard());

    expect(mocks.getPresbyteryDashboard).toHaveBeenCalledTimes(1);
    const [viewer, now] = mocks.getPresbyteryDashboard.mock.calls[0];
    expect(viewer).toMatchObject({ userId: "u1", personId: "person-1", organizationId: "org-1", slug: "northern" });
    expect(now).toBeInstanceOf(Date);
  });

  it("reads org_portal.reports, org_portal.oversight and org_portal.credentials as link toggles only", async () => {
    await renderDashboard(okDashboard());

    const asked = isFlagEnabled.mock.calls.map((c) => c[0]);
    expect(asked).toEqual(
      expect.arrayContaining(["org_portal.insights", "org_portal.reports", "org_portal.oversight", "org_portal.credentials"]),
    );
  });

  it("a presbytery with insights on and reports off still renders cards, without report links", async () => {
    await renderDashboard(okDashboard(), ["org_portal.reports"]);

    expect(screen.getByText("4,321")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open the trend/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Open vacant pulpits/ })).toBeNull();
  });

  it("with oversight off a viability name is plain text", async () => {
    await renderDashboard(okDashboard(), ["org_portal.oversight"]);

    expect(screen.queryByRole("link", { name: "Birch Hollow" })).toBeNull();
    expect(screen.getAllByText("Birch Hollow").length).toBeGreaterThan(0);
  });

  it("a presbytery member with none of the four keys sees one forbidden state", async () => {
    await renderDashboard({ kind: "forbidden" });

    expect(screen.getByText(/It summarizes four reports/)).toBeTruthy();
    expect(screen.queryByTestId("dashboard-cards")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Insights & Analytics" })).toBeTruthy();
  });

  it("a dashboard error renders the retry link to the page's own path", async () => {
    await renderDashboard({ kind: "error" });

    expect(screen.getByRole("alert").textContent).toContain("We couldn't load Insights & Analytics");
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/northern/admin/insights");
  });

  it("roster count 0 renders one empty state and no cards", async () => {
    await renderDashboard({ kind: "ok", roster: { kind: "ok", count: 0 }, cards: cards() });

    expect(screen.getByText("No member congregations yet")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-cards")).toBeNull();
  });

  it("a failed roster read renders the members card as an error and never the empty state", async () => {
    await renderDashboard({ kind: "ok", roster: { kind: "error" }, cards: cards() });

    expect(screen.queryByText("No member congregations yet")).toBeNull();
    expect(screen.getByText(/couldn't count the member congregations/)).toBeTruthy();
    expect(screen.getByText("4,321")).toBeTruthy();
  });
});
