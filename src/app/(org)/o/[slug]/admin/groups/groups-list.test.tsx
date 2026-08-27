// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DerivedGroupsList, GroupsList } from "./groups-list";

afterEach(cleanup);

describe("GroupsList", () => {
  it("renders the empty state when there are no managed groups", () => {
    render(<GroupsList slug="alder-creek" entries={[]} />);
    expect(screen.getByText(/no committees or groups yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a table row per group, linking to its detail page", () => {
    render(
      <GroupsList
        slug="alder-creek"
        entries={[
          {
            groupId: "group-1",
            name: "Property Committee",
            groupTypeName: "Committee",
            memberCount: 4,
          },
          {
            groupId: "group-2",
            name: "Chancel Choir",
            groupTypeName: "Choir",
            memberCount: 12,
          },
        ]}
      />,
    );

    expect(screen.getByRole("table")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Property Committee" });
    expect(link.getAttribute("href")).toBe(
      "/o/alder-creek/admin/groups/group-1",
    );
    expect(screen.getByText("Choir")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });
});

describe("DerivedGroupsList", () => {
  it("renders nothing when there are no derived groups", () => {
    const { container } = render(
      <DerivedGroupsList slug="alder-creek" entries={[]} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders a labeled 'Automatic rosters' section with one row per derived group", () => {
    render(
      <DerivedGroupsList
        slug="alder-creek"
        entries={[
          {
            groupId: "session-1",
            name: "Session",
            groupTypeName: "Court",
            memberCount: 7,
            derivedFrom: "session",
          },
          {
            groupId: "diaconate-1",
            name: "Board of Deacons",
            groupTypeName: "Court",
            memberCount: 5,
            derivedFrom: "diaconate",
          },
          {
            groupId: "roster-1",
            name: "Active Membership",
            groupTypeName: "Roster",
            memberCount: 210,
            derivedFrom: "active_membership",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /automatic rosters/i }),
    ).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Session")).toBeTruthy();
    expect(screen.getByText("Board of Deacons")).toBeTruthy();
    expect(screen.getByText("Active Membership")).toBeTruthy();
    expect(screen.getByText("210")).toBeTruthy();

    // session and diaconate rows link to Officers, not an edit form.
    const officersLinks = screen.getAllByRole("link", { name: /officers/i });
    expect(officersLinks).toHaveLength(2);
    for (const link of officersLinks) {
      expect(link.getAttribute("href")).toBe("/o/alder-creek/admin/officers");
    }

    // active_membership has no management surface — a note, not a link.
    expect(
      screen.getByText(/the membership roll/i, { selector: "span" }),
    ).toBeTruthy();
  });

  it("renders NO edit/add-member/end-membership affordance for any derived row — read-only guard", () => {
    render(
      <DerivedGroupsList
        slug="alder-creek"
        entries={[
          {
            groupId: "session-1",
            name: "Session",
            groupTypeName: "Court",
            memberCount: 7,
            derivedFrom: "session",
          },
          {
            groupId: "roster-1",
            name: "Active Membership",
            groupTypeName: "Roster",
            memberCount: 210,
            derivedFrom: "active_membership",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("link", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add member/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /end membership/i }),
    ).toBeNull();
    // The only link anywhere in this section goes to Officers.
    expect(
      screen.queryByRole("link", { name: /^session$/i }),
    ).toBeNull();
  });
});
