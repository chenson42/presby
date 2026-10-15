// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CalendarFilters } from "./calendar-filters";
import { GENERAL_TYPE, STUDY_TYPE, WORSHIP_TYPE } from "./calendar-test-data";

afterEach(cleanup);

function renderFilters(activeTypeIds: string[] = []) {
  return render(
    <CalendarFilters
      slug="alder-creek"
      month={{ year: 2026, month: 10 }}
      view="month"
      types={[WORSHIP_TYPE, STUDY_TYPE, GENERAL_TYPE]}
      activeTypeIds={activeTypeIds}
    />,
  );
}

describe("CalendarFilters", () => {
  it("renders the pill row twice: inside a md:hidden <details> and as a hidden md:block copy", () => {
    const { container } = renderFilters();
    const details = container.querySelector("details")!;
    expect(details.className).toContain("md:hidden");
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.querySelectorAll('nav[aria-label="Filter by event type"]')).toHaveLength(1);
    const inline = container.querySelector("div.hidden.md\\:block")!;
    expect(inline.querySelectorAll('nav[aria-label="Filter by event type"]')).toHaveLength(1);
  });

  it("puts NO display utility on the <summary> (the iOS <details> defect) and lays out on an inner span", () => {
    const { container } = renderFilters();
    const summary = container.querySelector("summary")!;
    const display = /(^|\s)(flex|inline-flex|block|inline-block|grid|inline|contents|table|hidden)(\s|$)/;
    expect(display.test(summary.className)).toBe(false);
    expect(summary.className).toContain("list-none");
    expect(summary.className).toContain("cursor-pointer");
    expect(summary.firstElementChild?.tagName).toBe("SPAN");
    expect(summary.firstElementChild?.className).toContain("flex");
    expect(summary.firstElementChild?.className).toContain("min-h-11");
  });

  it("reads 'Show filters' with nothing selected, with a 'Hide filters' label for the open state", () => {
    const { container } = renderFilters();
    const summary = container.querySelector("summary")!;
    expect(summary.textContent).toContain("Show filters");
    expect(summary.textContent).toContain("Hide filters");
    expect(summary.querySelector(".group-open\\:hidden")?.textContent).toBe("Show filters");
  });

  it("reads 'Filters: N active' when a filter is applied", () => {
    const { container } = renderFilters([WORSHIP_TYPE.id, STUDY_TYPE.id]);
    expect(container.querySelector("summary")!.textContent).toContain("Filters: 2 active");
  });

  it("is omitted from print", () => {
    const { container } = renderFilters();
    expect((container.firstElementChild as HTMLElement).className).toContain("print:hidden");
    expect(screen.getAllByRole("link", { name: "All" })).toHaveLength(2);
  });
});
