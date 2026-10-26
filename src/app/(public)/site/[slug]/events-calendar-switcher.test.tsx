// @vitest-environment jsdom
/**
 * The month-switcher island (docs/work-log/2026-10-25-public-events-calendar.md,
 * Phase 3 T11; DECISION-239/241). It must work with no network and no clock,
 * and must be inert - not merely quiet - before hydration.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EventsCalendarSwitcher, type CalendarMonthSlice } from "./events-calendar-switcher";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MONTHS: CalendarMonthSlice[] = [
  { key: "2026-10", label: "October 2026", panel: <p>panel-oct</p> },
  { key: "2026-11", label: "November 2026", panel: <p>panel-nov</p> },
  { key: "2026-12", label: "December 2026", panel: <p>panel-dec</p> },
];

function island(over: Partial<React.ComponentProps<typeof EventsCalendarSwitcher>> = {}) {
  return (
    <EventsCalendarSwitcher
      months={MONTHS}
      initialIndex={1}
      currentIndex={1}
      initialView="month"
      hasEarlierInCurrent={false}
      edgeNote="This calendar shows events through December 2026."
      {...over}
    />
  );
}

const visiblePanel = () =>
  MONTHS.map((m) => document.querySelector(`[data-month="${m.key}"]`) as HTMLElement).filter((el) => !el.hidden);

describe("before hydration (the server HTML)", () => {
  const html = renderToString(island());

  it("has the opening month visible and every other panel hidden - all of them still in the HTML", () => {
    expect(html).toContain("panel-oct");
    expect(html).toContain("panel-nov");
    expect(html).toContain("panel-dec");
    expect(html).toMatch(/<div data-month="2026-10" hidden="">/);
    expect(html).toMatch(/<div data-month="2026-11">/);
    expect(html).toMatch(/<div data-month="2026-12" hidden="">/);
    expect(html).toContain(">November 2026</h2>");
  });

  it("renders every control disabled, so no arrow is presented as live before it works", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const buttons = [...doc.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Previous", "Today", "Next", "Month", "List"]);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it("carries the layout attributes the panels' CSS keys off", () => {
    expect(html).toContain('data-view="month"');
    expect(html).toContain('data-earlier="hide"');
    expect(html).toContain("group/cal");
  });
});

describe("after hydration", () => {
  it("enables the arrows and moves between months, hiding the others", () => {
    render(island());
    expect(screen.getByRole("button", { name: "Previous month, October 2026" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Next month, December 2026" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("December 2026");
    expect(visiblePanel().map((el) => el.dataset.month)).toEqual(["2026-12"]);
    fireEvent.click(screen.getByRole("button", { name: "Previous month, November 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month, October 2026" }));
    expect(visiblePanel().map((el) => el.dataset.month)).toEqual(["2026-10"]);
  });

  it("disables Previous on the first month and Next on the last, with plain names", () => {
    render(island({ initialIndex: 0 }));
    expect(screen.getByRole("button", { name: "Previous month" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Next month, November 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month, December 2026" }));
    expect(screen.getByRole("button", { name: "Next month" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Previous month, November 2026" })).toHaveProperty("disabled", false);
  });

  it("Today returns to the org's current month and is disabled while already there", () => {
    render(island());
    const today = screen.getByRole("button", { name: "Today" });
    expect(today).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Next month, December 2026" }));
    expect(today).toHaveProperty("disabled", false);
    fireEvent.click(today);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("November 2026");
    expect(today).toHaveProperty("disabled", true);
  });

  it("Today is disabled throughout when the window does not hold the org's current month", () => {
    render(island({ currentIndex: null, initialIndex: 2 }));
    expect(screen.getByRole("button", { name: "Today" })).toHaveProperty("disabled", true);
  });

  it("shows the window-edge note only on the last month, saying what the window covers", () => {
    render(island());
    expect(screen.queryByTestId("public-calendar-edge-note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next month, December 2026" }));
    expect(screen.getByTestId("public-calendar-edge-note").textContent).toBe(
      "This calendar shows events through December 2026.",
    );
    expect(document.body.textContent).not.toMatch(/as far ahead as we've planned/i);
  });

  it("the layout toggle flips data-view and reports pressed state", () => {
    render(island());
    const root = screen.getByTestId("public-calendar");
    const month = screen.getByRole("button", { name: "Month" });
    const list = screen.getByRole("button", { name: "List" });
    expect(root.getAttribute("data-view")).toBe("month");
    expect(month.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(list);
    expect(root.getAttribute("data-view")).toBe("list");
    expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(month.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens in the list layout when the marker asked for it", () => {
    render(island({ initialView: "list" }));
    expect(screen.getByTestId("public-calendar").getAttribute("data-view")).toBe("list");
  });

  it("offers 'Show earlier this month' only on the current month and only when there is something earlier", () => {
    const { unmount } = render(island({ hasEarlierInCurrent: false }));
    expect(screen.queryByRole("button", { name: /earlier this month/i })).toBeNull();
    unmount();

    render(island({ hasEarlierInCurrent: true }));
    const root = screen.getByTestId("public-calendar");
    expect(root.getAttribute("data-earlier")).toBe("hide");
    fireEvent.click(screen.getByRole("button", { name: "Show earlier this month" }));
    expect(root.getAttribute("data-earlier")).toBe("show");
    fireEvent.click(screen.getByRole("button", { name: "Hide earlier this month" }));
    expect(root.getAttribute("data-earlier")).toBe("hide");

    fireEvent.click(screen.getByRole("button", { name: "Next month, December 2026" }));
    expect(screen.queryByRole("button", { name: /earlier this month/i })).toBeNull();
  });

  it("makes no network call during any interaction", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(island());
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Next month, December 2026" }));
      fireEvent.click(screen.getByRole("button", { name: "Today" }));
      fireEvent.click(screen.getByRole("button", { name: "List" }));
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never reads a clock: the source has no Date, performance, fetch, XMLHttpRequest or location use", () => {
    // React's own scheduler and the test renderer construct Dates, so a runtime spy cannot
    // tell the island's reads from theirs; the island's SOURCE is what is asserted.
    const source = readFileSync(path.resolve(__dirname, "events-calendar-switcher.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/\bnew Date\b|\bDate\.|\bperformance\b|\bfetch\b|XMLHttpRequest|\blocation\b|\bwindow\b/);
  });
});
