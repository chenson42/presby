// @vitest-environment jsdom
/**
 * The Buildings and Insurance-and-loans views (DECISION-348, C15). Both the card list and the
 * table are in the DOM (CSS hides one), so rows are asserted inside their own `data-testid` container.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { BuildingsData, BuildingsRow, InsuranceLoansData, InsuranceLoansRow } from "@/lib/presbytery-reports/oversight-derive";
import { BuildingsView } from "./buildings-view";
import { InsuranceLoansView } from "./insurance-loans-view";

afterEach(cleanup);

const bRow = (over: Partial<BuildingsRow> = {}): BuildingsRow => ({
  organizationId: "a",
  name: "Alder Creek",
  city: "Alderton",
  county: "Marsh",
  buildingsRetired: 0,
  building: {
    id: "b1",
    aboutOrgId: "a",
    name: "Sanctuary",
    buildingType: "sanctuary",
    yearBuilt: 1902,
    firstAdditionYear: null,
    secondAdditionYear: null,
    squareFeet: 12500,
    roofCondition: "good",
    plumbingCondition: null,
    hvacCondition: "poor",
    boilerCondition: null,
    hasSprinklers: true,
    hasFireAlarm: false,
    hasSecuritySystem: null,
    isPrimary: true,
  },
  ...over,
});
const bData = (rows: BuildingsRow[], over: Partial<BuildingsData> = {}): BuildingsData => ({
  rosterCount: new Set(rows.map((r) => r.organizationId)).size,
  rows,
  withoutBuildings: rows.filter((r) => r.building === null).length,
  buildingCount: rows.filter((r) => r.building !== null).length,
  ...over,
});

describe("BuildingsView", () => {
  it("shows a building's facts in both layouts, with Not recorded for a blank one and the primary marked in words", () => {
    render(<BuildingsView data={bData([bRow()])} />);
    const cards = within(screen.getByTestId("report-cards"));
    expect(cards.getByText("Alder Creek")).toBeTruthy();
    expect(cards.getByText("Alderton, Marsh")).toBeTruthy();
    expect(cards.getAllByText("Sanctuary")).toHaveLength(2); // the building's name and its type
    expect(cards.getByText("Primary")).toBeTruthy();
    expect(cards.getByText("12,500")).toBeTruthy();
    expect(cards.getByText("Good")).toBeTruthy();
    expect(cards.getByText("Poor")).toBeTruthy();
    expect(cards.getAllByText("Not recorded").length).toBeGreaterThan(0);
    const table = within(screen.getByTestId("report-table"));
    for (const h of ["Congregation", "City", "County", "Building", "Type", "Year built", "Square feet", "Roof", "Plumbing", "Heating and cooling (HVAC)", "Boiler", "Sprinklers", "Fire alarm", "Security system", "Primary"]) {
      expect(table.getByRole("columnheader", { name: h }), h).toBeTruthy();
    }
    expect(table.getByRole("cell", { name: "1902" })).toBeTruthy();
  });

  it("a congregation with every recorded building retired says None in use; one with none ever says Not recorded", () => {
    const data = bData([
      bRow({ organizationId: "c", name: "Cedar Hollow", building: null, buildingsRetired: 2 }),
      bRow({ organizationId: "d", name: "Dunmore Ridge", building: null, buildingsRetired: 0 }),
    ]);
    render(<BuildingsView data={data} />);
    for (const scope of [within(screen.getByTestId("report-cards")), within(screen.getByTestId("report-table"))]) {
      expect(scope.getAllByText("None in use")).toHaveLength(1);
      expect(scope.getAllByText("Not recorded")).toHaveLength(1);
    }
    expect(screen.queryByText("None recorded")).toBeNull();
  });

  it("says how many buildings in how many congregations", () => {
    render(<BuildingsView data={bData([bRow(), bRow({ building: null })], { rosterCount: 2 })} />);
    expect(screen.getByText("1 building in 1 congregation")).toBeTruthy();
  });

  it("no member congregations is the shared empty state", () => {
    render(<BuildingsView data={bData([], { rosterCount: 0 })} />);
    expect(screen.getByText("No member congregations on record")).toBeTruthy();
  });
});

const iRow = (over: Partial<InsuranceLoansRow> = {}): InsuranceLoansRow => ({
  organizationId: "a",
  name: "Alder Creek",
  insurance: { policyYear: 2026, carrier: "Harbor Mutual", policyExpiresOn: "2026-03-01", expiry: "expired", recentClaims: false, poolInterest: null },
  openLoans: 2,
  originalCents: 50_000_000,
  balanceCents: 30_000_000,
  grantsCents: null,
  originalUnrecorded: 0,
  balanceUnrecorded: 1,
  grantsUnrecorded: 2,
  guarantees: ["Guaranteed by the synod"],
  appraisedCents: 120_000_000,
  buildingsWithoutAppraisal: 1,
  ...over,
});
const iData = (rows: InsuranceLoansRow[], over: Partial<InsuranceLoansData> = {}): InsuranceLoansData => ({
  today: "2026-06-15",
  rosterCount: rows.length,
  rows,
  totals: {
    openLoans: 2,
    originalCents: 50_000_000,
    balanceCents: 30_000_000,
    grantsCents: null,
    originalUnrecorded: 0,
    balanceUnrecorded: 1,
    grantsUnrecorded: 2,
    appraisedCents: 120_000_000,
    buildingsWithoutAppraisal: 1,
  },
  ...over,
});

describe("InsuranceLoansView", () => {
  it("shows insurance, loans, a guarantee and an appraised value, with Expired in words and '{n} not recorded' beside a partial total", () => {
    render(<InsuranceLoansView data={iData([iRow()])} />);
    const cards = within(within(screen.getByTestId("report-cards")).getAllByRole("listitem")[0]);
    expect(cards.getByText("Harbor Mutual")).toBeTruthy();
    expect(cards.getByText("2026")).toBeTruthy();
    expect(cards.getByText("Expired")).toBeTruthy();
    expect(cards.getByText("$500,000")).toBeTruthy();
    expect(cards.getAllByText("1 not recorded").length).toBeGreaterThan(0);
    expect(cards.getByText("Guaranteed by the synod")).toBeTruthy();
    expect(cards.getAllByText("$1,200,000").length).toBeGreaterThan(0);
    const table = within(screen.getByTestId("report-table"));
    for (const h of ["Congregation", "Carrier", "Policy year", "Policy expires", "Recent claims", "Interested in the insurance pool", "Open loans", "Original amount", "Current balance", "Grants", "Guarantee", "Appraised value"]) {
      expect(table.getByRole("columnheader", { name: h }), h).toBeTruthy();
    }
    expect(table.getByText("Total")).toBeTruthy();
  });

  it("never prints a dollar zero for a figure nobody recorded: a null sum is Not recorded, and the count is not shown beside nothing", () => {
    render(<InsuranceLoansView data={iData([iRow()])} />);
    const cards = within(screen.getByTestId("report-cards"));
    expect(cards.queryByText("$0")).toBeNull();
    expect(cards.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(cards.queryByText("2 not recorded")).toBeNull(); // the grants sum is null: no figure to qualify
  });

  it("a congregation with no records still has a row: no insurance, no loans", () => {
    render(
      <InsuranceLoansView
        data={iData([iRow({ name: "Cedar Hollow", organizationId: "c", insurance: null, openLoans: 0, originalCents: null, balanceCents: null, appraisedCents: null, buildingsWithoutAppraisal: 0, guarantees: [] })])}
      />,
    );
    const cards = within(screen.getByTestId("report-cards"));
    expect(cards.getByText("Cedar Hollow")).toBeTruthy();
    expect(cards.getByText("0")).toBeTruthy();
    expect(cards.queryByText("Guarantee")).toBeNull();
  });

  it("a current policy is not badged expired", () => {
    render(<InsuranceLoansView data={iData([iRow({ insurance: { policyYear: 2026, carrier: null, policyExpiresOn: "2026-12-31", expiry: "current", recentClaims: null, poolInterest: null } })])} />);
    expect(screen.queryByText("Expired")).toBeNull();
  });

  it("no member congregations is the shared empty state", () => {
    render(<InsuranceLoansView data={iData([], { rosterCount: 0 })} />);
    expect(screen.getByText("No member congregations on record")).toBeTruthy();
  });
});
