// @vitest-environment jsdom
/**
 * Tests for <AffiliationSection> —
 * docs/work-log/2026-09-28-organization-parent-picker.md Phase 4.
 * Read-only, no actions to mock.
 *
 * Pins: the headless copy (the section never vanishes); the parent named
 * with a link to ITS OWN `[id]` page; the relationship, authority
 * (minuted vs backfilled) and minute reference rendering; the F41 "predates
 * our records" null date; and that no control (form, button, input) exists.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AffiliationSection } from "./affiliation-section";
import type { OrganizationAffiliationAdminDetail } from "@/lib/org-provisioning";

afterEach(cleanup);

const PARENT_ID = "11111111-1111-4111-8111-111111111111";

function affiliation(
  overrides: Partial<NonNullable<OrganizationAffiliationAdminDetail>> = {},
): OrganizationAffiliationAdminDetail {
  return {
    relationshipType: "member_congregation",
    effectiveFrom: "2026-05-14",
    authority: "backfill",
    minuteReference: null,
    parent: {
      id: PARENT_ID,
      name: "Presbytery of the Shenandoah Valley",
      slug: "psv",
      organizationType: "presbytery",
    },
    ...overrides,
  };
}

describe("AffiliationSection", () => {
  it("headless: renders the heading and the no-parent copy, never disappears", () => {
    render(<AffiliationSection affiliation={null} />);
    expect(screen.getByText("Council affiliation")).toBeTruthy();
    expect(
      screen.getByText("This organization has no recorded parent council."),
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("names the parent with a link to the parent's own detail page", () => {
    render(<AffiliationSection affiliation={affiliation()} />);
    const link = screen.getByRole("link", {
      name: "Presbytery of the Shenandoah Valley",
    });
    expect(link.getAttribute("href")).toBe(`/admin/organizations/${PARENT_ID}`);
    expect(screen.getByText("(Presbytery)")).toBeTruthy();
    expect(screen.getByText("Member congregation")).toBeTruthy();
  });

  it("labels each relationship type", () => {
    render(
      <AffiliationSection
        affiliation={affiliation({ relationshipType: "member_nwc" })}
      />,
    );
    expect(screen.getByText("Member new worshiping community")).toBeTruthy();
  });

  it("backfilled with no minute says so", () => {
    render(<AffiliationSection affiliation={affiliation()} />);
    expect(screen.getByText(/Backfilled \(no minute on file\)/)).toBeTruthy();
  });

  it("recorded shows 'Minuted' and the minute reference", () => {
    render(
      <AffiliationSection
        affiliation={affiliation({
          authority: "recorded",
          minuteReference: "Minutes 2026-05, item 7",
        })}
      />,
    );
    expect(screen.getByText(/Minuted/)).toBeTruthy();
    expect(screen.getByText("Minutes 2026-05, item 7")).toBeTruthy();
  });

  it("a null effectiveFrom reads 'Predates our records'", () => {
    render(
      <AffiliationSection affiliation={affiliation({ effectiveFrom: null })} />,
    );
    expect(screen.getByText("Predates our records")).toBeTruthy();
  });

  it("is read-only: no form controls", () => {
    const { container } = render(<AffiliationSection affiliation={affiliation()} />);
    expect(container.querySelector("form, button, input, select")).toBeNull();
  });
});
