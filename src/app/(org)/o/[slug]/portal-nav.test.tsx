// @vitest-environment jsdom
/**
 * Tests for `PortalNav`'s server-side entry construction — portal-chrome
 * pipeline (docs/work-log/2026-08-25-portal-chrome.md, Phase 3,
 * Implementation Order step 5), updated for the portal-reorg pipeline
 * (docs/work-log/2026-08-26-portal-reorg-and-modernization.md, Phase 3):
 * `visiblePortalTiles()` is now category-parameterized (`PortalNav` always
 * passes `"operate"`), and a new hardcoded "Administration" entry is
 * appended, gated on `org_portal.admin_hub`.
 *
 * `visiblePortalTiles()` is mocked; its own flag-filtering behavior is
 * pinned by `src/lib/org-portal/tiles.test.ts`. What THIS file pins is the
 * entry-construction contract: Home is hardcoded and unconditional, the
 * rest mirror `visiblePortalTiles("operate")`'s output in declaration order,
 * the `exact` flag is set correctly for each, and "Administration" is
 * appended last, gated solely on the `org_portal.admin_hub` flag —
 * regardless of the viewer's own permissions. Active-state styling itself is
 * `PortalNavLinks`' job (portal-nav-links.test.tsx).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const visiblePortalTiles = vi.fn();
vi.mock("@/lib/org-portal/tiles", () => ({
  visiblePortalTiles: (category: string) => visiblePortalTiles(category),
}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (key: string) => isFlagEnabled(key),
}));

const linksSpy = vi.fn();
vi.mock("./portal-nav-links", () => ({
  PortalNavLinks: (props: unknown) => {
    linksSpy(props);
    return <div data-testid="portal-nav-links-stub" />;
  },
}));

import { PortalNav } from "./portal-nav";

afterEach(() => {
  cleanup();
  visiblePortalTiles.mockReset();
  isFlagEnabled.mockReset();
  linksSpy.mockReset();
});

describe("PortalNav — entry construction", () => {
  it("renders only Home when every tile flag and the admin-hub flag are off", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme" });
    render(tree);

    expect(screen.getByTestId("portal-nav-links-stub")).toBeTruthy();
    expect(linksSpy).toHaveBeenCalledWith({
      entries: [{ label: "Home", href: "/o/acme", exact: true }],
    });
  });

  it("calls visiblePortalTiles with the 'operate' category, never 'administer'", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    isFlagEnabled.mockResolvedValue(false);

    await PortalNav({ slug: "acme" });

    expect(visiblePortalTiles).toHaveBeenCalledWith("operate");
  });

  it("prepends Home, unconditional and exact, ahead of every visible tile", async () => {
    visiblePortalTiles.mockResolvedValue([
      {
        key: "directory",
        label: "Directory",
        description: "Browse the congregation directory.",
        href: (slug: string) => `/o/${slug}/directory`,
        flagKey: "org_portal.directory",
        category: "operate",
      },
      {
        key: "tickets",
        label: "Tickets",
        description: "File and track support tickets.",
        href: (slug: string) => `/o/${slug}/tickets`,
        flagKey: "org_portal.tickets",
        category: "operate",
      },
    ]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme" });
    render(tree);

    expect(linksSpy).toHaveBeenCalledWith({
      entries: [
        { label: "Home", href: "/o/acme", exact: true },
        { label: "Directory", href: "/o/acme/directory", exact: false },
        { label: "Tickets", href: "/o/acme/tickets", exact: false },
      ],
    });
  });

  it("preserves visiblePortalTiles()'s declaration order among the visible subset", async () => {
    visiblePortalTiles.mockResolvedValue([
      {
        key: "roles",
        label: "Roles",
        description: "Manage roles and permissions for this organization.",
        href: (slug: string) => `/o/${slug}/admin/roles`,
        flagKey: "org_portal.roles",
        category: "administer",
      },
      {
        key: "feedback",
        label: "Give feedback",
        description: "Share feedback about your congregation's portal.",
        href: (slug: string) => `/o/${slug}/feedback`,
        flagKey: "org_portal.feedback",
        category: "operate",
      },
    ]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme" });
    render(tree);

    const entries = linksSpy.mock.calls[0][0].entries;
    expect(entries.map((e: { label: string }) => e.label)).toEqual([
      "Home",
      "Roles",
      "Give feedback",
    ]);
  });

  it("appends 'Administration' last when org_portal.admin_hub is on", async () => {
    visiblePortalTiles.mockResolvedValue([
      {
        key: "directory",
        label: "Directory",
        description: "Browse the congregation directory.",
        href: (slug: string) => `/o/${slug}/directory`,
        flagKey: "org_portal.directory",
        category: "operate",
      },
    ]);
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.admin_hub",
    );

    const tree = await PortalNav({ slug: "acme" });
    render(tree);

    expect(linksSpy).toHaveBeenCalledWith({
      entries: [
        { label: "Home", href: "/o/acme", exact: true },
        { label: "Directory", href: "/o/acme/directory", exact: false },
        { label: "Administration", href: "/o/acme/admin", exact: false },
      ],
    });
  });

  it("omits 'Administration' when org_portal.admin_hub is off, regardless of visible tiles", async () => {
    visiblePortalTiles.mockResolvedValue([
      {
        key: "directory",
        label: "Directory",
        description: "Browse the congregation directory.",
        href: (slug: string) => `/o/${slug}/directory`,
        flagKey: "org_portal.directory",
        category: "operate",
      },
    ]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme" });
    render(tree);

    const entries = linksSpy.mock.calls[0][0].entries;
    expect(
      entries.some((e: { label: string }) => e.label === "Administration"),
    ).toBe(false);
  });

  it("checks isFlagEnabled with the exact org_portal.admin_hub key", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    isFlagEnabled.mockResolvedValue(false);

    await PortalNav({ slug: "acme" });

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.admin_hub");
  });
});
