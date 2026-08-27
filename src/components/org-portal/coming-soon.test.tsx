// @vitest-environment jsdom
/**
 * `coming-soon.tsx` — docs/work-log/2026-08-27-product-ia-scaffold.md, Phase
 * 3 §3. All three exports are pure presentational: no data fetch, no
 * mutation, no native dialog. This file pins the prop→copy contract and the
 * feedback-link destination.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ComingSoon,
  PlaceholderFlagOff,
  PlaceholderNotAvailable,
} from "./coming-soon";

afterEach(() => {
  cleanup();
});

describe("PlaceholderFlagOff", () => {
  it("renders the area heading and the honest 'isn't turned on yet' copy naming the org", () => {
    render(<PlaceholderFlagOff area="Giving & Finance" orgName="Alder Creek" />);
    expect(
      screen.getByRole("heading", { name: "Giving & Finance" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Giving & Finance isn.t turned on for Alder Creek yet/i),
    ).toBeTruthy();
  });
});

describe("PlaceholderNotAvailable", () => {
  it("renders the area heading and product-not-here copy, with no permission-shaped language", () => {
    render(
      <PlaceholderNotAvailable
        area="Congregation Oversight"
        orgName="Alder Creek"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Congregation Oversight" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Congregation Oversight isn.t available for Alder Creek/i),
    ).toBeTruthy();
    expect(screen.queryByText(/don.t have permission/i)).toBeNull();
    expect(screen.queryByText(/ask your/i)).toBeNull();
  });
});

describe("ComingSoon", () => {
  it("renders the area, the given description, and a 'Coming soon.' marker", () => {
    render(
      <ComingSoon
        area="Giving & Finance"
        description="Fund accounting, giving records, and budgets."
        slug="alder-creek"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Giving & Finance" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Fund accounting, giving records, and budgets."),
    ).toBeTruthy();
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
  });

  it("links 'Want this sooner? Tell us.' to /o/<slug>/feedback", () => {
    render(
      <ComingSoon area="Worship" description="Service planning." slug="alder-creek" />,
    );
    const link = screen.getByRole("link", {
      name: /want this sooner\? tell us\./i,
    });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/feedback");
  });

  it("links back to the org home", () => {
    render(
      <ComingSoon area="Worship" description="Service planning." slug="alder-creek" />,
    );
    const link = screen.getByRole("link", {
      name: /back to your organization/i,
    });
    expect(link.getAttribute("href")).toBe("/o/alder-creek");
  });

  it("renders no native dialog and no button (pure presentational — links only)", () => {
    render(
      <ComingSoon area="Worship" description="Service planning." slug="alder-creek" />,
    );
    expect(screen.queryAllByRole("button").length).toBe(0);
    expect(screen.queryAllByRole("dialog").length).toBe(0);
  });
});
