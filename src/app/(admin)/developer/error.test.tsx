// @vitest-environment jsdom
/**
 * The portal's error boundary (E14): calm copy, a working "Try again", a way
 * back, and never the error's text.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DeveloperError from "./error";

afterEach(cleanup);

describe("developer error boundary", () => {
  it("renders the calm copy and never the error message", () => {
    render(
      <DeveloperError
        error={new Error("select * from secret_table failed")}
        reset={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "We couldn't load this right now" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Something went wrong on our end. Try again in a moment."),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret_table");
  });

  it("calls reset from Try again", () => {
    const reset = vi.fn();
    render(<DeveloperError error={new Error("x")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("links back to the portal home at 44px", () => {
    render(<DeveloperError error={new Error("x")} reset={vi.fn()} />);
    const link = screen.getByRole("link", { name: "Back to the developer portal" });
    expect(link.getAttribute("href")).toBe("/developer");
    expect(link.className).toContain("min-h-11");
  });
});
