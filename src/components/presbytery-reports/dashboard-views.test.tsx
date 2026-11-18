// @vitest-environment jsdom
/**
 * The dashboard's views (DECISION-342, docs/work-log/2026-11-17-presbytery-
 * dashboard.md Phase 3 Test Plan). Both the viability card list and its table
 * are in the DOM (CSS hides one), so rows are asserted inside their own
 * `data-testid` container.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DASHBOARD_REPORT_KEYS, REPORTS } from "@/lib/presbytery-reports/contract";
import type { DashboardCards, PresbyteryDashboard } from "@/lib/presbytery-reports/dashboard";
import type { ViabilityList } from "@/lib/presbytery-reports/dashboard-derive";
import { DashboardView, type DashboardFlags } from "./dashboard-cards";

afterEach(cleanup);

const SLUG = "northern";
const ORG = "Northern Reach";
const RETRY = "/o/northern/admin/insights";
const ALL_ON: DashboardFlags = { reportsOn: true, oversightOn: true, credentialsOn: true };

const VIABILITY: ViabilityList = {
  rosterCount: 3,
  anyNotAssessed: true,
  rows: [
    { organizationId: "b", name: "Birch Hollow", score: 1, label: "At risk" },
    { organizationId: "a", name: "Alder Creek", score: 3, label: "Healthy" },
    { organizationId: "c", name: "Cedar Ford", score: null, label: "Not yet assessed" },
  ],
};

function cards(overrides: Partial<DashboardCards> = {}): DashboardCards {
  return {
    membership_trend: {
      kind: "ok",
      data: { kind: "figure", year: 2025, total: 1234, reporting: 9, members: 12, from: 2021, to: 2025 },
    },
    vacant_pulpits: { kind: "ok", data: { kind: "some", vacant: 3, total: 12 } },
    per_capita: {
      kind: "ok",
      data: {
        kind: "figure",
        billingYear: 2026,
        billedCents: 262500,
        paidCents: 100000,
        outstandingCents: 162500,
        billedCount: 8,
        total: 12,
        departedBilled: 0,
      },
    },
    viability: { kind: "ok", data: VIABILITY },
    ...overrides,
  };
}

function view(
  options: { cards?: Partial<DashboardCards>; flags?: Partial<DashboardFlags>; dashboard?: PresbyteryDashboard } = {},
) {
  const dashboard: PresbyteryDashboard = options.dashboard ?? {
    kind: "ok",
    roster: { kind: "ok", count: 12 },
    cards: cards(options.cards),
    map: { kind: "off" },
  };
  return render(
    <DashboardView
      dashboard={dashboard}
      org={ORG}
      slug={SLUG}
      flags={{ ...ALL_ON, ...options.flags }}
      retryHref={RETRY}
      billingYear={2026}
    />,
  );
}

const card = (testId: string) => within(screen.getByTestId(testId));

describe("DashboardView — states", () => {
  it("the forbidden state names all four permission phrases and shows no card", () => {
    view({ dashboard: { kind: "forbidden" } });
    const text = document.body.textContent ?? "";
    for (const r of REPORTS.filter((x) => DASHBOARD_REPORT_KEYS.some((k) => k === x.key))) expect(text).toContain(r.permissionPhrase);
    expect(screen.queryByTestId("dashboard-cards")).toBeNull();
    expect(screen.queryByTestId("dashboard-viability")).toBeNull();
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it("a page error is a load error with a retry link to the page's own path, never the forbidden state", () => {
    view({ dashboard: { kind: "error" } });
    expect(screen.getByRole("alert").textContent).toContain("We couldn't load Insights & Analytics");
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(RETRY);
    expect(document.body.textContent).not.toMatch(/permission/);
  });

  it("roster count 0 renders one empty state and no cards", () => {
    view({ dashboard: { kind: "ok", roster: { kind: "ok", count: 0 }, cards: cards(), map: { kind: "off" } } });
    expect(screen.getByText("No member congregations yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Contact the PresbyPortal team" }).getAttribute("href")).toBe("/help/contact");
    expect(screen.queryByTestId("dashboard-cards")).toBeNull();
  });

  it("a failed roster read renders the members card as an error with a retry link and never the empty state", () => {
    view({ dashboard: { kind: "ok", roster: { kind: "error" }, cards: cards(), map: { kind: "off" } } });
    expect(screen.queryByText("No member congregations yet")).toBeNull();
    const members = card("dashboard-card-members");
    expect(members.getByText(/couldn't count the member congregations/)).toBeTruthy();
    expect(members.getByRole("alert")).toBeTruthy();
    expect(members.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(RETRY);
    expect(screen.getByTestId("dashboard-card-trend")).toBeTruthy();
  });

  it("a card error renders the card message and a retry link to the page's own path while the other cards render", () => {
    view({ cards: { vacant_pulpits: { kind: "error" } } });
    const broken = card("dashboard-card-vacant");
    expect(broken.getByRole("alert").textContent).toContain("We couldn't load this card. Try again in a moment.");
    expect(broken.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(RETRY);
    expect(card("dashboard-card-trend").getByText("1,234")).toBeTruthy();
    expect(card("dashboard-card-per-capita").getByText("$2,625.00")).toBeTruthy();
    expect(screen.getByTestId("dashboard-viability-cards")).toBeTruthy();
  });

  it("a locked card says Locked and the permission, and a locked viability section does the same", () => {
    view({ cards: { per_capita: { kind: "locked" }, viability: { kind: "locked" } } });
    const perCapita = card("dashboard-card-per-capita");
    expect(perCapita.getByText("Locked")).toBeTruthy();
    expect(perCapita.getByText(/You need permission to manage per-capita billing/)).toBeTruthy();
    expect(perCapita.getByRole("heading", { name: "Per capita, 2026" })).toBeTruthy();
    const section = card("dashboard-viability");
    expect(section.getByText("Locked")).toBeTruthy();
    expect(section.getByText(/manage congregation oversight/)).toBeTruthy();
    expect(screen.queryByTestId("dashboard-viability-cards")).toBeNull();
  });

  it("a viability error degrades that section only", () => {
    view({ cards: { viability: { kind: "error" } } });
    expect(card("dashboard-viability").getByText(/couldn't load the viability list/)).toBeTruthy();
    expect(card("dashboard-card-trend").getByText("1,234")).toBeTruthy();
  });

  it("the members card shows the count and what it excludes", () => {
    view();
    const members = card("dashboard-card-members");
    expect(members.getByText("12")).toBeTruthy();
    expect(members.getByText(/New worshiping communities and congregations that have left or closed are not counted/)).toBeTruthy();
  });
});

describe("DashboardView — the honest zero", () => {
  it("trend card shows a dash and the sentence for no_figure and never a 0", () => {
    view({ cards: { membership_trend: { kind: "ok", data: { kind: "no_figure", year: 2024, members: 12, from: 2021, to: 2025 } } } });
    const trend = card("dashboard-card-trend");
    expect(trend.getByText("—")).toBeTruthy();
    expect(trend.getByText("Statistics are on file for 2024 without a figure for ending active members.")).toBeTruthy();
    expect(trend.queryByText("0")).toBeNull();
  });

  it("trend card with no statistics says so and offers Record statistics, with no total", () => {
    view({ cards: { membership_trend: { kind: "ok", data: { kind: "none", from: 2021, to: 2025 } } } });
    const trend = card("dashboard-card-trend");
    expect(trend.getByText("No statistics recorded for 2021 to 2025")).toBeTruthy();
    expect(trend.getByText("Enter statistics for a congregation and year in the Congregation Statistics section.")).toBeTruthy();
    expect(trend.getByRole("link", { name: "Record statistics" }).getAttribute("href")).toBe("/o/northern/admin/reports");
    expect(trend.queryByText("0")).toBeNull();
  });

  it("trend figure prints the year, the fraction, and the partial-report note only when some did not report", () => {
    view();
    const trend = card("dashboard-card-trend");
    expect(trend.getByText("1,234")).toBeTruthy();
    expect(trend.getByText("2025: 9 of 12 reporting")).toBeTruthy();
    expect(trend.getByText("Congregations that did not report a figure are not in the total.")).toBeTruthy();
    cleanup();
    view({
      cards: { membership_trend: { kind: "ok", data: { kind: "figure", year: 2025, total: 10, reporting: 12, members: 12, from: 2021, to: 2025 } } },
    });
    expect(screen.queryByText(/did not report a figure/)).toBeNull();
  });

  it("vacant card, not recorded, shows no count", () => {
    view({ cards: { vacant_pulpits: { kind: "ok", data: { kind: "not_recorded" } } } });
    const vacant = card("dashboard-card-vacant");
    expect(vacant.getByText("No pastoral appointments are recorded yet")).toBeTruthy();
    expect(vacant.queryByText(/vacant of/)).toBeNull();
    expect(vacant.queryByText(/None vacant|No vacant pulpits/)).toBeNull();
    expect(vacant.getByText("So vacancies can't be worked out. Record appointments on Credentials.")).toBeTruthy();
    expect(vacant.getByRole("link", { name: "Open Credentials" }).getAttribute("href")).toBe("/o/northern/admin/credentials");
  });

  it("vacant card with a count carries the report's caveat sentence; none vacant says so", () => {
    view();
    const vacant = card("dashboard-card-vacant");
    expect(vacant.getByText("3 vacant of 12 congregations")).toBeTruthy();
    expect(vacant.getByText(/A congregation with no appointment recorded appears here/)).toBeTruthy();
    cleanup();
    view({ cards: { vacant_pulpits: { kind: "ok", data: { kind: "none_vacant", total: 12 } } } });
    expect(card("dashboard-card-vacant").getByText("No vacant pulpits")).toBeTruthy();
  });

  it("per capita none never prints a dollar amount", () => {
    for (const rateSet of [false, true]) {
      view({ cards: { per_capita: { kind: "ok", data: { kind: "none", billingYear: 2026, rateSet } } } });
      const text = card("dashboard-card-per-capita").getByRole("heading", { name: "Per capita, 2026" }).parentElement?.textContent ?? "";
      expect(text).not.toMatch(/\$/);
      expect(text).toContain("No per-capita bills for 2026");
      expect(text).toContain(rateSet ? "A rate is set for 2026." : "No rate is set for 2026.");
      cleanup();
    }
  });

  it("per capita figure prints billed, paid, still owed and the billed count", () => {
    view();
    const text = card("dashboard-card-per-capita").getByRole("heading", { name: "Per capita, 2026" }).parentElement?.textContent ?? "";
    expect(text).toContain("$2,625.00");
    expect(text).toContain("Paid $1,000.00");
    expect(text).toContain("Still owed $1,625.00");
    expect(text).toContain("8 of 12 congregations billed");
    expect(text).not.toMatch(/no longer/);
  });

  it("per capita figure prints credit for a negative still-owed and says a departed congregation's bill is included", () => {
    view({
      cards: {
        per_capita: {
          kind: "ok",
          data: {
            kind: "figure",
            billingYear: 2026,
            billedCents: 10000,
            paidCents: 11200,
            outstandingCents: -1200,
            billedCount: 1,
            total: 12,
            departedBilled: 2,
          },
        },
      },
    });
    const perCapita = card("dashboard-card-per-capita");
    expect(perCapita.getByText("Still owed $12.00 credit")).toBeTruthy();
    expect(perCapita.getByText("Includes 2 congregations that are no longer members.")).toBeTruthy();
  });
});

describe("DashboardView — links", () => {
  it("card links carry explicit years: ?from=2021&to=2025 and ?billingYear=2026", () => {
    view();
    expect(card("dashboard-card-trend").getByRole("link", { name: "Open the trend for 2021 to 2025" }).getAttribute("href")).toBe(
      "/o/northern/admin/reports/membership-trend?from=2021&to=2025",
    );
    expect(card("dashboard-card-per-capita").getByRole("link", { name: "Open per capita for 2026" }).getAttribute("href")).toBe(
      "/o/northern/admin/reports/per-capita?billingYear=2026",
    );
    expect(card("dashboard-card-vacant").getByRole("link", { name: "Open vacant pulpits" }).getAttribute("href")).toBe(
      "/o/northern/admin/reports/vacant-pulpits",
    );
  });

  it("with the reports flag off no card link renders and the figure still does", () => {
    view({ flags: { reportsOn: false } });
    expect(card("dashboard-card-trend").queryByRole("link")).toBeNull();
    expect(card("dashboard-card-vacant").queryByRole("link")).toBeNull();
    expect(card("dashboard-card-per-capita").queryByRole("link")).toBeNull();
    expect(card("dashboard-viability").queryByRole("link", { name: "Open the viability report" })).toBeNull();
    expect(card("dashboard-card-trend").getByText("1,234")).toBeTruthy();
    expect(card("dashboard-card-vacant").getByText("3 vacant of 12 congregations")).toBeTruthy();
    expect(card("dashboard-card-per-capita").getByText("$2,625.00")).toBeTruthy();
  });

  it("with credentials off 'Open Credentials' is absent", () => {
    view({
      flags: { credentialsOn: false },
      cards: { vacant_pulpits: { kind: "ok", data: { kind: "not_recorded" } } },
    });
    expect(screen.queryByRole("link", { name: "Open Credentials" })).toBeNull();
    expect(screen.getByText("No pastoral appointments are recorded yet")).toBeTruthy();
  });

  it("with the credentials flag off the vacant card says only that vacancies cannot be worked out", () => {
    view({
      flags: { credentialsOn: false },
      cards: { vacant_pulpits: { kind: "ok", data: { kind: "not_recorded" } } },
    });
    const vacant = card("dashboard-card-vacant");
    expect(vacant.getByText("So vacancies can't be worked out.")).toBeTruthy();
    expect(vacant.queryByText(/Record appointments on Credentials/)).toBeNull();
    expect(vacant.queryByRole("link")).toBeNull();
  });

  it("with the reports flag off the trend and per-capita instruction sentences are absent and the neutral sentence shows", () => {
    for (const rateSet of [false, true]) {
      view({
        flags: { reportsOn: false },
        cards: {
          membership_trend: { kind: "ok", data: { kind: "none", from: 2021, to: 2025 } },
          per_capita: { kind: "ok", data: { kind: "none", billingYear: 2026, rateSet } },
        },
      });
      const trend = card("dashboard-card-trend");
      expect(trend.getByText("No statistics recorded for 2021 to 2025")).toBeTruthy();
      expect(trend.queryByText(/Congregation Statistics section/)).toBeNull();
      expect(trend.queryByRole("link")).toBeNull();

      const perCapita = card("dashboard-card-per-capita");
      expect(perCapita.queryByText(/Per-Capita section/)).toBeNull();
      expect(perCapita.queryByRole("link")).toBeNull();
      expect(
        perCapita.getByText(rateSet ? "A rate is set for 2026. The bills have not been generated." : "No rate is set for 2026."),
      ).toBeTruthy();
      cleanup();
    }
  });

  it("with the reports flag on the per-capita instruction and its link render for both none states", () => {
    for (const rateSet of [false, true]) {
      view({ cards: { per_capita: { kind: "ok", data: { kind: "none", billingYear: 2026, rateSet } } } });
      const perCapita = card("dashboard-card-per-capita");
      expect(perCapita.getByText(/enerate the bills in the Per-Capita section of Per-Capita, SASR & Imports\./)).toBeTruthy();
      expect(perCapita.getByRole("link", { name: "Open Per-Capita, SASR & Imports" }).getAttribute("href")).toBe(
        "/o/northern/admin/reports?billingYear=2026",
      );
      cleanup();
    }
  });

  it("the viability section links the report only with the reports flag on", () => {
    view();
    expect(card("dashboard-viability").getByRole("link", { name: "Open the viability report" }).getAttribute("href")).toBe(
      "/o/northern/admin/reports/viability",
    );
  });
});

describe("DashboardView — the viability list", () => {
  it("each row is a link to /o/<slug>/admin/oversight/<id> when oversight is on", () => {
    view();
    const cardList = within(screen.getByTestId("dashboard-viability-cards"));
    expect(cardList.getByRole("link", { name: "Birch Hollow" }).getAttribute("href")).toBe("/o/northern/admin/oversight/b");
    const table = within(screen.getByTestId("dashboard-viability-table"));
    expect(table.getByRole("link", { name: "Alder Creek" }).getAttribute("href")).toBe("/o/northern/admin/oversight/a");
  });

  it("with oversight off the viability names are plain text", () => {
    view({ flags: { oversightOn: false } });
    const cardList = within(screen.getByTestId("dashboard-viability-cards"));
    expect(cardList.queryByRole("link")).toBeNull();
    expect(cardList.getByText("Birch Hollow")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Congregation Oversight" })).toBeNull();
  });

  it("with the oversight flag off the viability list has no assess sentence even when a row is not assessed", () => {
    view({ flags: { oversightOn: false } });
    expect(VIABILITY.anyNotAssessed).toBe(true);
    expect(screen.queryByText(/Assess a congregation/)).toBeNull();
    // the badge still says it
    expect(within(screen.getByTestId("dashboard-viability-cards")).getByText("Not yet assessed")).toBeTruthy();
  });

  it("the badge text is the label, in the order given (at risk first), so colour is never the only signal", () => {
    view();
    const items = within(screen.getByTestId("dashboard-viability-cards")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Birch HollowAt risk",
      "Alder CreekHealthy",
      "Cedar FordNot yet assessed",
    ]);
  });

  it("points an unassessed list to Congregation Oversight, sentence and link, when it is on", () => {
    view();
    expect(screen.getByText("Assess a congregation on Congregation Oversight.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Congregation Oversight" }).getAttribute("href")).toBe("/o/northern/admin/oversight");
  });

  it("the viability list has a card list (sm:hidden) and a table (hidden sm:block)", () => {
    view();
    expect(screen.getByTestId("dashboard-viability-cards").className).toMatch(/\bsm:hidden\b/);
    const table = screen.getByTestId("dashboard-viability-table");
    expect(table.className).toMatch(/\bhidden\b/);
    expect(table.className).toMatch(/\bsm:block\b/);
  });

  it("the card grid is one column below sm and wraps long text", () => {
    view();
    const grid = screen.getByTestId("dashboard-cards");
    expect(grid.className).toMatch(/\bgrid-cols-1\b/);
    expect(grid.className).toMatch(/\bsm:grid-cols-2\b/);
    for (const id of ["members", "trend", "vacant", "per-capita"]) {
      expect(screen.getByTestId(`dashboard-card-${id}`).className).toMatch(/\bmin-w-0\b/);
    }
    expect(screen.getAllByText("Birch Hollow")[0].className).toMatch(/break-words/);
  });

  it("links and buttons are 44px targets", () => {
    view({ cards: { vacant_pulpits: { kind: "error" } } });
    for (const link of screen.getAllByRole("link")) expect(link.className, link.textContent ?? "").toMatch(/min-h-11/);
  });
});

describe("DashboardView — names are text", () => {
  it("a congregation named <img onerror> renders as text, never an element", () => {
    const evil = '<img src=x onerror="alert(1)">';
    view({
      cards: {
        viability: {
          kind: "ok",
          data: {
            rosterCount: 1,
            anyNotAssessed: false,
            rows: [{ organizationId: "x", name: evil, score: 2, label: "Fair" }],
          },
        },
      },
    });
    expect(document.querySelector("img")).toBeNull();
    expect(within(screen.getByTestId("dashboard-viability-cards")).getByText(evil)).toBeTruthy();
  });

  it("redevelopment notes never render on the dashboard (the list carries none)", () => {
    view();
    expect(document.body.textContent).not.toMatch(/redevelopment/i);
  });
});
