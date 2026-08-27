// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GroupsList } from "./groups-list";

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
