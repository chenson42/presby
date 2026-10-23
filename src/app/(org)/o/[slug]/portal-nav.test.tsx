// @vitest-environment jsdom
/**
 * Tests for `PortalNav`'s mapping — portal-sitemap-footer pipeline
 * (docs/work-log/2026-10-23-portal-sitemap-footer.md, DECISION-220).
 *
 * The entry construction (Home, domain anchors, the Administration rule, the
 * `administration`-domain exclusion, icon keys) moved to `buildPortalMenu()`
 * and is pinned by `src/lib/org-portal/portal-menu.test.ts`. What THIS file
 * pins is the thin layer left: `getPortalMenu()` receives the slug,
 * organizationType and viewer unchanged; each menu entry is mapped to exactly
 * `label/href/exact/icon` (`key` and `children` are not passed on); and the
 * result renders through `PortalNavLinks`. Active-state styling is
 * `PortalNavLinks`' job (portal-nav-links.test.tsx).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getPortalMenu = vi.fn();
vi.mock("@/lib/org-portal/visible-tiles", () => ({
  getPortalMenu: (slug: string, organizationType: string, viewer: unknown) =>
    getPortalMenu(slug, organizationType, viewer),
}));

const linksSpy = vi.fn();
vi.mock("./portal-nav-links", () => ({
  PortalNavLinks: (props: unknown) => {
    linksSpy(props);
    return <div data-testid="portal-nav-links-stub" />;
  },
}));

import { PortalNav } from "./portal-nav";

const VIEWER = { personId: "person-1", organizationId: "org-1" };

afterEach(() => {
  cleanup();
  getPortalMenu.mockReset();
  linksSpy.mockReset();
});

const MENU = [
  {
    key: "home",
    label: "Home",
    href: "/o/acme",
    exact: true,
    icon: "home",
    children: [],
  },
  {
    key: "people",
    label: "Community",
    href: "/o/acme#domain-people",
    exact: true,
    icon: "people",
    children: [
      { key: "directory", label: "Directory", href: "/o/acme/admin/directory", comingSoon: false },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    href: "/o/acme/admin",
    exact: false,
    icon: "administration",
    children: [
      { key: "administration-overview", label: "Administration overview", href: "/o/acme/admin", comingSoon: false },
    ],
  },
];

describe("PortalNav — maps the menu to nav entries", () => {
  it("passes exactly label/href/exact/icon per entry, in menu order, and drops key and children", async () => {
    getPortalMenu.mockResolvedValue(MENU);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation", viewer: VIEWER });
    render(tree);

    expect(screen.getByTestId("portal-nav-links-stub")).toBeTruthy();
    expect(linksSpy).toHaveBeenCalledWith({
      entries: [
        { label: "Home", href: "/o/acme", exact: true, icon: "home" },
        { label: "Community", href: "/o/acme#domain-people", exact: true, icon: "people" },
        { label: "Administration", href: "/o/acme/admin", exact: false, icon: "administration" },
      ],
    });
  });

  it("renders only Home when the menu holds only Home", async () => {
    getPortalMenu.mockResolvedValue([MENU[0]]);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation", viewer: VIEWER });
    render(tree);

    expect(linksSpy).toHaveBeenCalledWith({
      entries: [{ label: "Home", href: "/o/acme", exact: true, icon: "home" }],
    });
  });

  it("forwards slug, organizationType and viewer to getPortalMenu() unchanged — bug fix, docs/work-log/2026-08-27-credentials-tile-org-type.md", async () => {
    getPortalMenu.mockResolvedValue([MENU[0]]);

    await PortalNav({ slug: "northern-reach", organizationType: "presbytery", viewer: VIEWER });

    expect(getPortalMenu).toHaveBeenCalledWith("northern-reach", "presbytery", VIEWER);
  });

  it("hands the client leaf plain data only (survives a JSON round trip: no functions, no components)", async () => {
    getPortalMenu.mockResolvedValue(MENU);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation", viewer: VIEWER });
    render(tree);

    const { entries } = linksSpy.mock.calls[0][0];
    expect(JSON.parse(JSON.stringify(entries))).toEqual(entries);
    for (const entry of entries) expect(typeof entry.icon).toBe("string");
  });
});
