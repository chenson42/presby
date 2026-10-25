// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdminForbidden } from "./admin-forbidden";

afterEach(cleanup);

describe("AdminForbidden", () => {
  it("renders the page title as the h1 and the capability sentence", () => {
    render(<AdminForbidden title="Release notes" area="release notes" />);
    expect(screen.getByRole("heading", { level: 1, name: "Release notes" })).toBeTruthy();
    expect(
      screen.getByText(
        "Your account doesn't include release notes. Ask a platform administrator if you need it.",
      ),
    ).toBeTruthy();
  });

  it("varies by area", () => {
    render(<AdminForbidden title="Organizations" area="managing organizations" />);
    expect(screen.getByText(/doesn.t include managing organizations/)).toBeTruthy();
  });
});
