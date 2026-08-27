// @vitest-environment jsdom
/**
 * `ParishRoster` — the Parishes tab's per-district panels. Extracted as its
 * own test file (portal UX review 2026-08-26, H4) to pin the "these are
 * information panels, not dead-end links" fix: no `<a>`/`role=link` inside a
 * panel, and no `<Card>`-recipe hover-lift class riding along with it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ParishRoster } from "./parish-roster";
import type { ParishRosterEntry } from "@/lib/directory";

afterEach(() => {
  cleanup();
});

const PARISHES: ParishRosterEntry[] = [
  {
    orgUnitId: "u1",
    orgUnitName: "Creekside District",
    deaconName: "Priya Balakrishnan",
    householdCount: 3,
  },
  {
    orgUnitId: "u2",
    orgUnitName: "Uptown District",
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
