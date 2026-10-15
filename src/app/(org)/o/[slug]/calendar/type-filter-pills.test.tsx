// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { TypeFilterPills } from "./type-filter-pills";
import { GENERAL_TYPE, STUDY_TYPE, WORSHIP_TYPE } from "./calendar-test-data";

afterEach(cleanup);

const MONTH = { year: 2026, month: 10 };
const TYPES = [WORSHIP_TYPE, STUDY_TYPE, GENERAL_TYPE];

function renderPills(activeTypeIds: string[] = [], view: "month" | "list" = "month") {
  return render(
    <TypeFilterPills
      slug="alder-creek"
      month={MONTH}
      view={view}
      types={TYPES}
      activeTypeIds={activeTypeIds}
    />,
  );
}

describe("TypeFilterPills", () => {
  it("lists All first, then every type with the default type last", () => {
    renderPills();
    const names = within(screen.getByRole("navigation", { name: "Filter by event type" }))
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(names).toEqual(["All", "Worship", "Study", "General"]);
  });

  it("marks All current when nothing is selected, with a check icon and no other current pill", () => {
    renderPills();
    const all = screen.getByRole("link", { name: "All" });
    expect(all.getAttribute("aria-current")).toBe("true");
    expect(all.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Worship" }).getAttribute("aria-current")).toBeNull();
  });

  it("from All, a type pill links to a one-type filter that carries month and view", () => {
    renderPills([], "list");
    expect(screen.getByRole("link", { name: "Worship" }).getAttribute("href")).toBe(
      `/o/alder-creek/calendar?month=2026-10&types=${WORSHIP_TYPE.id}&view=list`,
    );
  });

  it("marks the selected pill current (aria-current + check + heavier border), and All is not", () => {
    renderPills([WORSHIP_TYPE.id]);
    const worship = screen.getByRole("link", { name: "Worship" });
    expect(worship.getAttribute("aria-current")).toBe("true");
    expect(worship.className).toContain("border-2");
    expect(worship.querySelectorAll("svg").length).toBe(2); // check + type icon
    expect(screen.getByRole("link", { name: "All" }).getAttribute("aria-current")).toBeNull();
  });

  it("clicking a selected pill removes it; removing the last returns to All", () => {
    renderPills([WORSHIP_TYPE.id]);
    expect(screen.getByRole("link", { name: "Worship" }).getAttribute("href")).toBe(
      "/o/alder-creek/calendar?month=2026-10",
    );
  });

  it("adding a second type keeps both in the filter", () => {
    renderPills([WORSHIP_TYPE.id]);
    expect(screen.getByRole("link", { name: "Study" }).getAttribute("href")).toBe(
      `/o/alder-creek/calendar?month=2026-10&types=${WORSHIP_TYPE.id},${STUDY_TYPE.id}`,
    );
  });

  it("All drops the types parameter but keeps the view", () => {
    renderPills([WORSHIP_TYPE.id], "list");
    expect(screen.getByRole("link", { name: "All" }).getAttribute("href")).toBe(
      "/o/alder-creek/calendar?month=2026-10&view=list",
    );
  });

  it("shows an icon and the type name on every type pill (colour is never alone)", () => {
    renderPills();
    for (const name of ["Worship", "Study", "General"]) {
      const pill = screen.getByRole("link", { name });
      expect(pill.querySelector("svg")).toBeTruthy();
      expect(pill.className).toContain("min-h-11");
    }
  });
});
