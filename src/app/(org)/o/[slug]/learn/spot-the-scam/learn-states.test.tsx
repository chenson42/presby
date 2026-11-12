// @vitest-environment jsdom
/**
 * T11 - the (org) Spot the scam page's non-data states (docs/work-log/2026-11-10-learn-inc1a.md,
 * Phase 3 Copy G8): "isn't turned on" with the Features link ONLY for someone who can use it,
 * and the load error.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LearnLoadError, LearnOff } from "./learn-states";

afterEach(cleanup);

describe("learn states - T11", () => {
  it("off: names the organization, links to Features ONLY for a manager, and says who to ask otherwise; the help link is for everyone", () => {
    const { rerender } = render(<LearnOff name="Alder Creek" slug="alder-creek" canManageFeatures />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Spot the scam");
    expect(screen.getByTestId("learn-off").textContent).toContain("Spot the scam isn't turned on for Alder Creek yet.");
    expect(screen.getByRole("link", { name: "Turn it on under Features" }).getAttribute("href")).toBe("/o/alder-creek/admin/features");
    expect(screen.getByRole("link", { name: "How features are turned on" }).getAttribute("href")).toBe("/help/turning-features-on-and-off");
    expect(screen.queryByText(/Ask someone/)).toBeNull();

    rerender(<LearnOff name="Alder Creek" slug="alder-creek" canManageFeatures={false} />);
    expect(screen.queryByRole("link", { name: "Turn it on under Features" })).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["How features are turned on"]);
    expect(screen.getByTestId("learn-off").textContent).toContain("Ask someone who manages Alder Creek's features to turn it on.");
  });

  it("off wraps a very long organization name", () => {
    render(<LearnOff name={"N".repeat(120)} slug="alder-creek" canManageFeatures={false} />);
    expect(screen.getByTestId("learn-off").querySelector("p")!.className).toContain("[overflow-wrap:anywhere]");
  });

  it("load error: says so (an alert), and a Try again that returns to this page", () => {
    render(<LearnLoadError slug="alder-creek" />);
    expect(screen.getByRole("alert").textContent).toBe("We couldn't load Spot the scam right now. Try again in a moment.");
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/o/alder-creek/learn/spot-the-scam");
    // It is not the "off" state: nothing says the feature is not turned on.
    expect(screen.queryByText(/isn't turned on/)).toBeNull();
  });
});
