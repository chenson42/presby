// @vitest-environment jsdom
/**
 * Tests for `HouseholdCard` — the chevron/hover affordance added in
 * docs/work-log/2026-08-26-portal-ux-fixes.md, Wave 1B, finding L1.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HouseholdCard } from "./household-card";
import type { HouseholdSummary } from "@/lib/directory";

afterEach(cleanup);

const HOUSEHOLD: HouseholdSummary = {
  householdId: "household-1",
  name: "The Lovelace Household",
  city: "Alder Creek",
  region: "OH",
  memberCount: 3,
  deaconName: null,
};

describe("HouseholdCard — chevron affordance (L1)", () => {
  it("renders the name link with a trailing chevron that nudges on hover", () => {
    render(<HouseholdCard household={HOUSEHOLD} slug="alder-creek" />);
    const link = screen.getByRole("link", { name: /the lovelace household/i });
    expect(link.getAttribute("href")).toBe(
      "/o/alder-creek/directory/households/household-1",
    );
    const chevron = link.querySelector("svg.lucide-chevron-right");
    expect(chevron).toBeTruthy();
    expect(chevron?.getAttribute("class")).toContain("group-hover:translate-x-0.5");
  });

  it("keeps the existing hover:shadow-md lift on the outer Card", () => {
    const { container } = render(
      <HouseholdCard household={HOUSEHOLD} slug="alder-creek" />,
    );
    const card = container.firstElementChild;
    expect(card?.className).toContain("hover:shadow-md");
  });

  it("still renders the member-count badge alongside the chevron affordance", () => {
    render(<HouseholdCard household={HOUSEHOLD} slug="alder-creek" />);
    expect(screen.getByText("3 members")).toBeTruthy();
  });
});
