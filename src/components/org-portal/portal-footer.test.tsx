// @vitest-environment jsdom
/**
 * Component tests for `<PortalFooter>` — docs/work-log/
 * 2026-08-26-portal-fpcw-directory-ux.md Phase 3/4 (Increment 3).
 *
 * `visiblePortalTiles()` is mocked (an async, flag-table-backed registry
 * read — `tile-grid.test.tsx` builds its `PortalTile` fixtures by hand
 * rather than exercising the real flag reads, and this file follows the
 * same convention one level up: mock the registry call itself, matching
 * `PortalNav`'s own build-order precedent named in Phase 3's Implementation
 * Order ("built and unit-tested against a mocked `visiblePortalTiles()`").
 *
 * Gate discipline (DECISION-040 — never rendered on access-denied/ended/
 * not-found/no-session pages) is `layout.tsx`'s job, pinned in
 * `layout.test.tsx`, not testable at this component's own layer — this file
 * only pins what `<PortalFooter>` does with the props it is handed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PortalTile } from "@/lib/org-portal/tiles";

const visiblePortalTiles = vi.fn();
vi.mock("@/lib/org-portal/tiles", () => ({
  visiblePortalTiles: (category: string, organizationType: string) =>
    visiblePortalTiles(category, organizationType),
}));

import { PortalFooter } from "./portal-footer";

beforeEach(() => {
  visiblePortalTiles.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

const DIRECTORY_TILE: PortalTile = {
  key: "directory",
  label: "Directory",
  description: "Browse the congregation directory.",
  href: (slug) => `/o/${slug}/directory`,
  flagKey: "org_portal.directory",
  category: "operate",
  // docs/work-log/2026-08-27-product-ia-scaffold.md, DECISION-117: `domain`
  // is now a required PortalTile field — mechanical fixture update.
  domain: "people",
};

async function renderFooter(
  props: Partial<Parameters<typeof PortalFooter>[0]> = {},
) {
  const el = await PortalFooter({
    slug: "alder-creek",
    organizationName: "Alder Creek Presbyterian Church",
    organizationType: "congregation",
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

describe("PortalFooter — nav recap", () => {
  it("always includes a Home link, even with zero visible tiles", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    await renderFooter();
    const nav = screen.getByRole("navigation", { name: "Footer" });
    const homeLink = screen.getByRole("link", { name: "Home" });
    expect(nav.contains(homeLink)).toBe(true);
    expect(homeLink.getAttribute("href")).toBe("/o/alder-creek");
  });

  it("calls visiblePortalTiles with the 'operate' category, never 'administer'", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    await renderFooter();
    expect(visiblePortalTiles).toHaveBeenCalledWith("operate", "congregation");
  });

  it("forwards organizationType to visiblePortalTiles() unchanged — bug fix, docs/work-log/2026-08-27-credentials-tile-org-type.md", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    await renderFooter({ organizationType: "presbytery" });
    expect(visiblePortalTiles).toHaveBeenCalledWith("operate", "presbytery");
  });

  it("recaps every visible tile from visiblePortalTiles(), built from the slug", async () => {
    visiblePortalTiles.mockResolvedValue([DIRECTORY_TILE]);
    await renderFooter({ slug: "bramblewood" });
    const link = screen.getByRole("link", { name: "Directory" });
    expect(link.getAttribute("href")).toBe("/o/bramblewood/directory");
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
