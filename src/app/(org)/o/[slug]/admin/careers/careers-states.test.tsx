// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CareersFeatureOff, CareersForbidden, CareersLoadError, CareersNotFound } from "./careers-states";

afterEach(cleanup);

describe("careers states - T20", () => {
  it("S1: toggle off offers the Features link ONLY to someone who can use it", () => {
    const { rerender } = render(<CareersFeatureOff name="Alder Creek" slug="alder-creek" canManageFeatures />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Job openings");
    expect(screen.getByTestId("careers-feature-off").textContent).toContain("Job openings aren't turned on for Alder Creek yet.");
    expect(screen.getByRole("link", { name: "Turn them on under Features" }).getAttribute("href")).toBe("/o/alder-creek/admin/features");
    expect(screen.getByRole("link", { name: "How features are turned on" }).getAttribute("href")).toBe(
      "/help/turning-features-on-and-off",
    );
    expect(screen.queryByText(/Ask someone/)).toBeNull();

    rerender(<CareersFeatureOff name="Alder Creek" slug="alder-creek" canManageFeatures={false} />);
    // No Features link for someone who cannot use it; the help link is for everyone.
    expect(screen.queryByRole("link", { name: "Turn them on under Features" })).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["How features are turned on"]);
    expect(screen.getByTestId("careers-feature-off").textContent).toContain(
      "Ask someone who manages Alder Creek's features to turn them on.",
    );
  });

  it("S2: forbidden names the organization and says who to ask", () => {
    render(<CareersForbidden name="Alder Creek" />);
    expect(screen.getByTestId("careers-forbidden").textContent).toContain(
      "You don't have permission to manage job openings at Alder Creek. If you think this is a mistake, ask your stated clerk or another administrator there.",
    );
  });

  it("S3: load error has a Try again that returns to the list", () => {
    render(<CareersLoadError slug="alder-creek" />);
    expect(screen.getByText("We couldn't load job openings right now. Try again in a moment.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/alder-creek/admin/careers");
  });

  it("S4: not found links back to the list", () => {
    render(<CareersNotFound slug="alder-creek" />);
    expect(screen.getByText("That job opening couldn't be found.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to job openings" }).getAttribute("href")).toBe("/o/alder-creek/admin/careers");
  });
});
