// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HomeMainRow } from "./home-main-row";
import type { MainRowPlan } from "@/lib/org-portal/main-row";

afterEach(cleanup);

const YOURS = {
  household: { id: "h1", name: "The Fennimore Family", memberCount: 3 },
  groups: [{ groupId: "g1", name: "Altar Guild" }],
};

const DOUBLE: MainRowPlan = {
  layout: "double",
  yours: YOURS,
  upcoming: { kind: "empty" },
};

describe("HomeMainRow", () => {
  it("renders nothing — no wrapper element — for layout none", () => {
    const { container } = render(
      <HomeMainRow
        slug="alder-creek"
        plan={{ layout: "none", yours: null, upcoming: null }}
        householdPageEnabled
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("a single card is a one-column row, never md:grid-cols-2", () => {
    render(
      <HomeMainRow
        slug="alder-creek"
        plan={{ layout: "single", yours: null, upcoming: { kind: "empty" } }}
        householdPageEnabled
      />,
    );
    const row = screen.getByTestId("home-main-row");
    expect(row.className).not.toContain("md:grid-cols-2");
    expect(screen.getByRole("heading", { name: "Coming up" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Yours" })).toBeNull();
  });

  it("a double row is md:grid-cols-2 items-start", () => {
    render(
      <HomeMainRow slug="alder-creek" plan={DOUBLE} householdPageEnabled />,
    );
    const row = screen.getByTestId("home-main-row");
    expect(row.className).toContain("md:grid-cols-2");
    expect(row.className).toContain("items-start");
  });

  it("puts Yours before Coming up, each with its own h2", () => {
    render(
      <HomeMainRow slug="alder-creek" plan={DOUBLE} householdPageEnabled />,
    );
    const h2s = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(h2s).toEqual(["Yours", "Coming up"]);
  });

  it("forwards householdPageEnabled to the household link", () => {
    const { rerender } = render(
      <HomeMainRow slug="alder-creek" plan={DOUBLE} householdPageEnabled />,
    );
    expect(
      screen
        .getByRole("link", { name: /view household/i })
        .getAttribute("href"),
    ).toBe("/o/alder-creek/directory/households/h1");
    rerender(
      <HomeMainRow
        slug="alder-creek"
        plan={DOUBLE}
        householdPageEnabled={false}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: /view directory/i })
        .getAttribute("href"),
    ).toBe("/o/alder-creek/directory");
  });
});
