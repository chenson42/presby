// @vitest-environment jsdom
/**
 * Component tests for `<PortalFooter>` — docs/work-log/
 * 2026-08-26-portal-fpcw-directory-ux.md Phase 3/4 (Increment 3), rewritten
 * by the portal-sitemap-footer pipeline (docs/work-log/
 * 2026-10-23-portal-sitemap-footer.md, DECISION-220/221) for the site-map
 * design.
 *
 * `getPortalMenu()` is mocked: its reads and `buildPortalMenu()`'s rules are
 * pinned by `visible-tiles.test.ts` and `portal-menu.test.ts`. What THIS file
 * pins is how the footer renders a `PortalMenu` it is handed: Home as a
 * leading link (not a column), one `<h2>` column per entry with children,
 * headings that are not links, lists labelled by their heading, no heading or
 * `<ul>` for an entry with no children, the single "Administration overview"
 * link, and the "Coming soon" suffix.
 *
 * Gate discipline (DECISION-040 — never rendered on access-denied/ended/
 * not-found/no-session pages) is `layout.tsx`'s job, pinned in
 * `layout.test.tsx`, not testable at this component's own layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const getPortalMenu = vi.fn();
vi.mock("@/lib/org-portal/visible-tiles", () => ({
  getPortalMenu: (slug: string, organizationType: string, viewer: unknown) =>
    getPortalMenu(slug, organizationType, viewer),
}));

import { PortalFooter } from "./portal-footer";

const VIEWER = { personId: "person-1", organizationId: "org-1" };

const HOME = {
  key: "home",
  label: "Home",
  href: "/o/alder-creek",
  exact: true,
  icon: "home",
  children: [],
};

const COMMUNITY = {
  key: "people",
  label: "Community",
  href: "/o/alder-creek#domain-people",
  exact: true,
  icon: "people",
  children: [
    { key: "directory", label: "Directory", href: "/o/alder-creek/directory", comingSoon: false },
    { key: "groups", label: "Groups", href: "/o/alder-creek/admin/groups", comingSoon: false },
  ],
};

const COMMUNICATIONS = {
  key: "communications",
  label: "Communications",
  href: "/o/alder-creek#domain-communications",
  exact: true,
  icon: "communications",
  children: [
    { key: "communications", label: "Communications", href: "/o/alder-creek/admin/communications", comingSoon: true },
  ],
};

const ADMINISTRATION = {
  key: "administration",
  label: "Administration",
  href: "/o/alder-creek/admin",
  exact: false,
  icon: "administration",
  children: [
    { key: "administration-overview", label: "Administration overview", href: "/o/alder-creek/admin", comingSoon: false },
  ],
};

beforeEach(() => {
  getPortalMenu.mockReset().mockResolvedValue([HOME]);
});

afterEach(() => {
  cleanup();
});

async function renderFooter(
  props: Partial<Parameters<typeof PortalFooter>[0]> = {},
) {
  const el = await PortalFooter({
    slug: "alder-creek",
    organizationName: "Alder Creek Presbyterian Church",
    organizationType: "congregation",
    viewer: VIEWER,
    profile: null,
    ...props,
  });
  return render(el);
}

describe("PortalFooter — contact info", () => {
  it("renders the org name, address, and a tel: link when both are present", async () => {
    await renderFooter({
      profile: { address: "1 Fixture Way, Fixtureville, OH", phone: "555-0100" },
    });
    expect(screen.getByText("Alder Creek Presbyterian Church")).toBeTruthy();
    expect(screen.getByText("1 Fixture Way, Fixtureville, OH")).toBeTruthy();
    const phoneLink = screen.getByRole("link", { name: "555-0100" });
    expect(phoneLink.getAttribute("href")).toBe("tel:555-0100");
  });

  it("renders the address and phone at the body TYPE_SCALE role (text-base), not dense", async () => {
    await renderFooter({
      profile: { address: "1 Fixture Way, Fixtureville, OH", phone: "555-0100" },
    });
    const address = screen.getByText("1 Fixture Way, Fixtureville, OH");
    const phoneLink = screen.getByRole("link", { name: "555-0100" });
    expect(address.className).toContain("text-base");
    expect(phoneLink.className).toContain("text-base");
  });

  it("renders only the phone line when address is null", async () => {
    await renderFooter({ profile: { address: null, phone: "555-0100" } });
    expect(screen.getByRole("link", { name: "555-0100" })).toBeTruthy();
    // The org-name line is part of the SAME contact-info block, so it still
    // renders — only the address paragraph itself is omitted.
    expect(screen.getByText("Alder Creek Presbyterian Church")).toBeTruthy();
  });

  it("renders only the address line when phone is null", async () => {
    await renderFooter({ profile: { address: "1 Fixture Way", phone: null } });
    expect(screen.getByText("1 Fixture Way")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^tel:/ })).toBeNull();
  });

  it("omits the entire contact-info block — not an empty section — when profile is null", async () => {
    await renderFooter({ profile: null });
    // The org name would otherwise appear in the contact-info block; it
    // still appears in the copyright line, so assert on the address/phone
    // absence specifically rather than the org name's absence.
    expect(screen.queryByText(/fixture way/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /^tel:/ })).toBeNull();
  });

  it("omits the entire contact-info block when profile exists but both address and phone are null", async () => {
    await renderFooter({ profile: { address: null, phone: null } });
    expect(screen.queryByRole("link", { name: /^tel:/ })).toBeNull();
  });
});

describe("PortalFooter — site map", () => {
  it("always includes a Home link, even when the menu holds only Home", async () => {
    await renderFooter();
    const nav = screen.getByRole("navigation", { name: "Footer" });
    const homeLink = screen.getByRole("link", { name: "Home" });
    expect(nav.contains(homeLink)).toBe(true);
    expect(homeLink.getAttribute("href")).toBe("/o/alder-creek");
  });

  it("renders no heading and no list when the menu holds only Home", async () => {
    await renderFooter();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.queryAllByRole("list")).toHaveLength(0);
  });

  it("forwards slug, organizationType and viewer to getPortalMenu() unchanged", async () => {
    await renderFooter({ slug: "northern-reach", organizationType: "presbytery" });
    expect(getPortalMenu).toHaveBeenCalledWith("northern-reach", "presbytery", VIEWER);
  });

  it("renders Home as a link, not as a column", async () => {
    getPortalMenu.mockResolvedValue([HOME, COMMUNITY]);
    await renderFooter();
    expect(screen.queryByRole("heading", { name: "Home" })).toBeNull();
    expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
  });

  it("renders one h2 per entry with children, in menu order", async () => {
    getPortalMenu.mockResolvedValue([HOME, COMMUNITY, COMMUNICATIONS, ADMINISTRATION]);
    await renderFooter();
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => h.tagName)).toEqual(["H2", "H2", "H2"]);
    expect(headings.map((h) => h.textContent)).toEqual([
      "Community",
      "Communications",
      "Administration",
    ]);
  });

  it("makes headings plain text, never links", async () => {
    getPortalMenu.mockResolvedValue([HOME, COMMUNITY]);
    await renderFooter();
    const heading = screen.getByRole("heading", { name: "Community" });
    expect(heading.querySelector("a")).toBeNull();
    expect(heading.closest("a")).toBeNull();
    // The only link named Community-ish is none: the heading is not a link.
    expect(screen.queryByRole("link", { name: "Community" })).toBeNull();
  });

  it("labels each list by its heading and lists the children as links built from the menu hrefs", async () => {
    getPortalMenu.mockResolvedValue([HOME, COMMUNITY]);
    await renderFooter();
    const list = screen.getByRole("list", { name: "Community" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Directory", "Groups"]);
    expect(links[0].getAttribute("href")).toBe("/o/alder-creek/directory");
  });

  it("renders no heading and no <ul> for an entry with no children", async () => {
    getPortalMenu.mockResolvedValue([
      HOME,
      { ...COMMUNITY, children: [] },
    ]);
    await renderFooter();
    expect(screen.queryByRole("heading", { name: "Community" })).toBeNull();
    expect(screen.queryAllByRole("list")).toHaveLength(0);
  });

  it("gives Administration exactly one link, Administration overview, to the hub", async () => {
    getPortalMenu.mockResolvedValue([HOME, COMMUNITY, ADMINISTRATION]);
    await renderFooter();
    const list = screen.getByRole("list", { name: "Administration" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("Administration overview");
    expect(links[0].getAttribute("href")).toBe("/o/alder-creek/admin");
  });

  it("shows 'Coming soon' as text on a comingSoon child and not on a built one", async () => {
    getPortalMenu.mockResolvedValue([HOME, COMMUNITY, COMMUNICATIONS]);
    await renderFooter();
    const soon = within(
      screen.getByRole("list", { name: "Communications" }),
    ).getByRole("link");
    expect(soon.textContent).toContain("Coming soon");
    const built = within(screen.getByRole("list", { name: "Community" }));
    expect(built.queryByText("Coming soon")).toBeNull();
  });

  it("uses no *-brand utility class (check:brand-scope C1) and no <details>", async () => {
    getPortalMenu.mockResolvedValue([HOME, COMMUNITY, COMMUNICATIONS, ADMINISTRATION]);
    const { container } = await renderFooter();
    expect(container.innerHTML).not.toMatch(/-brand\b/);
    expect(container.querySelector("details")).toBeNull();
  });
});

describe("PortalFooter — copyright", () => {
  it("renders the current year and the organization name", async () => {
    await renderFooter({ organizationName: "Bramblewood Presbyterian Church" });
    const year = new Date().getFullYear();
    expect(
      screen.getByText(
        new RegExp(`${year}.*Bramblewood Presbyterian Church.*All rights reserved`, "i"),
      ),
    ).toBeTruthy();
  });
});
