// @vitest-environment jsdom
/**
 * The report views and their small parts (docs/work-log/2026-11-15-presbytery-
 * reports.md, Phase 3 Test Plan "Component and page"). Both the card list and
 * the table are in the DOM (CSS hides one), so rows are asserted inside their
 * own `data-testid` container.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type {
  MembershipTrendData,
  PerCapitaData,
  PerCapitaRow,
  VacantPulpitsData,
  ViabilityData,
} from "@/lib/presbytery-reports/derive";
import { ExportButton } from "./export-button";
import { MembershipTrendView, TrendCellText } from "./membership-trend-view";
import { PerCapitaView } from "./per-capita-view";
import { ReportFrame } from "./report-frame";
import { ReportEmpty, ReportLoadError } from "./report-states";
import { VacantPulpitsView } from "./vacant-pulpits-view";
import { ViabilityView } from "./viability-view";
import { YearNav } from "./year-nav";

afterEach(cleanup);

const SLUG = "northern";

describe("ExportButton", () => {
  it("is a plain anchor with download and the export href, 44px high, full width on a phone", () => {
    render(<ExportButton href="/o/northern/admin/reports/viability/export" label="Export CSV" />);
    const link = screen.getByRole("link", { name: "Export CSV" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/o/northern/admin/reports/viability/export");
    expect(link.hasAttribute("download")).toBe(true);
    expect(link.className).toMatch(/min-h-11/);
    expect(link.className).toMatch(/w-full/);
  });
});

describe("ReportFrame, YearNav and the states", () => {
  it("renders the back link, h1, subtitle, notes, actions, nav and help link", () => {
    render(
      <ReportFrame
        slug={SLUG}
        title="Viability"
        subtitle="Northern Reach's own assessment"
        notes={["A note."]}
        actions={<ExportButton href="/x/export" label="Export CSV" />}
        nav={<YearNav ariaLabel="Viability" label="2025" prev={{ href: "/p", text: "‹ 2024" }} next={{ href: "/n", text: "2026 ›" }} />}
        helpHref="/help/presbytery-reports#viability"
        helpLabel="How to read viability"
      >
        <p>body</p>
      </ReportFrame>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Viability" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to reports/ }).getAttribute("href")).toBe("/o/northern/admin/reports");
    expect(screen.getByText("A note.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "‹ 2024" }).getAttribute("href")).toBe("/p");
    expect(screen.getByRole("link", { name: "2026 ›" }).getAttribute("href")).toBe("/n");
    expect(screen.getByRole("link", { name: "How to read viability" }).getAttribute("href")).toBe("/help/presbytery-reports#viability");
  });

  it("YearNav omits a link that would leave the year range", () => {
    render(<YearNav ariaLabel="x" label="1900" prev={null} next={{ href: "/n", text: "1901 ›" }} />);
    expect(screen.queryByRole("link", { name: /1899/ })).toBeNull();
    expect(screen.getByRole("link", { name: "1901 ›" })).toBeTruthy();
  });

  it("ReportLoadError says it plainly and retries the same page", () => {
    render(<ReportLoadError retryHref="/o/northern/admin/reports/per-capita?billingYear=2025" />);
    expect(screen.getByRole("alert").textContent).toContain("We couldn't load this report right now. Try again in a moment.");
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/northern/admin/reports/per-capita?billingYear=2025");
  });

  it("ReportEmpty renders an action link when given one", () => {
    render(<ReportEmpty title="T" body="B" action={{ href: "/a", label: "Go" }} />);
    expect(screen.getByRole("link", { name: "Go" }).getAttribute("href")).toBe("/a");
  });
});

// ── Vacant pulpits ─────────────────────────────────────────────────────────

const vacant = (over: Partial<VacantPulpitsData> = {}): VacantPulpitsData => ({
  today: "2026-06-15",
  rosterCount: 3,
  appointmentsRecorded: true,
  rows: [
    { organizationId: "a", name: "Dunmore Ridge", vacantSince: "2024-03-15", daysVacant: 822, supply: { callType: "interim_pastor", startsOn: "2025-01-02" } },
    { organizationId: "b", name: "Cedar Hollow", vacantSince: null, daysVacant: null, supply: null },
  ],
  ...over,
});

describe("VacantPulpitsView", () => {
  it("shows the count, the time vacant, the supply and 'no earlier pastor on record', in cards and table", () => {
    render(<VacantPulpitsView data={vacant()} slug={SLUG} />);
    expect(screen.getByTestId("vacant-count").textContent).toBe("2 vacant of 3 congregations");
    for (const id of ["report-cards", "report-table"]) {
      const scope = within(screen.getByTestId(id));
      expect(scope.getByText("Dunmore Ridge")).toBeTruthy();
      expect(scope.getByText("2 years, 3 months")).toBeTruthy();
      expect(scope.getByText(/Interim Pastor since/)).toBeTruthy();
      expect(scope.getByText("No earlier pastor on record")).toBeTruthy();
      expect(scope.getByText("None recorded")).toBeTruthy();
    }
  });

  it("card list is phone-only and the table starts at sm", () => {
    render(<VacantPulpitsView data={vacant()} slug={SLUG} />);
    expect(screen.getByTestId("report-cards").className).toMatch(/sm:hidden/);
    expect(screen.getByTestId("report-table").className).toMatch(/hidden sm:block/);
  });

  it("a long congregation name wraps in the card", () => {
    render(<VacantPulpitsView data={vacant()} slug={SLUG} />);
    expect(within(screen.getByTestId("report-cards")).getByText("Dunmore Ridge").className).toMatch(/break-words/);
  });

  it("zero appointments recorded: no list, an honest message and a link to Credentials", () => {
    render(<VacantPulpitsView data={vacant({ appointmentsRecorded: false, rows: [] })} slug={SLUG} />);
    expect(screen.getByText("No pastoral appointments are recorded yet")).toBeTruthy();
    expect(screen.getByText("So vacancies can't be worked out. Record appointments on Credentials.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Credentials" }).getAttribute("href")).toBe("/o/northern/admin/credentials");
    expect(screen.queryByTestId("report-table")).toBeNull();
  });

  it("appointments exist and none are vacant", () => {
    render(<VacantPulpitsView data={vacant({ rows: [] })} slug={SLUG} />);
    expect(screen.getByText("No vacant pulpits")).toBeTruthy();
    expect(screen.getByText("Every congregation has an installed or designated pastor on record today.")).toBeTruthy();
  });

  it("no member congregations", () => {
    render(<VacantPulpitsView data={vacant({ rosterCount: 0, appointmentsRecorded: false, rows: [] })} slug={SLUG} />);
    expect(screen.getByText("No member congregations on record")).toBeTruthy();
  });
});

// ── Membership trend ───────────────────────────────────────────────────────

const trend = (over: Partial<MembershipTrendData> = {}): MembershipTrendData => ({
  from: 2023,
  to: 2025,
  years: [2023, 2024, 2025],
  rosterCount: 2,
  hasData: true,
  rows: [
    {
      organizationId: "a",
      name: "Alder Creek",
      cells: [{ kind: "not_member" }, { kind: "no_data" }, { kind: "value", endingActive: 120, source: "presbytery_entered" }],
    },
    {
      organizationId: "b",
      name: "Bramblewood",
      cells: [{ kind: "value", endingActive: null, source: "imported" }, { kind: "value", endingActive: 50, source: "published_by_congregation" }, { kind: "no_data" }],
    },
  ],
  footer: [
    { year: 2023, total: 0, reporting: 0, members: 1 },
    { year: 2024, total: 50, reporting: 1, members: 2 },
    { year: 2025, total: 120, reporting: 1, members: 2 },
  ],
  ...over,
});

describe("MembershipTrendView", () => {
  it("renders the dash, 'No data' and 'Not reported' as three distinct things", () => {
    render(
      <div>
        <p data-testid="dash">
          <TrendCellText cell={{ kind: "not_member" }} />
        </p>
        <p data-testid="nodata">
          <TrendCellText cell={{ kind: "no_data" }} />
        </p>
        <p data-testid="notreported">
          <TrendCellText cell={{ kind: "value", endingActive: null, source: "imported" }} />
        </p>
        <p data-testid="number">
          <TrendCellText cell={{ kind: "value", endingActive: 0, source: "imported" }} />
        </p>
      </div>,
    );
    expect(screen.getByTestId("dash").textContent).toBe("—Not a member that year");
    expect(screen.getByTestId("dash").querySelector(".sr-only")?.textContent).toBe("Not a member that year");
    expect(screen.getByTestId("nodata").textContent).toBe("No data");
    expect(screen.getByTestId("notreported").textContent).toBe("Not reported");
    expect(screen.getByTestId("number").textContent).toBe("0"); // a zero is a number, not "no data"
  });

  it("the table has the years as columns and a 'Total reported' footer saying how many reported", () => {
    render(<MembershipTrendView data={trend()} slug={SLUG} />);
    const table = within(screen.getByTestId("report-table"));
    for (const year of ["2023", "2024", "2025"]) expect(table.getByRole("columnheader", { name: year })).toBeTruthy();
    expect(table.getByText("Total reported")).toBeTruthy();
    expect(table.getAllByText("1 of 2 reporting")).toHaveLength(2); // 2024 and 2025
    expect(table.getByText("0 of 1 reporting")).toBeTruthy();
  });

  it("the cards list newest year first, and a total card follows", () => {
    render(<MembershipTrendView data={trend()} slug={SLUG} />);
    const cards = within(screen.getByTestId("report-cards"));
    const first = cards.getByText("Alder Creek").closest("li")!;
    const labels = within(first).getAllByRole("term").map((t) => t.textContent);
    expect(labels).toEqual(["2025", "2024", "2023"]);
    expect(within(screen.getByTestId("report-cards-total")).getByText("Total reported")).toBeTruthy();
  });

  it("uses lg as the breakpoint (ten year columns do not fit below it)", () => {
    render(<MembershipTrendView data={trend()} slug={SLUG} />);
    expect(screen.getByTestId("report-cards").className).toMatch(/lg:hidden/);
    expect(screen.getByTestId("report-table").className).toMatch(/hidden lg:block/);
  });

  it("nothing in the window: the empty state with the 'Record statistics' link, and no grid", () => {
    render(<MembershipTrendView data={trend({ hasData: false })} slug={SLUG} />);
    expect(screen.getByText("No statistics recorded for 2023 to 2025")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Record statistics" }).getAttribute("href")).toBe("/o/northern/admin/reports?year=2025");
    expect(screen.queryByTestId("report-table")).toBeNull();
  });

  it("no member congregations", () => {
    render(<MembershipTrendView data={trend({ rosterCount: 0, hasData: false, rows: [] })} slug={SLUG} />);
    expect(screen.getByText("No member congregations on record")).toBeTruthy();
  });
});

// ── Viability ──────────────────────────────────────────────────────────────

const viability = (over: Partial<ViabilityData> = {}): ViabilityData => ({
  rosterCount: 3,
  anyNotAssessed: true,
  rows: [
    { organizationId: "a", name: "Bramblewood", score: 1, label: "At risk", notes: "Roof, boiler", lastUpdated: "2026-02-02" },
    { organizationId: "b", name: "Alder Creek", score: 3, label: "Healthy", notes: null, lastUpdated: "2026-01-01" },
    { organizationId: "c", name: "Cedar Hollow", score: null, label: "Not yet assessed", notes: "Watching", lastUpdated: null },
  ],
  ...over,
});

describe("ViabilityView", () => {
  it("shows each label, the notes, and a dash where there are none, in cards and table", () => {
    render(<ViabilityView data={viability()} slug={SLUG} />);
    for (const id of ["report-cards", "report-table"]) {
      const scope = within(screen.getByTestId(id));
      expect(scope.getByText("At risk")).toBeTruthy();
      expect(scope.getByText("Healthy")).toBeTruthy();
      expect(scope.getByText("Not yet assessed")).toBeTruthy();
      expect(scope.getByText("Roof, boiler")).toBeTruthy();
      expect(scope.getByText("Watching")).toBeTruthy();
      expect(scope.getAllByText("—").length).toBeGreaterThan(0);
    }
  });

  it("points to Congregation Oversight when any row is not assessed, and not otherwise", () => {
    const { unmount } = render(<ViabilityView data={viability()} slug={SLUG} />);
    expect(screen.getByRole("link", { name: "Open Congregation Oversight" }).getAttribute("href")).toBe("/o/northern/admin/oversight");
    unmount();
    render(<ViabilityView data={viability({ anyNotAssessed: false })} slug={SLUG} />);
    expect(screen.queryByText("Assess a congregation on Congregation Oversight.")).toBeNull();
  });

  it("no member congregations", () => {
    render(<ViabilityView data={viability({ rosterCount: 0, rows: [] })} slug={SLUG} />);
    expect(screen.getByText("No member congregations on record")).toBeTruthy();
  });
});

// ── Per capita ─────────────────────────────────────────────────────────────

const pc = (over: Partial<PerCapitaRow>): PerCapitaRow => ({
  billingYear: 2025,
  organizationId: "a",
  name: "Alder Creek",
  membership: "member",
  basisYear: 2023,
  endingActiveBasis: 100,
  rateApplied: "26.25",
  billedCents: 262500,
  paidCents: 100000,
  outstandingCents: 162500,
  status: "partly_paid",
  paidOn: "2025-04-01",
  notBilledReason: null,
  ...over,
});
const perCapita = (rows: PerCapitaRow[], over: Partial<PerCapitaData> = {}): PerCapitaData => ({
  billingYear: 2025,
  rateBasisYear: 2023,
  rosterCount: 4,
  rows,
  totals: { billedCents: 272500, paidCents: 111200, outstandingCents: 161300 },
  anyBillsAnyYear: true,
  ...over,
});

describe("PerCapitaView", () => {
  const rows = [
    pc({}),
    pc({ organizationId: "b", name: "Bramblewood", billedCents: 10000, paidCents: 11200, outstandingCents: -1200, status: "paid" }),
    pc({ organizationId: "c", name: "Cedar Hollow", billedCents: null, paidCents: null, outstandingCents: null, status: "not_billed", notBilledReason: "no_statistics" }),
    pc({ organizationId: "d", name: "Dunmore Ridge", billedCents: null, paidCents: null, outstandingCents: null, status: "not_billed", notBilledReason: "not_generated" }),
    pc({ organizationId: "e", name: "Hollis Bend", membership: "departed", status: "unpaid", paidCents: 0, outstandingCents: 262500 }),
  ];

  it("shows money grouped, an overpayment as a credit, and a total", () => {
    render(<PerCapitaView data={perCapita(rows)} slug={SLUG} billingYear={2025} />);
    const table = within(screen.getByTestId("report-table"));
    expect(table.getAllByText("$2,625.00").length).toBeGreaterThan(0);
    expect(table.getByText("$12.00 credit")).toBeTruthy();
    expect(table.getByText("Total")).toBeTruthy();
    expect(table.getByText("$2,725.00")).toBeTruthy();
    expect(within(screen.getByTestId("report-cards-total")).getByText("$1,613.00")).toBeTruthy();
  });

  it("says why a congregation is not billed, in two truthful ways", () => {
    render(<PerCapitaView data={perCapita(rows)} slug={SLUG} billingYear={2025} />);
    const table = within(screen.getByTestId("report-table"));
    expect(table.getAllByText("Not billed")).toHaveLength(2);
    expect(table.getByText("No statistics on file for 2023")).toBeTruthy();
    expect(table.getByText("Not generated yet")).toBeTruthy();
  });

  it("marks a congregation that has left", () => {
    render(<PerCapitaView data={perCapita(rows)} slug={SLUG} billingYear={2025} />);
    expect(within(screen.getByTestId("report-table")).getByText("No longer a member")).toBeTruthy();
    expect(within(screen.getByTestId("report-cards")).getByText("No longer a member")).toBeTruthy();
  });

  it("a year with no bills is the empty state with a link to the section that makes them", () => {
    render(<PerCapitaView data={perCapita([], { totals: { billedCents: 0, paidCents: 0, outstandingCents: 0 } })} slug={SLUG} billingYear={2031} />);
    expect(screen.getByText("No per-capita bills for 2031")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Per-Capita, SASR & Imports" }).getAttribute("href")).toBe("/o/northern/admin/reports?billingYear=2031");
    expect(screen.queryByTestId("report-table")).toBeNull();
  });

  it("no member congregations and no bills", () => {
    render(<PerCapitaView data={perCapita([], { rosterCount: 0 })} slug={SLUG} billingYear={2025} />);
    expect(screen.getByText("No member congregations on record")).toBeTruthy();
  });
});
