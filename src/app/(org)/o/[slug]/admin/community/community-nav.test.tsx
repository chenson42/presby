// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CommunityNav, communityHref } from "./community-nav";

afterEach(cleanup);

describe("CommunityNav", () => {
  it("shows all six views as real links for a manager", () => {
    render(<CommunityNav slug="alder-creek" view="all" search="" canManage={true} />);
    const group = screen.getByRole("group", { name: "Community view" });
    const labels = Array.from(group.querySelectorAll("a")).map((a) => a.textContent);
    expect(labels).toEqual([
      "Everyone",
      "Members",
      "Participants",
      "Visitors",
      "Staff",
      "Former",
    ]);
  });

  it("hides Visitors, Staff and Former without people.manage", () => {
    render(<CommunityNav slug="alder-creek" view="all" search="" canManage={false} />);
    expect(screen.queryByRole("link", { name: "Visitors" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Staff" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Former" })).toBeNull();
    expect(screen.getByRole("link", { name: "Participants" })).toBeTruthy();
  });

  it("marks the current view and carries the search across views", () => {
    render(
      <CommunityNav slug="alder-creek" view="visitors" search="Nora" canManage={true} />,
    );
    expect(
      screen.getByRole("link", { name: "Visitors" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Members" }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/community?view=members&search=Nora");
    expect(
      screen.getByRole("link", { name: "Everyone" }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/community?search=Nora");
  });

  it("communityHref omits the query for Everyone with no search", () => {
    expect(communityHref("alder-creek", "all", "")).toBe(
      "/o/alder-creek/admin/community",
    );
  });
});
