// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CalendarEntryLink } from "./calendar-entry";
import { makeEntry } from "./calendar-test-data";

afterEach(cleanup);

const FROM = "/o/alder-creek/calendar?month=2026-10&view=list";

describe("CalendarEntryLink", () => {
  it("links to the detail page with the canonical from= encoded", () => {
    const entry = makeEntry();
    render(<CalendarEntryLink slug="alder-creek" entry={entry} fromHref={FROM} variant="grid" />);
    expect(screen.getByTestId("calendar-entry").getAttribute("href")).toBe(
      `/o/alder-creek/calendar/${entry.id}?from=${encodeURIComponent(FROM)}`,
    );
  });

  it("grid: shows the time, the title and the location, with the type name for screen readers only", () => {
    render(<CalendarEntryLink slug="alder-creek" entry={makeEntry()} fromHref={FROM} variant="grid" />);
    const link = screen.getByTestId("calendar-entry");
    expect(link.textContent).toContain("10:00 AM");
    expect(link.textContent).toContain("Sunday worship");
    expect(link.textContent).toContain("Sanctuary");
    const srOnly = link.querySelector(".sr-only");
    expect(srOnly?.textContent).toBe(", Worship");
    expect(link.querySelector("svg")).toBeTruthy();
  });

  it("grid: uses the type's chip tint and its 4px ink rule", () => {
    render(<CalendarEntryLink slug="alder-creek" entry={makeEntry()} fromHref={FROM} variant="grid" />);
    const cls = screen.getByTestId("calendar-entry").className;
    expect(cls).toContain("bg-category-teal");
    expect(cls).toContain("border-l-4");
    expect(cls).toContain("border-l-category-teal-foreground");
  });

  it("list: shows the time range and the type name as VISIBLE text, at a 44px target", () => {
    render(
      <CalendarEntryLink
        slug="alder-creek"
        entry={makeEntry({ endsAtWallClock: "2026-10-04T11:30" })}
        fromHref={FROM}
        variant="list"
      />,
    );
    const link = screen.getByTestId("calendar-entry");
    expect(link.textContent).toContain("10:00 AM – 11:30 AM");
    expect(link.querySelector(".sr-only")).toBeNull();
    expect(screen.getByText("Worship")).toBeTruthy();
    expect(link.className).toContain("min-h-11");
  });

  it("an untyped org (eventType null) renders neutral with the calendar icon and no type label", () => {
    render(
      <CalendarEntryLink slug="alder-creek" entry={makeEntry({ eventType: null })} fromHref={FROM} variant="list" />,
    );
    const link = screen.getByTestId("calendar-entry");
    expect(link.className).toContain("bg-category-neutral");
    expect(link.querySelector("svg")).toBeTruthy();
  });

  it("omits the location line when there is none", () => {
    render(
      <CalendarEntryLink slug="alder-creek" entry={makeEntry({ location: null })} fromHref={FROM} variant="grid" />,
    );
    expect(screen.getByTestId("calendar-entry").textContent).not.toContain("Sanctuary");
  });

  it("never uses text-xs (the member-page floor is text-sm)", () => {
    const { container } = render(
      <>
        <CalendarEntryLink slug="alder-creek" entry={makeEntry()} fromHref={FROM} variant="grid" />
        <CalendarEntryLink slug="alder-creek" entry={makeEntry()} fromHref={FROM} variant="list" />
      </>,
    );
    expect(container.innerHTML).not.toContain("text-xs");
  });
});
