// @vitest-environment jsdom
/**
 * Tests for `PortalNavLinks`' active-state logic — portal-chrome pipeline
 * (docs/work-log/2026-08-25-portal-chrome.md, Phase 3, Implementation Order
 * step 5). The one behavior that needed a `'use client'` leaf at all:
 * `exact` entries (Home) match only the literal pathname; every other entry
 * matches the pathname itself OR a child route beneath it, so a visit to
 * `/o/acme/directory/<personId>` still shows "Directory" as current.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const usePathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

import { PortalNavLinks, type PortalNavEntry } from "./portal-nav-links";

const ENTRIES: PortalNavEntry[] = [
  { label: "Home", href: "/o/acme", exact: true },
  { label: "Directory", href: "/o/acme/directory", exact: false },
  { label: "Tickets", href: "/o/acme/tickets", exact: false },
];

afterEach(() => {
  cleanup();
  usePathname.mockReset();
});

describe("PortalNavLinks — active state", () => {
  it("marks Home current only on the exact org-home pathname", () => {
    usePathname.mockReturnValue("/o/acme");

    render(<PortalNavLinks entries={ENTRIES} />);

    expect(
      screen.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Directory" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("does NOT mark Home current on a child route beneath it (exact means exact)", () => {
    usePathname.mockReturnValue("/o/acme/directory");

    render(<PortalNavLinks entries={ENTRIES} />);

    expect(
      screen.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks a non-exact entry current on its own pathname", () => {
    usePathname.mockReturnValue("/o/acme/directory");

    render(<PortalNavLinks entries={ENTRIES} />);

    expect(
      screen
        .getByRole("link", { name: "Directory" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("marks a non-exact entry current on a child route beneath it", () => {
    usePathname.mockReturnValue("/o/acme/directory/person-123");

    render(<PortalNavLinks entries={ENTRIES} />);

    expect(
      screen
        .getByRole("link", { name: "Directory" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("does not cross-match a differently-named sibling route", () => {
    // Guards the exact bug a bare `startsWith` (no trailing-slash boundary)
    // would let through: "/o/acme/directory-archive" must not read as
    // "Directory" active.
    usePathname.mockReturnValue("/o/acme/directory-archive");

    render(<PortalNavLinks entries={ENTRIES} />);

    expect(
      screen
        .getByRole("link", { name: "Directory" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("applies an unconditional border-b-2 accent, border-primary only when active", () => {
    usePathname.mockReturnValue("/o/acme");

    render(<PortalNavLinks entries={ENTRIES} />);

    const homeLink = screen.getByRole("link", { name: "Home" });
    const directoryLink = screen.getByRole("link", { name: "Directory" });

    expect(homeLink.className).toContain("border-b-2");
    expect(homeLink.className).toContain("border-primary");
    expect(directoryLink.className).toContain("border-b-2");
    expect(directoryLink.className).toContain("border-transparent");
  });

  it("resolves overlapping prefixes to the single most-specific entry — regression for 'Groups' also lighting up 'Administration'", () => {
    // Found live: "Administration" (`/o/acme/admin`) is a *prefix* of
    // "Groups" (`/o/acme/admin/groups`) purely because Groups happens to be
    // an "operate"-category tile routed through /admin/*, not because it's an
    // Organization Administration hub destination. Both entries' independent
    // `startsWith`/exact checks used to pass simultaneously; only the longest
    // matching href should ever end up "current."
    const entriesWithAdminOverlap: PortalNavEntry[] = [
      { label: "Home", href: "/o/acme", exact: true },
      { label: "Groups", href: "/o/acme/admin/groups", exact: false },
      { label: "Administration", href: "/o/acme/admin", exact: false },
    ];
    usePathname.mockReturnValue("/o/acme/admin/groups");

    render(<PortalNavLinks entries={entriesWithAdminOverlap} />);

    expect(
      screen.getByRole("link", { name: "Groups" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Administration" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("still marks Administration current on its own index page, with no more-specific entry matching", () => {
    const entriesWithAdminOverlap: PortalNavEntry[] = [
      { label: "Home", href: "/o/acme", exact: true },
      { label: "Groups", href: "/o/acme/admin/groups", exact: false },
      { label: "Administration", href: "/o/acme/admin", exact: false },
    ];
    usePathname.mockReturnValue("/o/acme/admin");

    render(<PortalNavLinks entries={entriesWithAdminOverlap} />);

    expect(
      screen
        .getByRole("link", { name: "Administration" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Groups" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("renders every entry as a link to its href, in order", () => {
    usePathname.mockReturnValue("/o/acme");

    render(<PortalNavLinks entries={ENTRIES} />);

    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Home",
      "Directory",
      "Tickets",
    ]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/o/acme",
      "/o/acme/directory",
      "/o/acme/tickets",
    ]);
  });
});
