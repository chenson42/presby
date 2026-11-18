// @vitest-environment jsdom
/**
 * The Buildings and Insurance-and-loans report pages, with the REAL gate (session, org resolver and flag
 * mocked) and the two readers mocked: the gate, a missing key, an empty roster, a failed read, data, and
 * where the export link and the help link point.
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
  getBuildingsReport: vi.fn(),
  getInsuranceLoans: vi.fn(),
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
vi.mock("@/lib/presbytery-reports/buildings", () => ({ getBuildingsReport: mocks.getBuildingsReport }));
vi.mock("@/lib/presbytery-reports/insurance-loans", () => ({ getInsuranceLoans: mocks.getInsuranceLoans }));

import BuildingsPage from "./buildings/page";
import InsuranceAndLoansPage from "./insurance-and-loans/page";

const ORG = { organizationId: "org-1", personId: "person-1", name: "Northern Reach", organizationType: "presbytery", slug: "northern" };
const params = Promise.resolve({ slug: "northern" });

const buildingsData = (over = {}) => ({
  rosterCount: 2,
  withoutBuildings: 1,
  buildingCount: 1,
  rows: [
    {
      organizationId: "a",
      name: "Alder Creek",
      city: "Alderton",
      county: "Marsh",
      buildingsRetired: 0,
      building: {
        id: "b1", aboutOrgId: "a", name: "Sanctuary", buildingType: "sanctuary", yearBuilt: 1902, firstAdditionYear: null, secondAdditionYear: null,
        squareFeet: null, roofCondition: null, plumbingCondition: null, hvacCondition: null, boilerCondition: null,
        hasSprinklers: null, hasFireAlarm: null, hasSecuritySystem: null, isPrimary: true,
      },
    },
    { organizationId: "b", name: "Bramblewood", city: null, county: null, buildingsRetired: 1, building: null },
  ],
  ...over,
});
const loansData = (over = {}) => ({
  today: "2026-06-15",
  rosterCount: 1,
  rows: [
    {
      organizationId: "a", name: "Alder Creek", insurance: null, openLoans: 0, originalCents: null, balanceCents: null, grantsCents: null,
      originalUnrecorded: 0, balanceUnrecorded: 0, grantsUnrecorded: 0, guarantees: [], appraisedCents: null, buildingsWithoutAppraisal: 0,
    },
  ],
  totals: {
    openLoans: 0, originalCents: null, balanceCents: null, grantsCents: null, originalUnrecorded: 0, balanceUnrecorded: 0, grantsUnrecorded: 0,
    appraisedCents: null, buildingsWithoutAppraisal: 0,
  },
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

describe("buildings page", () => {
  it("renders the title, the subtitle, the three notes, the export link and the help link", async () => {
    mocks.getBuildingsReport.mockResolvedValue({ kind: "ok", data: buildingsData() });
    await renderPage(BuildingsPage({ params }));
    expect(screen.getByRole("heading", { name: "Buildings" })).toBeTruthy();
    expect(screen.getByText("The congregations that are members of Northern Reach today.")).toBeTruthy();
    expect(screen.getByText("A congregation that is no longer active isn't listed here.")).toBeTruthy();
    expect(screen.getByText("The CSV file leaves out street addresses and notes.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")).toBe("/o/northern/admin/reports/buildings/export");
    expect(screen.getByRole("link", { name: "How to read buildings" }).getAttribute("href")).toBe("/help/presbytery-reports#buildings");
    expect(screen.getAllByText("None in use").length).toBeGreaterThan(0);
  });

  it("no member congregations: the empty state and no export link", async () => {
    mocks.getBuildingsReport.mockResolvedValue({ kind: "ok", data: buildingsData({ rosterCount: 0, rows: [], withoutBuildings: 0, buildingCount: 0 }) });
    await renderPage(BuildingsPage({ params }));
    expect(screen.getByText("No member congregations on record")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
  });

  it("a missing key names the oversight permission and shows no table", async () => {
    mocks.getBuildingsReport.mockResolvedValue({ kind: "forbidden" });
    await renderPage(BuildingsPage({ params }));
    expect(screen.getByText(/You don't have permission to manage congregation oversight at Northern Reach/)).toBeTruthy();
    expect(screen.queryByTestId("report-table")).toBeNull();
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
  });

  it("a failed read is the retry state", async () => {
    mocks.getBuildingsReport.mockRejectedValue(new Error("db"));
    await renderPage(BuildingsPage({ params }));
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/northern/admin/reports/buildings");
  });

  it("the gate: flag off, wrong organization type and a stale second factor each stop before any read", async () => {
    mocks.isFlagEnabled.mockResolvedValue(false);
    await renderPage(BuildingsPage({ params }));
    expect(screen.getByText("Per-Capita, SASR & Imports isn't turned on for Northern Reach yet.")).toBeTruthy();
    cleanup();
    mocks.isFlagEnabled.mockResolvedValue(true);
    mocks.resolveOrgContext.mockResolvedValue({ kind: "ok", org: { ...ORG, organizationType: "congregation" } });
    await renderPage(BuildingsPage({ params }));
    expect(screen.getByRole("heading", { name: "Per-Capita, SASR & Imports" })).toBeTruthy();
    mocks.cachedAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    await expect(BuildingsPage({ params })).rejects.toThrow("REDIRECT:/totp?callbackUrl=%2Fo%2Fnorthern%2Fadmin%2Freports%2Fbuildings");
    expect(mocks.getBuildingsReport).not.toHaveBeenCalled();
  });
});

describe("insurance and loans page", () => {
  it("renders the title, the notes (the file keeps guarantees, leaves out the rest), the export link and the help link", async () => {
    mocks.getInsuranceLoans.mockResolvedValue({ kind: "ok", data: loansData() });
    await renderPage(InsuranceAndLoansPage({ params }));
    expect(screen.getByRole("heading", { name: "Insurance and loans" })).toBeTruthy();
    expect(
      screen.getByText("The CSV file leaves out street addresses, policy numbers, lenders and notes. It does include each loan's guarantee."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")).toBe("/o/northern/admin/reports/insurance-and-loans/export");
    expect(screen.getByRole("link", { name: "How to read insurance and loans" }).getAttribute("href")).toBe("/help/presbytery-reports#insurance-and-loans");
  });

  it("no member congregations: the empty state and no export link", async () => {
    mocks.getInsuranceLoans.mockResolvedValue({ kind: "ok", data: loansData({ rosterCount: 0, rows: [] }) });
    await renderPage(InsuranceAndLoansPage({ params }));
    expect(screen.getByText("No member congregations on record")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
  });

  it("a missing key names the property-finances permission (the finance key, not the oversight one)", async () => {
    mocks.getInsuranceLoans.mockResolvedValue({ kind: "forbidden" });
    await renderPage(InsuranceAndLoansPage({ params }));
    expect(screen.getByText(/You don't have permission to manage congregation property finances at Northern Reach/)).toBeTruthy();
    expect(screen.queryByTestId("report-table")).toBeNull();
  });

  it("a failed read is the retry state", async () => {
    mocks.getInsuranceLoans.mockRejectedValue(new Error("db"));
    await renderPage(InsuranceAndLoansPage({ params }));
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/northern/admin/reports/insurance-and-loans");
  });

  it("a stale second factor redirects to /totp before any read", async () => {
    mocks.cachedAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    await expect(InsuranceAndLoansPage({ params })).rejects.toThrow("REDIRECT:/totp?callbackUrl=%2Fo%2Fnorthern%2Fadmin%2Freports%2Finsurance-and-loans");
    expect(mocks.getInsuranceLoans).not.toHaveBeenCalled();
  });
});
