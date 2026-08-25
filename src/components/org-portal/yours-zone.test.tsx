// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { YoursZone } from "./yours-zone";

afterEach(cleanup);

describe("YoursZone — household present", () => {
  it("renders the household card with name, member count, and a directory link", () => {
    render(
      <YoursZone
        slug="alder-creek"
        household={{ id: "h1", name: "The Fennimore Family", memberCount: 3 }}
      />,
    );
    expect(screen.getByText("The Fennimore Family")).toBeTruthy();
    expect(screen.getByText("3 members")).toBeTruthy();
    const link = screen.getByRole("link", { name: /view directory/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/directory");
  });

  it("uses singular 'member' for a household of one", () => {
    render(
      <YoursZone
        slug="alder-creek"
        household={{ id: "h1", name: "Solo Household", memberCount: 1 }}
      />,
    );
    expect(screen.getByText("1 member")).toBeTruthy();
  });
});

describe("YoursZone — no household", () => {
  it("renders nothing at all — not an empty card — when household is null", () => {
    const { container } = render(<YoursZone slug="alder-creek" household={null} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});
