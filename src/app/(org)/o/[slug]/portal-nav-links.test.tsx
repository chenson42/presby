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
