// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HouseholdSummary } from "@/lib/directory";
import { HouseholdsGrid } from "./households-grid";

afterEach(cleanup);

function household(overrides: Partial<HouseholdSummary> = {}): HouseholdSummary {
  return {
    householdId: "h1",
    name: "The Renwick Family",
    city: "Fixtureville",
    region: "OH",
    memberCount: 3,
    deaconName: null,
    ...overrides,
  };
}

describe("HouseholdsGrid — the count", () => {
  it("shows a singular count for exactly one household", () => {
    render(
      <HouseholdsGrid
        households={[household()]}
        search=""
        orgName="Alder Creek Presbyterian Church"
        slug="alder-creek"
      />,
    );
    expect(screen.getByText(/showing 1 household$/i)).toBeTruthy();
  });

  it("shows a plural count for more than one household", () => {
    render(
      <HouseholdsGrid
        households={[household(), household({ householdId: "h2", name: "Ashcombe" })]}
        search=""
        orgName="Alder Creek Presbyterian Church"
        slug="alder-creek"
      />,
    );
    expect(screen.getByText(/showing 2 households/i)).toBeTruthy();
  });
});

describe("HouseholdsGrid — the two distinct empty states", () => {
  it("shows the empty-directory copy (no search) when there are zero households", () => {
    render(
      <HouseholdsGrid
        households={[]}
        search=""
        orgName="Alder Creek Presbyterian Church"
        slug="alder-creek"
      />,
    );
    expect(
      screen.getByText(/no households are listed for Alder Creek/i),
    ).toBeTruthy();
    expect(screen.queryByText(/no households match/i)).toBeNull();
  });

  it("shows the zero-match copy, naming the query back, when a search matched nobody", () => {
    render(
      <HouseholdsGrid
        households={[]}
        search="zzz-nobody"
        orgName="Alder Creek Presbyterian Church"
        slug="alder-creek"
      />,
    );
    expect(screen.getByText(/no households match.*zzz-nobody/i)).toBeTruthy();
    expect(screen.queryByText(/no households are listed/i)).toBeNull();
  });
});

describe("HouseholdsGrid — card content", () => {
  it("renders the household name, city/state, and member-count badge, linking to the detail page", () => {
    render(
      <HouseholdsGrid
        households={[household()]}
        search=""
        orgName="Alder Creek Presbyterian Church"
        slug="alder-creek"
      />,
    );
    expect(screen.getByText("The Renwick Family")).toBeTruthy();
    expect(screen.getByText("Fixtureville, OH")).toBeTruthy();
    expect(screen.getByText(/3 members/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: "The Renwick Family" });
    expect(link.getAttribute("href")).toBe(
      "/o/alder-creek/directory/households/h1",
    );
  });

  it("uses singular 'member' for a one-person household", () => {
    render(
      <HouseholdsGrid
        households={[household({ memberCount: 1 })]}
        search=""
        orgName="Alder Creek Presbyterian Church"
        slug="alder-creek"
      />,
    );
    expect(screen.getByText(/1 member$/i)).toBeTruthy();
  });

  it("omits the city/state line when both are null", () => {
    render(
      <HouseholdsGrid
        households={[household({ city: null, region: null })]}
        search=""
        orgName="Alder Creek Presbyterian Church"
        slug="alder-creek"
      />,
    );
    expect(screen.queryByText("Fixtureville, OH")).toBeNull();
  });

  it("does not render a deacon badge until Increment 4 populates deaconName", () => {
    render(
      <HouseholdsGrid
        households={[household({ deaconName: null })]}
        search=""
        orgName="Alder Creek Presbyterian Church"
        slug="alder-creek"
      />,
    );
    expect(screen.queryByText(/deacon/i)).toBeNull();
  });

  it("renders one card per household in a responsive 1/2/3-column grid", () => {
    render(
      <HouseholdsGrid
        households={[
          household({ householdId: "h1" }),
          household({ householdId: "h2", name: "Ashcombe" }),
          household({ householdId: "h3", name: "Balakrishnan" }),
        ]}
        search=""
        orgName="Alder Creek Presbyterian Church"
        slug="alder-creek"
      />,
    );
    const grid = document.querySelector(".grid");
    expect(grid).toBeTruthy();
    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("sm:grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-3");
    expect(grid?.children).toHaveLength(3);
  });
});
