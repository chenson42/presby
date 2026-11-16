// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/reports`'s page.tsx — Presbytery
 * program Increment 3b (`docs/work-log/2026-08-27-presbytery-program.md`,
 * DECISION-118 through 121). Replaces the product-IA scaffold's
 * `ComingSoon` assertions with the real two-section page.
 *
 * TWO SECTIONS, TWO INDEPENDENT PERMISSIONS — `getCongregationStatisticsRollup()`
 * (`statistics.manage`) and `getPerCapitaOverview()` (`per_capita.manage`)
 * are mocked and asserted INDEPENDENTLY, including the case where one
 * section is forbidden and the other renders normally
 * (`reports-states.tsx`'s own header).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

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

const getCongregationStatisticsRollup = vi.fn();
const getPerCapitaOverview = vi.fn();
vi.mock("@/lib/presbytery", () => ({
  getCongregationStatisticsRollup: (...args: unknown[]) =>
    getCongregationStatisticsRollup(...args),
  getPerCapitaOverview: (...args: unknown[]) => getPerCapitaOverview(...args),
}));

// Increment 6 (D16/DECISION-147) — `@/lib/statistics-grants` is
// `server-only`-marked (real `submitStatisticsGrant()` pulls the Neon pool
// in); mocked here for the same reason `@/lib/presbytery` above is, so this
// suite can render `page.tsx` in jsdom without a live database.
const getReportsHub = vi.fn();
vi.mock("@/lib/presbytery-reports/hub", () => ({
  getReportsHub: (...args: unknown[]) => getReportsHub(...args),
}));

const ALL_HELD = {
  held: { vacant_pulpits: true, membership_trend: true, viability: true, per_capita: true },
};

const listStatisticsGrants = vi.fn();
vi.mock("@/lib/statistics-grants", () => ({
  listStatisticsGrants: (...args: unknown[]) => listStatisticsGrants(...args),
}));

vi.mock("./actions", () => ({
  setCongregationStatisticsAction: vi.fn(),
  setPerCapitaRateAction: vi.fn(),
  generatePerCapitaRecordsAction: vi.fn(),
  recordPerCapitaPaymentAction: vi.fn(),
  issueStatisticsGrantAction: vi.fn(),
  revokeStatisticsGrantAction: vi.fn(),
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

import ReportsPage from "./page";

getReportsHub.mockResolvedValue(ALL_HELD);
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  getCongregationStatisticsRollup.mockReset();
  getPerCapitaOverview.mockReset();
  // Increment 6's third section (`renderSubmissionGrantsSection()`) only
  // calls this when `statistics.submission_grants` resolves true — most
  // tests below never touch that flag and don't care about this section's
  // content, so a harmless default keeps them from throwing on an
  // un-mocked call rather than requiring every pre-existing test to know
  // about a section it isn't testing.
  listStatisticsGrants.mockReset().mockResolvedValue({ kind: "ok", data: [] });
  getReportsHub.mockReset().mockResolvedValue(ALL_HELD);
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

const OK_RESOLVED_PRESBYTERY = {
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

const OK_RESOLVED_CONGREGATION = {
  kind: "ok" as const,
  org: {
    organizationId: "org-2",
    personId: "person-2",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};

const EMPTY_STATS = { kind: "ok" as const, data: [] };
const EMPTY_PER_CAPITA = { kind: "ok" as const, data: { rate: null, records: [] } };

function makeParams(slug = "northern-reach") {
  return Promise.resolve({ slug });
}
function makeSearchParams(query: { year?: string; billingYear?: string } = {}) {
  return Promise.resolve(query);
}

describe("ReportsPage — the shared four-way miss response", () => {
  it("redirects to /signin with a callbackUrl back to admin/reports when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(
      ReportsPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("REDIRECT:/signin?callbackUrl=%2Fo%2Fnorthern-reach%2Fadmin%2Freports");
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("calls notFound() for a slug with no organization", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });

    await expect(
      ReportsPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("renders the shared access-denied copy for a forbidden org relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "forbidden",
      name: "Some Other Presbytery",
      organizationType: "presbytery",
    });

    const el = await ReportsPage({
      params: makeParams("other-presbytery"),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/you don.t have access to Some Other Presbytery/i),
    ).toBeTruthy();
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it("renders the shared ended-relationship copy for an ended relationship", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({
      kind: "ended",
      name: "Fernwood Presbytery",
      endedOn: "2026-03-31",
    });

    const el = await ReportsPage({
      params: makeParams("fernwood"),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(
      screen.getByText(/your access to Fernwood.*has ended/i),
    ).toBeTruthy();
  });
});

describe("ReportsPage — the flag-before-org-type ordering contract", () => {
  it("calls assertOrgAccess before checking the flag", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(false);

    await ReportsPage({ params: makeParams(), searchParams: makeSearchParams() });

    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });

  it("flag off renders PlaceholderFlagOff, checked with org_portal.reports, WITHOUT reading either section", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(false);

    const el = await ReportsPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.reports");
    expect(getCongregationStatisticsRollup).not.toHaveBeenCalled();
    expect(getPerCapitaOverview).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /isn.t turned on for Presbytery of the Northern Reach yet/i,
      ),
    ).toBeTruthy();
  });

  it("flag on + wrong org type (congregation) renders PlaceholderNotAvailable, WITHOUT reading either section", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_CONGREGATION);
    isFlagEnabled.mockResolvedValue(true);

    const el = await ReportsPage({
      params: makeParams("alder-creek"),
      searchParams: makeSearchParams(),
    });
    render(el);

    expect(getCongregationStatisticsRollup).not.toHaveBeenCalled();
    expect(getPerCapitaOverview).not.toHaveBeenCalled();
    expect(
      screen.getByText(/isn.t available for Alder Creek Presbyterian Church/i),
    ).toBeTruthy();
  });
});

describe("ReportsPage — result branches", () => {
  it("re-throws OrgAccessError from the statistics section rather than rendering a load error", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockRejectedValue(
      new OrgAccessError("person-1", "org-1"),
    );
    getPerCapitaOverview.mockResolvedValue(EMPTY_PER_CAPITA);

    await expect(
      ReportsPage({ params: makeParams(), searchParams: makeSearchParams() }),
    ).rejects.toThrow("mock: no active membership");
  });

  it("each section renders its OWN forbidden state — statistics forbidden, per-capita still renders", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockResolvedValue({ kind: "forbidden" });
    getPerCapitaOverview.mockResolvedValue(EMPTY_PER_CAPITA);

    const el = await ReportsPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage statistics/i),
    ).toBeTruthy();
    expect(screen.getByText(/no records generated for this year yet/i)).toBeTruthy();
  });

  it("each section renders its OWN forbidden state — per-capita forbidden, statistics still renders", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockResolvedValue(EMPTY_STATS);
    getPerCapitaOverview.mockResolvedValue({ kind: "forbidden" });

    const el = await ReportsPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(
      screen.getByText(/don.t have permission to manage per-capita billing/i),
    ).toBeTruthy();
    expect(screen.getByText(/no member congregations on record/i)).toBeTruthy();
  });

  it("renders the provenance-labeled statistics rollup and the per-capita records table on the ok path", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockResolvedValue({
      kind: "ok",
      data: [
        {
          organizationId: "cong-1",
          name: "Alder Creek Presbyterian Church",
          platformStatus: "managed",
          year: 2025,
          hasData: true,
          provenance: "published_by_congregation",
          publishedAt: "2026-01-12T20:00:00.000Z",
          minuteReference: null,
          endingActive: 212,
          endingBaptized: 45,
          endingAffiliate: null,
          endingOtherParticipants: null,
          gainsProfessionsUnder18: null,
          gainsProfessions18Plus: null,
          gainsCertificate: null,
          gainsOther: null,
          lossesCertificate: null,
          lossesDeaths: null,
          lossesOther: null,
          avgWeeklyWorshipAttendance: 165,
          potentialGivingUnits: null,
          baptismsChildren: 6,
          baptismsAdults: null,
          officersRulingElderCount: null,
          officersDeaconCount: null,
        },
        {
          organizationId: "cong-2",
          name: "Bramblewood Presbyterian Church",
          platformStatus: "managed",
          year: 2025,
          hasData: false,
          provenance: null,
          publishedAt: null,
          minuteReference: null,
          endingActive: null,
          endingBaptized: null,
          endingAffiliate: null,
          endingOtherParticipants: null,
          gainsProfessionsUnder18: null,
          gainsProfessions18Plus: null,
          gainsCertificate: null,
          gainsOther: null,
          lossesCertificate: null,
          lossesDeaths: null,
          lossesOther: null,
          avgWeeklyWorshipAttendance: null,
          potentialGivingUnits: null,
          baptismsChildren: null,
          baptismsAdults: null,
          officersRulingElderCount: null,
          officersDeaconCount: null,
        },
      ],
    });
    getPerCapitaOverview.mockResolvedValue({
      kind: "ok",
      data: {
        rate: { billingYear: 2026, basisYear: 2024, ratePerMember: "12.50", updatedAt: "2026-01-01T00:00:00.000Z" },
        records: [
          {
            recordId: "rec-1",
            organizationId: "cong-1",
            name: "Alder Creek Presbyterian Church",
            billingYear: 2026,
            basisYear: 2024,
            endingActiveBasis: 210,
            rateApplied: "12.50",
            amountOwed: "2625.00",
            paidStatus: "unpaid",
            paidAmount: null,
            paidAt: null,
          },
        ],
      },
    });

    const el = await ReportsPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);

    expect(screen.getByRole("heading", { name: "Congregation Statistics" })).toBeTruthy();
    expect(screen.getByText("Congregation reported")).toBeTruthy();
    expect(screen.getByText("No data on file")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Per-Capita" })).toBeTruthy();
    expect(screen.getByText("$2625.00")).toBeTruthy();
    expect(screen.getByRole("button", { name: /generate 2026 records/i })).toBeTruthy();
  });

  it("passes ?year= and ?billingYear= through to the two reads", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockResolvedValue(EMPTY_STATS);
    getPerCapitaOverview.mockResolvedValue(EMPTY_PER_CAPITA);

    await ReportsPage({
      params: makeParams(),
      searchParams: makeSearchParams({ year: "2023", billingYear: "2027" }),
    });

    expect(getCongregationStatisticsRollup).toHaveBeenCalledWith("person-1", "org-1", 2023);
    expect(getPerCapitaOverview).toHaveBeenCalledWith("person-1", "org-1", 2027);
  });
});

describe("ReportsPage — the reports hub (docs/work-log/2026-11-15-presbytery-reports.md)", () => {
  async function renderOk(held = ALL_HELD) {
    cachedAuth.mockResolvedValue({ user: { id: "u1", email: "clerk@example.invalid" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockResolvedValue(EMPTY_STATS);
    getPerCapitaOverview.mockResolvedValue(EMPTY_PER_CAPITA);
    getReportsHub.mockResolvedValue(held);
    const el = await ReportsPage({ params: makeParams(), searchParams: makeSearchParams() });
    render(el);
  }

  it("shows four cards, each a whole-card link to its report when the key is held", async () => {
    await renderOk();
    const hub = within(screen.getByTestId("reports-hub"));
    expect(hub.getByRole("heading", { name: "Reports and exports" })).toBeTruthy();
    const hrefs = hub.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/o/northern-reach/admin/reports/vacant-pulpits",
      "/o/northern-reach/admin/reports/membership-trend",
      "/o/northern-reach/admin/reports/viability",
      "/o/northern-reach/admin/reports/per-capita",
      "/help/presbytery-reports",
    ]);
    expect(hub.getByText(/members of Presbytery of the Northern Reach today/)).toBeTruthy();
    expect(hub.queryByText("Locked")).toBeNull();
  });

  it("a locked card is shown, says why, and is not a link", async () => {
    await renderOk({ held: { vacant_pulpits: false, membership_trend: true, viability: false, per_capita: true } });
    const hub = within(screen.getByTestId("reports-hub"));
    expect(hub.getAllByText("Locked")).toHaveLength(2);
    expect(hub.getByText("You need permission to manage credentials. An administrator can give it under Roles.")).toBeTruthy();
    expect(hub.getByText("You need permission to manage congregation oversight. An administrator can give it under Roles.")).toBeTruthy();
    const hrefs = hub.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/o/northern-reach/admin/reports/vacant-pulpits");
    expect(hrefs).not.toContain("/o/northern-reach/admin/reports/viability");
    expect(hrefs).toContain("/o/northern-reach/admin/reports/membership-trend");
  });

  it("has no table and no heading containing the hyphenated 'Per-Capita' (the existing page and e2e match on it)", async () => {
    await renderOk();
    const hub = screen.getByTestId("reports-hub");
    expect(hub.querySelector("table")).toBeNull();
    for (const h of within(hub).getAllByRole("heading")) expect(h.textContent).not.toMatch(/per-capita/i);
  });

  it("no hub string contains 'don't have permission to manage' (the existing e2e cases match exactly one element)", async () => {
    await renderOk({ held: { vacant_pulpits: false, membership_trend: false, viability: false, per_capita: false } });
    expect(screen.getByTestId("reports-hub").textContent).not.toMatch(/don.t have permission to manage/i);
  });

  it("a failed lock read shows an inline error and leaves the rest of the page rendering", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockResolvedValue(EMPTY_STATS);
    getPerCapitaOverview.mockResolvedValue(EMPTY_PER_CAPITA);
    getReportsHub.mockRejectedValue(new Error("db down"));
    render(await ReportsPage({ params: makeParams(), searchParams: makeSearchParams() }));
    const hub = within(screen.getByTestId("reports-hub"));
    expect(hub.getByText("We couldn't check which reports you can open. Try again in a moment.")).toBeTruthy();
    expect(hub.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/northern-reach/admin/reports");
    expect(screen.getByRole("heading", { name: "Congregation Statistics" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Per-Capita" })).toBeTruthy();
  });

  it("an OrgAccessError from the lock read goes to the error boundary", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockResolvedValue(EMPTY_STATS);
    getPerCapitaOverview.mockResolvedValue(EMPTY_PER_CAPITA);
    getReportsHub.mockRejectedValue(new OrgAccessError("person-1", "org-1"));
    await expect(ReportsPage({ params: makeParams(), searchParams: makeSearchParams() })).rejects.toThrow("mock: no active membership");
  });

  it("reads the lock state for the signed-in viewer at this presbytery", async () => {
    await renderOk();
    expect(getReportsHub).toHaveBeenCalledWith({
      userId: "u1",
      email: "clerk@example.invalid",
      personId: "person-1",
      organizationId: "org-1",
    });
  });

  it("is not read when the flag is off or the organization is not a presbytery", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(false);
    await ReportsPage({ params: makeParams(), searchParams: makeSearchParams() });
    expect(getReportsHub).not.toHaveBeenCalled();
  });
});

describe("ReportsPage — the Node-side second-factor recheck (DECISION-338, P3-5)", () => {
  it("a required, unverified second factor redirects to /totp with the page's own path, before the organization is read", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: false } });
    await expect(ReportsPage({ params: makeParams(), searchParams: makeSearchParams() })).rejects.toThrow(
      "REDIRECT:/totp?callbackUrl=%2Fo%2Fnorthern-reach%2Fadmin%2Freports",
    );
    expect(resolveOrgContext).not.toHaveBeenCalled();
  });

  it("a verified second factor passes", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1", twoFactorRequired: true, twoFactorVerified: true } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(false);
    await ReportsPage({ params: makeParams(), searchParams: makeSearchParams() });
    expect(resolveOrgContext).toHaveBeenCalled();
  });
});

describe("ReportsPage — regression for lenient year parsing (F447)", () => {
  // `?year=` was `Number("")` = 0, which is finite, then clamped to 1900; `?year=1899` and
  // `?year=3000` clamped silently to a year nobody asked for. A bad value now falls back to the
  // default, as the new report pages and exports do (Phase 1 "Query-parameter handling").
  const year = new Date().getUTCFullYear();

  async function readsFor(query: { year?: string; billingYear?: string }) {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockResolvedValue(EMPTY_STATS);
    getPerCapitaOverview.mockResolvedValue(EMPTY_PER_CAPITA);
    await ReportsPage({ params: makeParams(), searchParams: makeSearchParams(query) });
    return {
      statsYear: getCongregationStatisticsRollup.mock.calls[0][2],
      billingYear: getPerCapitaOverview.mock.calls[0][2],
    };
  }

  it.each(["", "abc", "1e3", "0x7e4", " 2023", "-5", "2023.0"])(
    "a malformed ?year=%j falls back to last year (not 1900), and ?billingYear to this year",
    async (bad) => {
      const reads = await readsFor({ year: bad, billingYear: bad });
      expect(reads).toEqual({ statsYear: year - 1, billingYear: year });
    },
  );

  it.each(["1899", "2101", "3000", "0"])("an out-of-range ?year=%s falls back instead of clamping", async (bad) => {
    const reads = await readsFor({ year: bad, billingYear: bad });
    expect(reads).toEqual({ statsYear: year - 1, billingYear: year });
  });

  it("a valid year at each bound is kept", async () => {
    expect(await readsFor({ year: "1900", billingYear: "2100" })).toEqual({ statsYear: 1900, billingYear: 2100 });
  });

  it("an array value (a repeated key) falls back", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED_PRESBYTERY);
    isFlagEnabled.mockResolvedValue(true);
    getCongregationStatisticsRollup.mockResolvedValue(EMPTY_STATS);
    getPerCapitaOverview.mockResolvedValue(EMPTY_PER_CAPITA);
    await ReportsPage({ params: makeParams(), searchParams: Promise.resolve({ year: ["2020", "2021"] } as never) });
    expect(getCongregationStatisticsRollup.mock.calls[0][2]).toBe(year - 1);
  });
});
