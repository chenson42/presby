// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TestModeBadge } from "./test-mode-badge";

afterEach(cleanup);

describe("TestModeBadge", () => {
  it("says Test mode in words (not colour alone) and explains the totals rule", () => {
    render(<TestModeBadge />);
    const badge = screen.getByTestId("giving-test-mode-badge");
    expect(badge.getAttribute("role")).toBe("status");
    expect(badge.textContent).toMatch(/Test mode\./);
    expect(badge.textContent).toMatch(/kept out of every total, export and year-end statement/);
  });
});
