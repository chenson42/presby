// @vitest-environment jsdom
/**
 * Active state (E8): the longest matching href wins; a segment boundary is
 * respected; Dashboard is exact; an unknown path lights nothing. And the
 * click callback the phone menu uses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ADMIN_NAV_GROUPS } from "@/lib/admin-portal/nav";

let pathname = "/admin";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { AdminNavLinks, activeNavHref } from "./admin-nav-links";

afterEach(cleanup);

const currentLinks = () =>
  screen
    .getAllByRole("link")
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent);

describe("activeNavHref", () => {
  const active = (p: string | null) => activeNavHref(p, ADMIN_NAV_GROUPS);

  it("lights Domains, not Organizations, on /admin/organizations/domains", () => {
    expect(active("/admin/organizations/domains")).toBe("/admin/organizations/domains");
  });

  it("lights Organizations on a detail page and on /new", () => {
    expect(active("/admin/organizations/0b6c2d3e")).toBe("/admin/organizations");
    expect(active("/admin/organizations/new")).toBe("/admin/organizations");
  });

  it("respects the segment boundary", () => {
    expect(active("/admin/organizationsX")).toBeNull();
  });

  it("makes Dashboard exact: lit on /admin, not on an unknown /admin path", () => {
    expect(active("/admin")).toBe("/admin");
    expect(active("/admin/whatever")).toBeNull();
  });

  it("returns null without a pathname", () => {
    expect(active(null)).toBeNull();
  });
});

describe("AdminNavLinks", () => {
  it("marks exactly one link aria-current=page", () => {
    pathname = "/admin/organizations/domains";
    render(<AdminNavLinks groups={ADMIN_NAV_GROUPS} />);
    expect(currentLinks()).toEqual(["Domains"]);
  });

  it("marks nothing on an unknown path", () => {
    pathname = "/admin/whatever";
    render(<AdminNavLinks groups={ADMIN_NAV_GROUPS} />);
    expect(currentLinks()).toEqual([]);
  });

  it("renders group headings, links at least 44px tall, and omits an empty heading", () => {
    pathname = "/admin";
    render(<AdminNavLinks groups={ADMIN_NAV_GROUPS} />);
    expect(screen.getByText("Access and settings")).toBeTruthy();
    for (const a of screen.getAllByRole("link")) {
      expect(a.className).toContain("min-h-11");
    }
    expect(screen.getAllByRole("list").length).toBe(ADMIN_NAV_GROUPS.length);
  });

  it("calls onNavigate when a link is clicked", () => {
    pathname = "/admin";
    const onNavigate = vi.fn();
    render(<AdminNavLinks groups={ADMIN_NAV_GROUPS} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
