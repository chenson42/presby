// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MonthGridView } from "./month-grid";
import { buildMonthGrid } from "@/lib/calendar/month";
import { makeEntry, STUDY_TYPE } from "./calendar-test-data";

afterEach(cleanup);

const MONTH = { year: 2026, month: 10 };
const FROM = "/o/alder-creek/calendar?month=2026-10";

function renderGrid(
  entries = [makeEntry()],
  view: "month" | "list" = "month",
  todayKey = "2026-10-14",
) {
  return render(
    <MonthGridView
      slug="alder-creek"
      month={MONTH}
      grid={buildMonthGrid(MONTH)}
      entries={entries}
      todayKey={todayKey}
      view={view}
      fromHref={FROM}
    />,
  );
}

describe("MonthGridView", () => {
  it("is a real table with a screen-reader caption and seven weekday column headers", () => {
    renderGrid();
    const table = screen.getByRole("table");
    expect(within(table).getByText("October 2026").className).toContain("sr-only");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(headers[0].querySelector("abbr")?.getAttribute("title")).toBe("Sunday");
  });

  it("renders October 2026 as five weeks of seven days, starting on Sep 27", () => {
    renderGrid();
    const table = screen.getByRole("table");
    expect(table.querySelectorAll("tbody tr").length).toBe(5);
    expect(table.querySelectorAll("tbody td").length).toBe(35);
    expect(table.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-27");
  });

  it("places an entry in the cell of its start day, and only there", () => {
    renderGrid([makeEntry({ startsAtWallClock: "2026-10-04T10:00" })]);
    const cell = screen.getByTestId("calendar-entry").closest("td")!;
    expect(cell.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-04");
    expect(screen.getAllByTestId("calendar-entry")).toHaveLength(1);
  });

  it("still shows an adjacent-month entry, on a muted cell", () => {
    renderGrid([makeEntry({ startsAtWallClock: "2026-09-27T09:00", title: "Late September potluck" })]);
    const cell = screen.getByTestId("calendar-entry").closest("td")!;
    expect(cell.className).toContain("bg-muted");
    expect(cell.textContent).toContain("Late September potluck");
  });

  it("marks today with aria-current=date, a primary circle and a screen-reader 'Today'", () => {
    renderGrid();
    const today = screen.getByRole("table").querySelector('time[aria-current="date"]')!;
    expect(today.getAttribute("datetime")).toBe("2026-10-14");
    expect(today.querySelector(".bg-primary")).toBeTruthy();
    expect(today.querySelector(".sr-only")?.textContent).toBe("Wednesday, October 14, 2026, Today");
    expect(screen.getByRole("table").querySelectorAll('time[aria-current="date"]')).toHaveLength(1);
  });

  it("does not mark today when today is outside the displayed grid", () => {
    renderGrid([makeEntry()], "month", "2026-12-25");
    expect(screen.getByRole("table").querySelector('time[aria-current="date"]')).toBeNull();
  });

  it("scrolls a busy day inside its cell instead of hiding events behind '+N more'", () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      makeEntry({
        id: `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${i}`,
        title: `Event ${i}`,
        startsAtWallClock: `2026-10-10T${String(i + 6).padStart(2, "0")}:00`,
        eventType: STUDY_TYPE,
      }),
    );
    renderGrid(entries);
    expect(screen.getAllByTestId("calendar-entry")).toHaveLength(6);
    expect(screen.queryByText(/more/i)).toBeNull();
    const scroller = screen.getAllByTestId("calendar-entry")[0].parentElement!;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.className).toContain("print:overflow-visible");
  });

  it("is hidden below md in the month view and fully hidden in the list view", () => {
    const { unmount } = renderGrid([makeEntry()], "month");
    expect(screen.getByTestId("calendar-grid").className).toContain("hidden md:block");
    unmount();
    renderGrid([makeEntry()], "list");
    const cls = screen.getByTestId("calendar-grid").className;
    expect(cls).toContain("hidden");
    expect(cls).not.toContain("md:block");
  });

  it("never uses text-xs", () => {
    const { container } = renderGrid();
    expect(container.innerHTML).not.toContain("text-xs");
  });
});
