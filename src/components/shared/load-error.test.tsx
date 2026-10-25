// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LoadError } from "./load-error";

afterEach(cleanup);

describe("LoadError", () => {
  it("renders a Try again LINK for retryHref, 44px", () => {
    render(<LoadError title="T" body="B" retryHref="/admin" />);
    const link = screen.getByRole("link", { name: "Try again" });
    expect(link.getAttribute("href")).toBe("/admin");
    expect(link.className).toContain("min-h-11");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a Try again BUTTON for onRetry and calls it", () => {
    const onRetry = vi.fn();
    render(<LoadError title="T" body="B" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("uses the requested heading level and announces itself", () => {
    render(<LoadError title="T" body="B" retryHref="/x" headingLevel={1} />);
    expect(screen.getByRole("heading", { level: 1, name: "T" })).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders a secondary action in the children slot", () => {
    render(
      <LoadError title="T" body="B" retryHref="/x">
        <a href="/admin">Back</a>
      </LoadError>,
    );
    expect(screen.getByRole("link", { name: "Back" })).toBeTruthy();
  });
});
