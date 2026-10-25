// @vitest-environment jsdom
/**
 * `ParishRoster` — the Parishes tab's per-district panels. Extracted as its
 * own test file (portal UX review 2026-08-26, H4) to pin the "these are
 * information panels, not dead-end links" fix: no `<a>`/`role=link` inside a
 * panel, and no `<Card>`-recipe hover-lift class riding along with it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// The client islands call server actions; the roster is rendered here without them.
vi.mock("./parishes/actions", () => ({
  defineDistrictAction: vi.fn(),
  renameDistrictAction: vi.fn(),
  archiveDistrictAction: vi.fn(),
  restoreDistrictAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ParishRoster, type ManagedParishesProps } from "./parish-roster";
import type { ParishUnitEntry } from "@/lib/parishes";

afterEach(() => {
  cleanup();
});

const PARISHES: ParishUnitEntry[] = [
  {
    orgUnitId: "u1",
    name: "Creekside District",
    unitType: "district",
    archived: false,
    deaconName: "Priya Balakrishnan",
    householdCount: 3,
  },
  {
    orgUnitId: "u2",
    name: "Uptown District",
    unitType: "district",
    archived: false,
    deaconName: null,
    householdCount: 1,
  },
];

describe("ParishRoster", () => {
  it("renders each district's name, deacon (or Vacant), and household count", () => {
    render(<ParishRoster parishes={PARISHES} orgName="Alder Creek Presbyterian Church" />);

    expect(screen.getByText("Creekside District")).toBeTruthy();
    expect(screen.getByText(/Priya Balakrishnan/)).toBeTruthy();
    expect(screen.getByText("Uptown District")).toBeTruthy();
    expect(screen.getByText(/Vacant/)).toBeTruthy();
    expect(screen.getByText(/3 households/i)).toBeTruthy();
    expect(screen.getByText(/1 household$/i)).toBeTruthy();
  });

  it("renders district panels with no href and no link role — H4: these are dead ends with nowhere honest to link, so they must not read as clickable", () => {
    const { container } = render(
      <ParishRoster parishes={PARISHES} orgName="Alder Creek Presbyterian Church" />,
    );

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("does not apply the interactive-card hover-lift treatment (`hover:shadow-md`) that PersonCard/HouseholdCard use for their real links", () => {
    const { container } = render(
      <ParishRoster parishes={PARISHES} orgName="Alder Creek Presbyterian Church" />,
    );

    const panel = container.querySelector('[class*="rounded-lg"]');
    expect(panel).toBeTruthy();
    expect(panel?.className).not.toMatch(/hover:shadow/);
    expect(panel?.className).not.toMatch(/cursor-pointer/);
  });

  it("renders the empty-roster copy when the organization has no org units at all", () => {
    render(<ParishRoster parishes={[]} orgName="Alder Creek Presbyterian Church" />);

    expect(
      screen.getByText(/Alder Creek Presbyterian Church has no districts or parishes set up yet/i),
    ).toBeTruthy();
  });
});

describe("ParishRoster - legacy (the org toggle off) is unchanged by the managed mode", () => {
  it("shows no Add, no Rename, no Archive, no unassigned card and no seat callout", () => {
    render(<ParishRoster parishes={PARISHES} orgName="Alder Creek Presbyterian Church" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("no-district-card")).toBeNull();
    expect(screen.queryByTestId("seat-callout")).toBeNull();
  });
});

const MANAGED: ManagedParishesProps = {
  slug: "alder-creek",
  canDefine: true,
  canListHouseholds: true,
  archived: [],
  unassignedCount: 0,
  seatFilled: true,
};

describe("ParishRoster - managed (the org toggle on)", () => {
  it("links each district to its page for a viewer who may list households, and uses the single household count", () => {
    render(
      <ParishRoster parishes={PARISHES} orgName="Alder Creek Presbyterian Church" managed={MANAGED} />,
    );
    const link = screen.getByRole("link", { name: "View households in Creekside District" });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/directory/parishes/u1");
    expect(screen.getAllByTestId("district-card")).toHaveLength(2);
    expect(screen.getByText("3 households")).toBeTruthy();
    expect(screen.getByText("1 household")).toBeTruthy();
    expect(screen.getByText(/Deacon: Vacant/)).toBeTruthy();
  });

  it("offers no link to a viewer who may not list households (a definer-only), but still offers the controls", () => {
    render(
      <ParishRoster
        parishes={PARISHES}
        orgName="Alder Creek Presbyterian Church"
        managed={{ ...MANAGED, canListHouseholds: false, unassignedCount: null }}
      />,
    );
    expect(screen.queryByRole("link", { name: /View households/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Rename Creekside District" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive Creekside District" })).toBeTruthy();
  });

  it("a viewer who cannot define districts gets no Add form and no Rename/Archive/Restore", () => {
    render(
      <ParishRoster
        parishes={PARISHES}
        orgName="Alder Creek Presbyterian Church"
        managed={{ ...MANAGED, canDefine: false, seatFilled: null }}
      />,
    );
    expect(screen.queryByLabelText("District name")).toBeNull();
    expect(screen.queryByRole("button", { name: /Rename|Archive|Restore|Add district/ })).toBeNull();
  });

  it("shows the Add district form to someone who can define districts", () => {
    render(
      <ParishRoster parishes={PARISHES} orgName="Alder Creek Presbyterian Church" managed={MANAGED} />,
    );
    expect(screen.getByLabelText("District name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add district" })).toBeTruthy();
  });

  it("the empty state differs by authority: an administrator is invited to add one, anyone else is told to ask", () => {
    const { unmount } = render(
      <ParishRoster parishes={[]} orgName="Alder Creek Presbyterian Church" managed={MANAGED} />,
    );
    expect(
      screen.getByText("No districts yet. Add your first district to start assigning households."),
    ).toBeTruthy();
    unmount();
    render(
      <ParishRoster
        parishes={[]}
        orgName="Alder Creek Presbyterian Church"
        managed={{ ...MANAGED, canDefine: false, seatFilled: null }}
      />,
    );
    expect(
      screen.getByText(
        "No districts have been set up yet. Ask your congregation's administrator to add them.",
      ),
    ).toBeTruthy();
  });

  it("the No-district card appears with the count and links to the Unassigned page; it is hidden at zero and for a viewer who may not list", () => {
    const { unmount } = render(
      <ParishRoster
        parishes={PARISHES}
        orgName="Alder Creek Presbyterian Church"
        managed={{ ...MANAGED, unassignedCount: 12 }}
      />,
    );
    const card = screen.getByTestId("no-district-card");
    expect(within(card).getByText("No district yet")).toBeTruthy();
    expect(within(card).getByText("12 households aren't in a district.")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Review households" }).getAttribute("href")).toBe(
      "/o/alder-creek/directory/parishes/unassigned",
    );
    unmount();

    const one = render(
      <ParishRoster
        parishes={PARISHES}
        orgName="x"
        managed={{ ...MANAGED, unassignedCount: 1 }}
      />,
    );
    expect(screen.getByText("1 household isn't in a district.")).toBeTruthy();
    one.unmount();

    const zero = render(
      <ParishRoster parishes={PARISHES} orgName="x" managed={{ ...MANAGED, unassignedCount: 0 }} />,
    );
    expect(screen.queryByTestId("no-district-card")).toBeNull();
    zero.unmount();

    render(
      <ParishRoster
        parishes={PARISHES}
        orgName="x"
        managed={{ ...MANAGED, canListHouseholds: false, unassignedCount: null }}
      />,
    );
    expect(screen.queryByTestId("no-district-card")).toBeNull();
  });

  it("the seat callout is shown to a definer when no one holds the seat, and nowhere else", () => {
    const { unmount } = render(
      <ParishRoster
        parishes={PARISHES}
        orgName="x"
        managed={{ ...MANAGED, seatFilled: false }}
      />,
    );
    const callout = screen.getByTestId("seat-callout");
    expect(callout.textContent).toContain("No one is recorded in the Moderator seat for the Board of Deacons.");
    expect(within(callout).getByRole("link", { name: "Record it in Officers" }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/officers",
    );
    expect(callout.textContent).toContain("so the Moderator can assign households.");
    expect(callout.textContent).not.toMatch(/only the Moderator/i);
    unmount();

    render(
      <ParishRoster parishes={PARISHES} orgName="x" managed={{ ...MANAGED, seatFilled: true }} />,
    );
    expect(screen.queryByTestId("seat-callout")).toBeNull();
  });

  it("lists archived districts apart with an Archived badge, a link, and Restore for a definer (and no Rename/Archive)", () => {
    render(
      <ParishRoster
        parishes={PARISHES}
        orgName="x"
        managed={{
          ...MANAGED,
          archived: [
            {
              orgUnitId: "u9",
              name: "East District",
              unitType: "district",
              archived: true,
              deaconName: "Dee Deaconson",
              householdCount: 2,
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Archived districts" })).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(screen.getByText("Deacon: Dee Deaconson")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore East District" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rename East District" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive East District" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "View households in East District" }).getAttribute("href"),
    ).toBe("/o/alder-creek/directory/parishes/u9");
  });

  it("wraps a very long district name instead of overflowing (break-words)", () => {
    const longName = "A".repeat(80);
    render(
      <ParishRoster
        parishes={[{ ...PARISHES[0]!, name: longName }]}
        orgName="x"
        managed={MANAGED}
      />,
    );
    expect(screen.getByRole("heading", { name: longName }).className).toContain("break-words");
  });
});
