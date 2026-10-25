// @vitest-environment jsdom
/**
 * The server-rendered, prop-driven pieces of the parish surfaces: the household
 * row, the archived notice, the Unassigned toggles and the state panels (Copy
 * C3 and C6; tag CMP). No client state to hydrate in any of them.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ArchivedNotice } from "./archived-notice";
import { HouseholdRow } from "./household-row";
import { ParishesForbidden, ParishesLoadError, ParishesOff, SeatCallout } from "./parishes-states";
import { GroupToggles } from "./unassigned/group-toggles";

afterEach(cleanup);

describe("HouseholdRow", () => {
  it("renders the household name and each person with a connection badge; a masked person reads `Private`", () => {
    render(
      <ul>
        <HouseholdRow
          household={{
            householdId: "h1",
            name: "The Smith Family",
            people: [
              { name: "Pat Smith", masked: false, connection: "member" },
              { name: "Private", masked: true, connection: "visitor" },
            ],
          }}
        />
      </ul>,
    );
    expect(screen.getByRole("heading", { name: "The Smith Family" }).className).toContain("break-words");
    expect(screen.getByText("Pat Smith")).toBeTruthy();
    expect(screen.getByText("Member")).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Visitor")).toBeTruthy();
  });

  it("a household with no current person says so", () => {
    render(
      <ul>
        <HouseholdRow household={{ householdId: "h2", name: "Empty House", people: [] }} />
      </ul>,
    );
    expect(screen.getByText("No one current is listed.")).toBeTruthy();
  });

  it("renders its children (the move control) and nothing else when there are none", () => {
    const { rerender } = render(
      <ul>
        <HouseholdRow household={{ householdId: "h3", name: "A", people: [] }}>
          <button type="button">Move</button>
        </HouseholdRow>
      </ul>,
    );
    expect(screen.getByRole("button", { name: "Move" })).toBeTruthy();
    rerender(
      <ul>
        <HouseholdRow household={{ householdId: "h3", name: "A", people: [] }} />
      </ul>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("never renders anything contact-shaped even if a caller smuggles extra fields onto a row", () => {
    render(
      <ul>
        <HouseholdRow
          household={
            {
              householdId: "h4",
              name: "Smuggler",
              people: [
                {
                  name: "Pat",
                  masked: false,
                  connection: "member",
                  email: "pat@example.invalid",
                  phone: "555-0100",
                },
              ],
            } as never
          }
        />
      </ul>,
    );
    expect(document.body.textContent).not.toMatch(/example\.invalid|555-0100/);
  });
});

describe("ArchivedNotice", () => {
  it("says the district is archived and nothing can move into it, and (for a mover with households) how to move them out, with the control", () => {
    render(
      <ArchivedNotice householdCount={3} canMove>
        <button type="button">Move all</button>
      </ArchivedNotice>,
    );
    const notice = screen.getByTestId("archived-notice");
    expect(notice.textContent).toContain("This district is archived. No households can be moved into it.");
    expect(notice.textContent).toContain("Move households out one at a time, or all at once below.");
    expect(within(notice).getByRole("button", { name: "Move all" })).toBeTruthy();
  });

  it("without authority to move, it never tells the reader to move anything and shows no control", () => {
    render(
      <ArchivedNotice householdCount={3} canMove={false}>
        <button type="button">Move all</button>
      </ArchivedNotice>,
    );
    const notice = screen.getByTestId("archived-notice");
    expect(notice.textContent).not.toMatch(/Move households out/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an empty archived district says it has no households", () => {
    render(<ArchivedNotice householdCount={0} canMove />);
    expect(screen.getByTestId("archived-notice").textContent).toContain("It has no households.");
  });
});

describe("GroupToggles", () => {
  const COUNTS = { members: 27, participants: 34, visitors: 51, others: 208 };

  it("shows all four pills in precedence order with live counts, as links that wrap rather than scroll", () => {
    render(<GroupToggles basePath="/o/a/directory/parishes/unassigned" hidden={new Set()} counts={COUNTS} />);
    const group = screen.getByRole("group", { name: "Population groups" });
    expect(group.className).toContain("flex-wrap");
    expect(within(group).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Members (27)",
      "Participants (34)",
      "Visitors (51)",
      "Others (208)",
    ]);
    expect(screen.getByRole("link", { name: "Hide Members (27)" }).getAttribute("href")).toBe(
      "/o/a/directory/parishes/unassigned?hide=members",
    );
  });

  it("a hidden group keeps its count, offers Show, and the others' state is carried in the URL", () => {
    render(
      <GroupToggles
        basePath="/o/a/directory/parishes/unassigned"
        hidden={new Set(["members", "visitors"] as const)}
        counts={COUNTS}
      />,
    );
    const show = screen.getByRole("link", { name: "Show Members (27)" });
    expect(show.textContent).toBe("Members (27)");
    expect(show.getAttribute("href")).toBe("/o/a/directory/parishes/unassigned?hide=visitors");
    expect(screen.getByRole("link", { name: "Hide Participants (34)" }).getAttribute("href")).toBe(
      "/o/a/directory/parishes/unassigned?hide=members,participants,visitors",
    );
  });

  it("un-hiding the last hidden group drops the param entirely", () => {
    render(
      <GroupToggles
        basePath="/o/a/directory/parishes/unassigned"
        hidden={new Set(["others"] as const)}
        counts={COUNTS}
      />,
    );
    expect(screen.getByRole("link", { name: "Show Others (208)" }).getAttribute("href")).toBe(
      "/o/a/directory/parishes/unassigned",
    );
  });

  it("every pill is a 44px target", () => {
    render(<GroupToggles basePath="/x" hidden={new Set()} counts={COUNTS} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("min-h-11");
    }
  });
});

describe("state panels", () => {
  it("off: names the congregation and says nothing about why", () => {
    render(<ParishesOff name="Alder Creek Presbyterian Church" />);
    expect(screen.getByText("Parish management isn't turned on for Alder Creek Presbyterian Church yet.")).toBeTruthy();
  });

  it("forbidden: a permission message that does not read as a revoked portal, and names no role", () => {
    render(<ParishesForbidden name="Alder Creek Presbyterian Church" />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("You don't have permission to view households by district.");
    expect(text).toContain("ask an administrator at Alder Creek Presbyterian Church");
    expect(text).not.toMatch(/moderator/i);
  });

  it("load error: never reads as an empty list, and offers a retry link", () => {
    render(<ParishesLoadError retryHref="/o/a/directory/parishes/u1" />);
    expect(screen.getByRole("alert").textContent).toBe("We couldn't load the households. Try again.");
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
      "/o/a/directory/parishes/u1",
    );
    expect(document.body.textContent).not.toMatch(/No households/);
  });

  it("seat callout: links to Officers and never says only the Moderator can assign", () => {
    render(<SeatCallout slug="alder-creek" />);
    const callout = screen.getByTestId("seat-callout");
    expect(within(callout).getByRole("link", { name: "Record it in Officers" }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/officers",
    );
    expect(callout.textContent).not.toMatch(/\bonly\b/i);
  });
});
