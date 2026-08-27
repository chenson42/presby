// @vitest-environment jsdom
/**
 * Component tests for `ChildrenRosterList` — empty state, the "no guardian
 * on file" badge, and the guardians-link href.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ChildRosterEntry } from "@/lib/children";
import { ChildrenRosterList } from "./children-roster-list";

afterEach(cleanup);

const CHILD_WITH_GUARDIAN: ChildRosterEntry = {
  personId: "child-1",
  firstName: "Hallie",
  lastName: "Vandermeer",
  preferredName: null,
  dateOfBirth: "2011-03-08",
  ageYears: 15,
  householdId: "h-1",
  householdName: "The Renwick Family",
  guardianCount: 1,
};

const CHILD_NO_GUARDIAN: ChildRosterEntry = {
  ...CHILD_WITH_GUARDIAN,
  personId: "child-2",
  firstName: "Bram",
  guardianCount: 0,
};

describe("ChildrenRosterList — empty state", () => {
  it("renders 'No children recorded yet' when the list is empty", () => {
    render(<ChildrenRosterList slug="alder-creek" children={[]} />);
    expect(screen.getByText(/no children recorded yet/i)).toBeTruthy();
  });
});

describe("ChildrenRosterList — rows", () => {
  it("renders name, age, and household for each child", () => {
    render(
      <ChildrenRosterList slug="alder-creek" children={[CHILD_WITH_GUARDIAN]} />,
    );
    expect(screen.getByText(/Hallie Vandermeer/)).toBeTruthy();
    expect(screen.getByText(/Age 15/)).toBeTruthy();
    expect(screen.getByText(/The Renwick Family/)).toBeTruthy();
  });

  it("shows the 'no guardian on file' badge only when guardianCount is 0", () => {
    render(
      <ChildrenRosterList
        slug="alder-creek"
        children={[CHILD_WITH_GUARDIAN, CHILD_NO_GUARDIAN]}
      />,
    );
    expect(screen.getByText(/no guardian on file/i)).toBeTruthy();
    expect(screen.getByText(/1 guardian on file/i)).toBeTruthy();
  });

  it("links each row into its own edit/guardians sub-page", () => {
    render(
      <ChildrenRosterList slug="alder-creek" children={[CHILD_WITH_GUARDIAN]} />,
    );
    const link = screen.getByRole("link", { name: /guardians/i });
    expect(link.getAttribute("href")).toBe(
      "/o/alder-creek/admin/members/child-1/edit/guardians",
    );
  });
});
