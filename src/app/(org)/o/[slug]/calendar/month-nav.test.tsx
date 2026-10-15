// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MonthNav } from "./month-nav";

afterEach(cleanup);

const TEAL = "11111111-1111-4111-8111-111111111111";

describe("MonthNav", () => {
  it("shows the month heading and labelled previous / next links", () => {
    render(<MonthNav slug="alder-creek" month={{ year: 2026, month: 10 }} types={[]} view="month" />);
    expect(screen.getByRole("heading", { level: 2, name: "October 2026" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Previous month, September 2026" }).getAttribute("href"),
    ).toBe("/o/alder-creek/calendar?month=2026-09");
    expect(
      screen.getByRole("link", { name: "Next month, November 2026" }).getAttribute("href"),
    ).toBe("/o/alder-creek/calendar?month=2026-11");
  });

  it("carries the type filter and the view on both links", () => {
    render(<MonthNav slug="alder-creek" month={{ year: 2026, month: 10 }} types={[TEAL]} view="list" />);
    expect(screen.getByRole("link", { name: /Previous month/ }).getAttribute("href")).toBe(
      `/o/alder-creek/calendar?month=2026-09&types=${TEAL}&view=list`,
    );
    expect(screen.getByRole("link", { name: /Next month/ }).getAttribute("href")).toBe(
      `/o/alder-creek/calendar?month=2026-11&types=${TEAL}&view=list`,
    );
  });

  it("rolls the year over in December and January", () => {
    const { unmount } = render(
      <MonthNav slug="alder-creek" month={{ year: 2026, month: 12 }} types={[]} view="month" />,
    );
    expect(screen.getByRole("link", { name: /Next month, January 2027/ }).getAttribute("href")).toBe(
      "/o/alder-creek/calendar?month=2027-01",
    );
    unmount();
    render(<MonthNav slug="alder-creek" month={{ year: 2026, month: 1 }} types={[]} view="month" />);
    expect(
      screen.getByRole("link", { name: /Previous month, December 2025/ }).getAttribute("href"),
    ).toBe("/o/alder-creek/calendar?month=2025-12");
  });

  it("renders the 2000-01 and 2100-12 edges as aria-disabled spans, not links", () => {
    const { unmount } = render(
      <MonthNav slug="alder-creek" month={{ year: 2000, month: 1 }} types={[]} view="month" />,
    );
    expect(screen.queryByRole("link", { name: /Previous month/ })).toBeNull();
    expect(
      screen.getByLabelText("Previous month, not available").getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.getByRole("link", { name: /Next month, February 2000/ })).toBeTruthy();
    unmount();

    render(<MonthNav slug="alder-creek" month={{ year: 2100, month: 12 }} types={[]} view="month" />);
    expect(screen.queryByRole("link", { name: /Next month/ })).toBeNull();
    expect(screen.getByLabelText("Next month, not available").getAttribute("aria-disabled")).toBe("true");
  });

  it("gives every control a 44px target", () => {
    render(<MonthNav slug="alder-creek" month={{ year: 2026, month: 10 }} types={[]} view="month" />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("min-h-11");
      expect(link.className).toContain("min-w-11");
    }
  });
});
