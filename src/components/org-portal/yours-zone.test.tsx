// @vitest-environment jsdom
/**
 * HISTORY (docs/work-log/2026-10-14-portal-home-alignment.md, D2): the old
 * "uses singular 'member' for a household of one" case is DELETED on purpose.
 * Its premise — a card for a household of one — is now unreachable:
 * `getPortalHomeData` returns `household: null` below two eligible people, and
 * that rule is pinned at the data layer (`home-data.test.ts`, the household-of-
 * one and directory-hidden-viewer cases). `YoursZone` renders what it is given
 * and carries no second copy of the rule.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { YoursZone } from "./yours-zone";

afterEach(cleanup);

const HOUSEHOLD = { id: "h1", name: "The Fennimore Family", memberCount: 3 };
const GROUPS = [
  { groupId: "g1", name: "Altar Guild" },
  { groupId: "g2", name: "Session" },
];

describe("YoursZone — household block", () => {
  it("renders the household card with name and member count", () => {
    render(
      <YoursZone
        slug="alder-creek"
        household={HOUSEHOLD}
        groups={[]}
        householdPageEnabled={false}
      />,
    );
    expect(screen.getByText("The Fennimore Family")).toBeTruthy();
    expect(screen.getByText("3 members")).toBeTruthy();
  });

  it("links to the household page when the directory flags are on", () => {
    render(
      <YoursZone
        slug="alder-creek"
        household={HOUSEHOLD}
        groups={[]}
        householdPageEnabled
      />,
    );
    const link = screen.getByRole("link", { name: /view household/i });
    expect(link.getAttribute("href")).toBe(
      "/o/alder-creek/directory/households/h1",
    );
  });

  it("links to the directory when the household page is not enabled", () => {
    render(
      <YoursZone
        slug="alder-creek"
        household={HOUSEHOLD}
        groups={[]}
        householdPageEnabled={false}
      />,
    );
    const link = screen.getByRole("link", { name: /view directory/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/directory");
  });

  it("household-only omits the groups heading entirely", () => {
    render(
      <YoursZone
        slug="alder-creek"
        household={HOUSEHOLD}
        groups={[]}
        householdPageEnabled
      />,
    );
    expect(screen.queryByText("My groups")).toBeNull();
  });
});

describe("YoursZone — groups block", () => {
  it("renders the pills in the given order with no links", () => {
    render(
      <YoursZone
        slug="alder-creek"
        household={null}
        groups={GROUPS}
        householdPageEnabled
      />,
    );
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Altar Guild", "Session"]);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("groups-only (household null) renders the card with only the groups block", () => {
    render(
      <YoursZone
        slug="alder-creek"
        household={null}
        groups={GROUPS}
        householdPageEnabled
      />,
    );
    expect(screen.getByRole("heading", { name: "Yours" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My groups" })).toBeTruthy();
    expect(screen.queryByText(/members$/)).toBeNull();
  });

  it("a 60-character unbroken name wraps inside the pill and keeps the member-size type", () => {
    const longName = "A".repeat(60);
    render(
      <YoursZone
        slug="alder-creek"
        household={null}
        groups={[{ groupId: "g1", name: longName }]}
        householdPageEnabled
      />,
    );
    const pill = screen.getByText(longName);
    expect(pill.className).toContain("break-words");
    expect(pill.className).toContain("whitespace-normal");
    expect(pill.className).toContain("text-sm");
    expect(pill.className).not.toContain("text-xs");
    expect(pill.className).not.toContain("whitespace-nowrap");
  });

  it("no pill carries the micro text size", () => {
    const { container } = render(
      <YoursZone
        slug="alder-creek"
        household={HOUSEHOLD}
        groups={GROUPS}
        householdPageEnabled
      />,
    );
    expect(container.querySelector(".text-xs")).toBeNull();
  });

  it("renders household then groups when both are present", () => {
    render(
      <YoursZone
        slug="alder-creek"
        household={HOUSEHOLD}
        groups={GROUPS}
        householdPageEnabled
      />,
    );
    const household = screen.getByText("The Fennimore Family");
    const groups = screen.getByText("My groups");
    expect(
      household.compareDocumentPosition(groups) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("YoursZone — nothing to show", () => {
  it("renders nothing at all — not an empty card — when household is null and groups are empty", () => {
    const { container } = render(
      <YoursZone
        slug="alder-creek"
        household={null}
        groups={[]}
        householdPageEnabled
      />,
    );
    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});
