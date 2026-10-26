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

import { ConsoleNavLinks, activeNavHref } from "./console-nav-links";

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

describe("ConsoleNavLinks", () => {
  it("marks exactly one link aria-current=page", () => {
    pathname = "/admin/organizations/domains";
    render(<ConsoleNavLinks groups={ADMIN_NAV_GROUPS} idPrefix="admin-nav" />);
    expect(currentLinks()).toEqual(["Domains"]);
  });

  it("marks nothing on an unknown path", () => {
    pathname = "/admin/whatever";
    render(<ConsoleNavLinks groups={ADMIN_NAV_GROUPS} idPrefix="admin-nav" />);
    expect(currentLinks()).toEqual([]);
  });

  it("renders group headings, links at least 44px tall, and omits an empty heading", () => {
    pathname = "/admin";
    render(<ConsoleNavLinks groups={ADMIN_NAV_GROUPS} idPrefix="admin-nav" />);
    expect(screen.getByText("Access and settings")).toBeTruthy();
    for (const a of screen.getAllByRole("link")) {
      expect(a.className).toContain("min-h-11");
    }
    expect(screen.getAllByRole("list").length).toBe(ADMIN_NAV_GROUPS.length);
  });

  it("calls onNavigate when a link is clicked", () => {
    pathname = "/admin";
    const onNavigate = vi.fn();
    render(<ConsoleNavLinks groups={ADMIN_NAV_GROUPS} idPrefix="admin-nav" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("alsoActiveOn", () => {
  const groups = [
    {
      key: "main",
      heading: null,
      items: [
        { label: "Home", href: "/x", exact: true },
        { label: "Data", href: "/x/data", alsoActiveOn: ["/x/tables", "/x/erd"] },
        { label: "Docs", href: "/x/docs" },
      ],
    },
  ];
  const active = (p: string) => activeNavHref(p, groups);

  it("lights the item on a path under an alsoActiveOn prefix", () => {
    expect(active("/x/tables/roll_actions")).toBe("/x/data");
    expect(active("/x/erd/d-rolls")).toBe("/x/data");
    expect(active("/x/tables")).toBe("/x/data");
  });

  it("respects the segment boundary of an alsoActiveOn prefix", () => {
    expect(active("/x/tablesX")).toBeNull();
  });

  it("still lights only Home on its exact path, and Docs on /x/docs", () => {
    expect(active("/x")).toBe("/x");
    expect(active("/x/docs")).toBe("/x/docs");
  });

  it("marks aria-current on the rendered link", () => {
    pathname = "/x/tables/roll_actions";
    render(<ConsoleNavLinks groups={groups} idPrefix="x-nav" />);
    expect(currentLinks()).toEqual(["Data"]);
  });

  it("uses the idPrefix for heading ids", () => {
    pathname = "/admin";
    const { container } = render(
      <ConsoleNavLinks
        groups={[{ key: "ref", heading: "Reference", items: [{ label: "A", href: "/a" }] }]}
        idPrefix="developer-nav"
      />,
    );
    expect(container.querySelector("#developer-nav-ref")).toBeTruthy();
  });
});
