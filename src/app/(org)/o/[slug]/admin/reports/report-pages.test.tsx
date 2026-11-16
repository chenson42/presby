// @vitest-environment jsdom
/**
 * The four report pages, with the REAL gate (session, org resolver and flag
 * mocked) and the four `getX` readers mocked: what each page renders for an ok
 * read, an empty one, a missing key, a failed read and a refused gate; where its
 * export link points; and that a bad query falls back to the default instead of
 * clamping (docs/work-log/2026-11-15-presbytery-reports.md, F447).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  FakeOrgAccessError: class FakeOrgAccessError extends Error {},
  cachedAuth: vi.fn(),
  resolveOrgContext: vi.fn(),
  assertOrgAccess: vi.fn(),
  isFlagEnabled: vi.fn(),
  getVacantPulpits: vi.fn(),
  getMembershipTrend: vi.fn(),
  getViability: vi.fn(),
  getPerCapita: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: mocks.cachedAuth }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/lib/authz", () => ({
  OrgAccessError: mocks.FakeOrgAccessError,
  resolveOrgContext: mocks.resolveOrgContext,
  assertOrgAccess: mocks.assertOrgAccess,
}));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: mocks.isFlagEnabled }));
vi.mock("@/lib/presbytery-reports/vacant-pulpits", () => ({ getVacantPulpits: mocks.getVacantPulpits }));
vi.mock("@/lib/presbytery-reports/membership-trend", () => ({ getMembershipTrend: mocks.getMembershipTrend }));
vi.mock("@/lib/presbytery-reports/viability", () => ({ getViability: mocks.getViability }));
vi.mock("@/lib/presbytery-reports/per-capita", () => ({ getPerCapita: mocks.getPerCapita }));

import VacantPulpitsPage from "./vacant-pulpits/page";
import MembershipTrendPage from "./membership-trend/page";
import ViabilityPage from "./viability/page";
import PerCapitaReportPage from "./per-capita/page";

const ORG = { organizationId: "org-1", personId: "person-1", name: "Northern Reach", organizationType: "presbytery", slug: "northern" };
const params = Promise.resolve({ slug: "northern" });
const search = (q: Record<string, string | string[]> = {}) => Promise.resolve(q);
const thisYear = new Date().getUTCFullYear();

const vacantData = (over = {}) => ({
  today: "2026-06-15",
  rosterCount: 2,
  appointmentsRecorded: true,
  rows: [{ organizationId: "a", name: "Dunmore Ridge", vacantSince: "2024-03-15", daysVacant: 822, supply: null }],
  ...over,
});
const emptyTrend = (from: number, to: number, over = {}) => ({
  from,
  to,
  years: Array.from({ length: to - from + 1 }, (_, i) => from + i),
  rosterCount: 1,
  rows: [{ organizationId: "a", name: "Alder Creek", cells: Array.from({ length: to - from + 1 }, () => ({ kind: "value", endingActive: 10, source: "presbytery_entered" })) }],
  footer: Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i, total: 10, reporting: 1, members: 1 })),
  hasData: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cachedAuth.mockResolvedValue({ user: { id: "user-1", email: "clerk@example.invalid" } });
  mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: ORG });
  mocks.assertOrgAccess.mockResolvedValue(undefined);
  mocks.isFlagEnabled.mockResolvedValue(true);
});
afterEach(cleanup);

async function renderPage(page: Promise<React.ReactNode> | React.ReactNode) {
  render(<>{await page}</>);
}

describe("the gate, on a page", () => {
  it("flag off renders the placeholder (200), not the report", async () => {
    mocks.isFlagEnabled.mockResolvedValue(false);
    await renderPage(VacantPulpitsPage({ params }));
    expect(screen.getByText("Per-Capita, SASR & Imports isn't turned on for Northern Reach yet.")).toBeTruthy();
    expect(mocks.getVacantPulpits).not.toHaveBeenCalled();
  });

  it("a congregation reaching a report URL sees 'isn't available'", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
    await renderPage(ViabilityPage({ params }));
    expect(screen.getByRole("heading", { name: "Per-Capita, SASR & Imports" })).toBeTruthy();
    expect(mocks.getViability).not.toHaveBeenCalled();
  });

  it("a stale second-factor claim redirects to /totp with the page's own path, before any read", async () => {
    mocks.cachedAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    await expect(PerCapitaReportPage({ params, searchParams: search({ billingYear: "2025" }) })).rejects.toThrow(
      `REDIRECT:/totp?callbackUrl=${encodeURIComponent("/o/northern/admin/reports/per-capita?billingYear=2025")}`,
    );
    expect(mocks.getPerCapita).not.toHaveBeenCalled();
  });

  it("no such organization is a 404", async () => {
    mocks.resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(ViabilityPage({ params })).rejects.toThrow("NOT_FOUND");
  });
});

describe("vacant pulpits page", () => {
  it("renders the report, its standing notes, and a plain-anchor export link", async () => {
    mocks.getVacantPulpits.mockResolvedValue({ kind: "ok", data: vacantData() });
    await renderPage(VacantPulpitsPage({ params }));
    expect(screen.getByRole("heading", { level: 1, name: "Vacant pulpits" })).toBeTruthy();
    expect(screen.getByText(/Based on the appointments recorded on Credentials/)).toBeTruthy();
    expect(screen.getByText(/Stated, interim and temporary supply do not count/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Export CSV" });
    expect(link.getAttribute("href")).toBe("/o/northern/admin/reports/vacant-pulpits/export");
    expect(link.hasAttribute("download")).toBe(true);
    expect(screen.getByRole("link", { name: "How to read vacant pulpits" }).getAttribute("href")).toBe("/help/presbytery-reports#vacant-pulpits");
  });

  it("zero appointments: no export link and the honest message", async () => {
    mocks.getVacantPulpits.mockResolvedValue({ kind: "ok", data: vacantData({ appointmentsRecorded: false, rows: [] }) });
    await renderPage(VacantPulpitsPage({ params }));
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
    expect(screen.getByText("No pastoral appointments are recorded yet")).toBeTruthy();
  });

  it("no vacancies: no export link", async () => {
    mocks.getVacantPulpits.mockResolvedValue({ kind: "ok", data: vacantData({ rows: [] }) });
    await renderPage(VacantPulpitsPage({ params }));
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
    expect(screen.getByText("No vacant pulpits")).toBeTruthy();
  });

  it("a missing key shows the permission sentence and no export", async () => {
    mocks.getVacantPulpits.mockResolvedValue({ kind: "forbidden" });
    await renderPage(VacantPulpitsPage({ params }));
    expect(screen.getByText(/You don't have permission to manage credentials at Northern Reach/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
  });

  it("a failed read shows the load error, retrying this same page", async () => {
    mocks.getVacantPulpits.mockRejectedValue(new Error("db down"));
    await renderPage(VacantPulpitsPage({ params }));
    expect(screen.getByText("We couldn't load this report right now. Try again in a moment.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/northern/admin/reports/vacant-pulpits");
  });

  it("an OrgAccessError goes to the error boundary", async () => {
    mocks.getVacantPulpits.mockRejectedValue(new mocks.FakeOrgAccessError("ended"));
    await expect(VacantPulpitsPage({ params })).rejects.toBeInstanceOf(mocks.FakeOrgAccessError);
  });
});

describe("membership trend page", () => {
  it("reads the default window (the five years ending last year) and links the window and its export", async () => {
    mocks.getMembershipTrend.mockImplementation(async (_v, w) => ({ kind: "ok", data: emptyTrend(w.from, w.to) }));
    await renderPage(MembershipTrendPage({ params, searchParams: search() }));
    const to = thisYear - 1;
    expect(mocks.getMembershipTrend.mock.calls[0][1]).toEqual({ from: to - 4, to });
    expect(screen.getByText(`${to - 4} to ${to}`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")).toBe(
      `/o/northern/admin/reports/membership-trend/export?from=${to - 4}&to=${to}`,
    );
    expect(screen.getByRole("link", { name: /Earlier years/ }).getAttribute("href")).toBe(
      `/o/northern/admin/reports/membership-trend?from=${to - 9}&to=${to - 5}`,
    );
  });

  it("a bad window falls back to the default (not clamped to 1900)", async () => {
    mocks.getMembershipTrend.mockImplementation(async (_v, w) => ({ kind: "ok", data: emptyTrend(w.from, w.to) }));
    await renderPage(MembershipTrendPage({ params, searchParams: search({ from: "", to: "abc" }) }));
    expect(mocks.getMembershipTrend.mock.calls[0][1]).toEqual({ from: thisYear - 5, to: thisYear - 1 });
  });

  it("omits 'Later years' when the next window would pass 2100", async () => {
    mocks.getMembershipTrend.mockImplementation(async (_v, w) => ({ kind: "ok", data: emptyTrend(w.from, w.to) }));
    await renderPage(MembershipTrendPage({ params, searchParams: search({ from: "2096", to: "2100" }) }));
    expect(screen.queryByRole("link", { name: /Later years/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Earlier years/ })).toBeTruthy();
  });

  it("nothing in the window: no export link", async () => {
    mocks.getMembershipTrend.mockImplementation(async (_v, w) => ({ kind: "ok", data: emptyTrend(w.from, w.to, { hasData: false }) }));
    await renderPage(MembershipTrendPage({ params, searchParams: search({ from: "2021", to: "2025" }) }));
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
    expect(screen.getByText("No statistics recorded for 2021 to 2025")).toBeTruthy();
  });

  it("a missing key", async () => {
    mocks.getMembershipTrend.mockResolvedValue({ kind: "forbidden" });
    await renderPage(MembershipTrendPage({ params, searchParams: search() }));
    expect(screen.getByText(/You don't have permission to manage statistics at Northern Reach/)).toBeTruthy();
  });
});

describe("viability page", () => {
  it("renders the scale in the subtitle and the export link", async () => {
    mocks.getViability.mockResolvedValue({
      kind: "ok",
      data: { rosterCount: 1, anyNotAssessed: false, rows: [{ organizationId: "a", name: "Alder Creek", score: 3, label: "Healthy", notes: null, lastUpdated: null }] },
    });
    await renderPage(ViabilityPage({ params }));
    expect(screen.getByText("Northern Reach's own assessment of each congregation. At risk is 1 and Healthy is 3.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")).toBe("/o/northern/admin/reports/viability/export");
  });

  it("a missing key and a failed read", async () => {
    mocks.getViability.mockResolvedValue({ kind: "forbidden" });
    await renderPage(ViabilityPage({ params }));
    expect(screen.getByText(/manage congregation oversight at Northern Reach/)).toBeTruthy();
    cleanup();
    mocks.getViability.mockRejectedValue(new Error("db"));
    await renderPage(ViabilityPage({ params }));
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/northern/admin/reports/viability");
  });
});

describe("per capita page", () => {
  const data = (over = {}) => ({
    billingYear: 2025,
    rateBasisYear: 2023,
    rosterCount: 1,
    rows: [
      { billingYear: 2025, organizationId: "a", name: "Alder Creek", membership: "member", basisYear: 2023, endingActiveBasis: 100, rateApplied: "26.25", billedCents: 262500, paidCents: 0, outstandingCents: 262500, status: "unpaid", paidOn: null, notBilledReason: null },
    ],
    totals: { billedCents: 262500, paidCents: 0, outstandingCents: 262500 },
    anyBillsAnyYear: true,
    ...over,
  });

  it("reads the year in the query, links the neighbouring years and offers both exports", async () => {
    mocks.getPerCapita.mockResolvedValue({ kind: "ok", data: data() });
    await renderPage(PerCapitaReportPage({ params, searchParams: search({ billingYear: "2025" }) }));
    expect(mocks.getPerCapita.mock.calls[0][1]).toEqual({ kind: "year", billingYear: 2025 });
    expect(screen.getByRole("link", { name: "‹ 2024" }).getAttribute("href")).toBe("/o/northern/admin/reports/per-capita?billingYear=2024");
    expect(screen.getByRole("link", { name: "2026 ›" }).getAttribute("href")).toBe("/o/northern/admin/reports/per-capita?billingYear=2026");
    expect(screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")).toBe("/o/northern/admin/reports/per-capita/export?billingYear=2025");
    expect(screen.getByRole("link", { name: "Export all years" }).getAttribute("href")).toBe("/o/northern/admin/reports/per-capita/export?allYears=1");
  });

  it("a bad billingYear falls back to the current year (not clamped to 1900)", async () => {
    mocks.getPerCapita.mockResolvedValue({ kind: "ok", data: data() });
    await renderPage(PerCapitaReportPage({ params, searchParams: search({ billingYear: "" }) }));
    expect(mocks.getPerCapita.mock.calls[0][1]).toEqual({ kind: "year", billingYear: thisYear });
  });

  it("a year with no bills hides 'Export CSV' but keeps 'Export all years' while any bill exists", async () => {
    mocks.getPerCapita.mockResolvedValue({ kind: "ok", data: data({ rows: [], totals: { billedCents: 0, paidCents: 0, outstandingCents: 0 } }) });
    await renderPage(PerCapitaReportPage({ params, searchParams: search({ billingYear: "2031" }) }));
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
    expect(screen.getByRole("link", { name: "Export all years" })).toBeTruthy();
    expect(screen.getByText("No per-capita bills for 2031")).toBeTruthy();
  });

  it("no bills in any year: no export at all", async () => {
    mocks.getPerCapita.mockResolvedValue({ kind: "ok", data: data({ rows: [], anyBillsAnyYear: false }) });
    await renderPage(PerCapitaReportPage({ params, searchParams: search({ billingYear: "2031" }) }));
    expect(screen.queryByRole("link", { name: /Export/ })).toBeNull();
  });

  it("a missing key", async () => {
    mocks.getPerCapita.mockResolvedValue({ kind: "forbidden" });
    await renderPage(PerCapitaReportPage({ params, searchParams: search() }));
    expect(screen.getByText(/manage per-capita billing at Northern Reach/)).toBeTruthy();
  });
});
