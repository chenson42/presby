// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MonthListView } from "./month-list";
import { makeEntry } from "./calendar-test-data";

afterEach(cleanup);

const MONTH = { year: 2026, month: 10 };
const FROM = "/o/alder-creek/calendar?month=2026-10";

function renderList(entries: ReturnType<typeof makeEntry>[], view: "month" | "list" = "month") {
  return render(
    <MonthListView
      slug="alder-creek"
      month={MONTH}
      entries={entries}
      todayKey="2026-10-14"
      view={view}
      fromHref={FROM}
    />,
  );
}

describe("MonthListView", () => {
  it("renders one heading per day that has entries, in date order", () => {
    renderList([
      makeEntry({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", startsAtWallClock: "2026-10-18T10:00", title: "B" }),
      makeEntry({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", startsAtWallClock: "2026-10-04T10:00", title: "A" }),
    ]);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Sunday, October 4",
      "Sunday, October 18",
    ]);
  });

  it("groups several entries of one day under one heading, in an ordered list", () => {
    renderList([
      makeEntry({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", startsAtWallClock: "2026-10-04T10:00" }),
      makeEntry({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", startsAtWallClock: "2026-10-04T18:00", title: "Evening" }),
    ]);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("labels today with '(today)'", () => {
    renderList([makeEntry({ startsAtWallClock: "2026-10-14T09:00" })]);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Wednesday, October 14 (today)");
  });

  it("omits adjacent-month days from the list", () => {
    renderList([
      makeEntry({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", startsAtWallClock: "2026-09-27T10:00", title: "September" }),
      makeEntry({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", startsAtWallClock: "2026-10-04T10:00", title: "October" }),
    ]);
    expect(screen.queryByText(/September/)).toBeNull();
    expect(screen.getAllByText(/October/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("calendar-entry")).toHaveLength(1);
  });

  it("is the phone layout (md:hidden) in the month view and always shown in the list view", () => {
    const { unmount } = renderList([makeEntry()], "month");
    expect(screen.getByTestId("calendar-list").className).toContain("md:hidden");
    unmount();
    renderList([makeEntry()], "list");
    const cls = screen.getByTestId("calendar-list").className;
    expect(cls).toContain("block");
    expect(cls).not.toContain("md:hidden");
  });

  it("never uses text-xs", () => {
    const { container } = renderList([makeEntry()]);
    expect(container.innerHTML).not.toContain("text-xs");
  });
});
