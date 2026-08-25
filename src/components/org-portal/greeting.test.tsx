// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Greeting } from "./greeting";

afterEach(cleanup);

describe("Greeting — the portal home's <h1>", () => {
  it("greets by name when a display name is available", () => {
    render(<Greeting displayName="Sam" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/^good (morning|afternoon|evening), Sam\.$/i);
  });

  it("degrades to a generic welcome when displayName is null (missing row or a degraded read)", () => {
    render(<Greeting displayName={null} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Welcome.");
  });
});
