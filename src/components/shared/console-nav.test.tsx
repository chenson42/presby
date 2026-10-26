// @vitest-environment jsdom
/**
 * The desktop sidebar: labelled by its caller, and absent when there is
 * nothing to show (a viewer who is shown the forbidden state gets no nav).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/developer" }));

import { ConsoleNav } from "./console-nav";

afterEach(cleanup);

const groups = [
  { key: "m", heading: null, items: [{ label: "Home", href: "/developer", exact: true }] },
];

describe("ConsoleNav", () => {
  it("labels the nav landmark with consoleLabel", () => {
    render(<ConsoleNav groups={groups} consoleLabel="Developer portal" idPrefix="developer-nav" />);
    expect(screen.getByRole("navigation", { name: "Developer portal" })).toBeTruthy();
  });

  it("renders nothing when groups is empty", () => {
    const { container } = render(
      <ConsoleNav groups={[]} consoleLabel="Developer portal" idPrefix="developer-nav" />,
    );
    expect(container.innerHTML).toBe("");
  });
});
