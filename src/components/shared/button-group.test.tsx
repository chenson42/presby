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

  it("renders a rounded, muted tray container holding every segment (docs/work-log/2026-08-28-directory-visual-refresh.md, Phase 4, item 2)", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    const group = screen.getByRole("group", { name: "Directory view" });
    expect(group.className).toContain("rounded-full");
    expect(group.className).toContain("bg-muted");
  });

  it("stays a single row (flex-nowrap + overflow-x-auto), never flex-wrap — regression for a two-row tray drawing a lopsided stadium shape at 375px (found live in Phase 4 verification)", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    const group = screen.getByRole("group", { name: "Directory view" });
    expect(group.className).toContain("flex-nowrap");
    expect(group.className).toContain("overflow-x-auto");
    expect(group.className).not.toContain("flex-wrap");

    // Segments must not shrink/wrap their own label text either.
    const membersLink = screen.getByRole("link", { name: "Members" });
    expect(membersLink.className).toContain("shrink-0");
  });

  it("renders the active segment as a raised pill — bg-background + shadow-sm — inside the tray", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    const className = screen.getByRole("link", { name: "Members" }).className;
    expect(className).toContain("bg-background");
    expect(className).toContain("shadow-sm");
    expect(className).toContain("rounded-full");
  });

  it("renders an inactive segment as flat/transparent — no raised-pill background or shadow", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    const className = screen.getByRole("link", { name: "Households" }).className;
    // `hover:bg-background/60` is the inactive segment's OWN hover treatment
    // and legitimately contains the substring "bg-background" — this checks
    // for the un-prefixed, always-on active fill specifically, not any
    // hover variant.
    expect(className.split(" ")).not.toContain("bg-background");
    expect(className).toContain("text-muted-foreground");
    expect(className).not.toContain("shadow-sm");
  });

  it("suppresses Button's own shadow classes on every segment so only the deliberate active-pill shadow-sm shows", () => {
    render(<ButtonGroup items={ITEMS} aria-label="Directory view" />);

    // `ghost` carries no shadow of its own, so this mostly guards against a
    // future Button primitive change adding one — pinned the same way the
    // prior connected-row shape pinned its own shadow suppression.
    const inactive = screen.getByRole("link", { name: "Households" }).className;
    expect(inactive).toContain("shadow-none");
    expect(inactive).toContain("hover:shadow-none");
  });
});
