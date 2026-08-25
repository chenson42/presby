// @vitest-environment jsdom
/**
 * Tests for `PortalNav`'s server-side entry construction — portal-chrome
 * pipeline (docs/work-log/2026-08-25-portal-chrome.md, Phase 3,
 * Implementation Order step 5).
 *
 * `visiblePortalTiles()` is mocked; its own flag-filtering behavior is
 * pinned by `src/lib/org-portal/tiles.test.ts`. What THIS file pins is the
 * entry-construction contract: Home is hardcoded and unconditional, the
 * rest mirror `visiblePortalTiles()`'s output in declaration order, and the
 * `exact` flag is set correctly for each. Active-state styling itself is
 * `PortalNavLinks`' job (portal-nav-links.test.tsx).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const visiblePortalTiles = vi.fn();
vi.mock("@/lib/org-portal/tiles", () => ({
  visiblePortalTiles: () => visiblePortalTiles(),
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
  linksSpy.mockReset();
});

describe("PortalNav — entry construction", () => {
  it("renders only Home when every tile flag is off", async () => {
    visiblePortalTiles.mockResolvedValue([]);

    const tree = await PortalNav({ slug: "acme" });
    render(tree);

    expect(screen.getByTestId("portal-nav-links-stub")).toBeTruthy();
    expect(linksSpy).toHaveBeenCalledWith({
      entries: [{ label: "Home", href: "/o/acme", exact: true }],
    });
  });

  it("prepends Home, unconditional and exact, ahead of every visible tile", async () => {
    visiblePortalTiles.mockResolvedValue([
      {
        key: "directory",
        label: "Directory",
        description: "Browse the congregation directory.",
        href: (slug: string) => `/o/${slug}/directory`,
        flagKey: "org_portal.directory",
      },
      {
        key: "tickets",
        label: "Tickets",
        description: "File and track support tickets.",
        href: (slug: string) => `/o/${slug}/tickets`,
        flagKey: "org_portal.tickets",
      },
    ]);

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
        label: "Administration",
        description: "Manage roles and permissions for this organization.",
        href: (slug: string) => `/o/${slug}/admin/roles`,
        flagKey: "org_portal.roles",
      },
      {
        key: "feedback",
        label: "Give feedback",
        description: "Share feedback about your congregation's portal.",
        href: (slug: string) => `/o/${slug}/feedback`,
        flagKey: "org_portal.feedback",
      },
    ]);

    const tree = await PortalNav({ slug: "acme" });
    render(tree);

    const entries = linksSpy.mock.calls[0][0].entries;
    expect(entries.map((e: { label: string }) => e.label)).toEqual([
      "Home",
      "Administration",
      "Give feedback",
    ]);
  });
});
