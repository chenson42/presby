// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DeveloperNotFound from "./not-found";

afterEach(cleanup);

describe("developer not-found", () => {
  it("is calm and links back to the data model at 44px", () => {
    render(<DeveloperNotFound />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "We couldn't find that table or diagram",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "It may have been renamed or removed. Go back to the data model to find it.",
      ),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: "Back to the data model" });
    expect(link.getAttribute("href")).toBe("/developer/data-model");
    expect(link.className).toContain("min-h-11");
  });
});
