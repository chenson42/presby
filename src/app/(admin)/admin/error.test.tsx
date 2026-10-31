// @vitest-environment jsdom
/**
 * The console's error boundary (E14): calm copy, a working "Try again", a way
 * back to the dashboard, and never the error's text.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AdminError from "./error";

afterEach(cleanup);

describe("admin error boundary", () => {
  it("renders the calm copy and never the error message", () => {
    const error = new Error("select * from secret_table failed");
    render(<AdminError error={error} reset={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "We couldn't load this page" })).toBeTruthy();
    expect(screen.getByText("Something went wrong on our end. Try again in a moment.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret_table");
  });

  it("calls reset from Try again", () => {
    const reset = vi.fn();
    render(<AdminError error={new Error("x")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("links back to the dashboard at 44px", () => {
    render(<AdminError error={new Error("x")} reset={vi.fn()} />);
    const link = screen.getByRole("link", { name: "Back to the dashboard" });
    expect(link.getAttribute("href")).toBe("/admin");
    expect(link.className).toContain("min-h-11");
  });
});
