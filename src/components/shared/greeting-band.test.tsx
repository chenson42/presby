// @vitest-environment jsdom
/**
 * MOVED HERE, UNMODIFIED IN BEHAVIOR, FROM
 * `src/components/org-portal/greeting.test.tsx` — commit 1 of docs/work-log/
 * 2026-08-27-platform-home-and-portal.md (Phase 3, DECISION-125). Import and
 * component name updated (`Greeting` → `GreetingBand`) for the rename that
 * accompanied the relocation; assertions are otherwise identical.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GreetingBand } from "./greeting-band";

afterEach(cleanup);

describe("GreetingBand — the portal home's <h1>", () => {
  it("greets by name when a display name is available", () => {
    render(<GreetingBand displayName="Sam" motionEnabled={false} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/^good (morning|afternoon|evening), Sam\.$/i);
  });

  it("degrades to a generic welcome when displayName is null (missing row or a degraded read)", () => {
    render(<GreetingBand displayName={null} motionEnabled={false} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Welcome.");
  });

  it("renders the bg-card band with a primary accent stripe unconditionally", () => {
    render(<GreetingBand displayName={null} motionEnabled={false} />);
    const heading = screen.getByRole("heading", { level: 1 });
    const band = heading.parentElement;
    expect(band?.className).toContain("bg-card");
    expect(band?.className).toContain("border-l-primary");
  });

  it("adds the mount fade-in class only when motionEnabled is true", () => {
    const { rerender } = render(
      <GreetingBand displayName="Sam" motionEnabled={true} />,
    );
    let band = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(band?.className).toContain("animate-in");
    expect(band?.className).toContain("fade-in-0");

    rerender(<GreetingBand displayName="Sam" motionEnabled={false} />);
    band = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(band?.className).not.toContain("animate-in");
    expect(band?.className).not.toContain("fade-in-0");
  });
});
