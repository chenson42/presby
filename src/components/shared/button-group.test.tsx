// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Home, Users } from "lucide-react";
import { ButtonGroup, type ButtonGroupItem } from "./button-group";

afterEach(cleanup);

const ITEMS: ButtonGroupItem[] = [
  { key: "a", label: "Members", href: "/o/acme/directory", icon: Users, active: true, "aria-current": "page" },
  { key: "b", label: "Households", href: "/o/acme/directory?view=households", icon: Home },
];

describe("ButtonGroup", () => {
  it("renders one link per item, each with its label as the accessible name", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Households" })).toBeTruthy();
  });

  it("renders as a group with the given accessible name", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    expect(screen.getByRole("group", { name: "Directory view" })).toBeTruthy();
  });

  it("sets aria-current only on the active item's link", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    expect(
      screen.getByRole("link", { name: "Members" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Households" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("hrefs point at each item's own destination", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    expect(
      screen.getByRole("link", { name: "Members" }).getAttribute("href"),
    ).toBe("/o/acme/directory");
    expect(
      screen.getByRole("link", { name: "Households" }).getAttribute("href"),
    ).toBe("/o/acme/directory?view=households");
  });

  it("renders correctly with no icon on an item", () => {
    render(
      <ButtonGroup
        items={[{ key: "a", label: "Plain", href: "/x" }]}
        aria-label="Plain group"
      />,
    );

    expect(screen.getByRole("link", { name: "Plain" })).toBeTruthy();
  });

  it("icons don't leak into the accessible name", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    // The icon is aria-hidden; if it weren't, the accessible name would pick
    // up stray SVG title/text content and the exact-name query above would
    // already have failed. This pins the intent explicitly.
    const svg = screen.getByRole("link", { name: "Members" }).querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("suppresses the shadow treatment on an inactive (outline) segment, so a connected row doesn't independently float on hover (docs/work-log/2026-08-27-button-modernization.md Phase 3(d))", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    // "Households" is the inactive item — it renders variant="outline",
    // which now carries `shadow-xs hover:shadow-sm` from the Button
    // primitive. Pin that the group's own `shadow-none hover:shadow-none`
    // override actually wins after twMerge, not just that the source string
    // contains it — a bare `shadow-xs`/`hover:shadow-sm` surviving would mean
    // the suppression silently lost the class-order fight.
    const className = screen.getByRole("link", { name: "Households" }).className;
    expect(className).toContain("shadow-none");
    expect(className).toContain("hover:shadow-none");
    expect(className).not.toContain("shadow-xs");
    expect(className).not.toContain("hover:shadow-sm");
  });

  it("suppresses the shadow treatment on the active (default) segment too", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    // "Members" is the active item — it renders variant="default", which now
    // carries `shadow-xs hover:shadow-sm` from the Button primitive as well.
    const className = screen.getByRole("link", { name: "Members" }).className;
    expect(className).toContain("shadow-none");
    expect(className).toContain("hover:shadow-none");
    expect(className).not.toContain("hover:shadow-sm");
  });
});
