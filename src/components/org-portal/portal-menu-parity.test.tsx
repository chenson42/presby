// @vitest-environment jsdom
/**
 * Render parity — portal-sitemap-footer pipeline (docs/work-log/
 * 2026-10-23-portal-sitemap-footer.md, DECISION-220, Phase 2 Ruling 6).
 *
 * The nav and the footer are given the SAME menu, built by the REAL
 * `buildPortalMenu()` from hand-built tiles, and the test asserts the thing
 * the operator complained about cannot recur: the nav's link labels, in
 * order, are Home followed by the footer's column headings, in order. The
 * third assertion pins each domain entry's `#domain-<key>` anchor to a
 * `<section id>` that `DomainTileSections` renders for the same tiles,
 * without coupling the components.
 *
 * Only `getPortalMenu` (the server-only loader) is replaced; it delegates to
 * the real builder. `server-only` is mocked because `tiles.ts` imports it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ usePathname: () => "/o/alder-creek" }));

import { buildPortalMenu } from "@/lib/org-portal/portal-menu";
import {
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  type PortalTile,
} from "@/lib/org-portal/tiles";

const fixture = vi.hoisted(() => ({
  operate: [] as unknown[],
  administer: [] as unknown[],
  hub: true,
}));

vi.mock("@/lib/org-portal/visible-tiles", async () => {
  const { buildPortalMenu: build } = await import("@/lib/org-portal/portal-menu");
  return {
    getPortalMenu: async (slug: string) =>
      build({
        slug,
        operateTiles: fixture.operate as PortalTile[],
        administerTiles: fixture.administer as PortalTile[],
        adminHubEnabled: fixture.hub,
      }),
  };
});

import { PortalNav } from "@/app/(org)/o/[slug]/portal-nav";
import { PortalFooter } from "./portal-footer";
import { DomainTileSections } from "@/components/shared/domain-tile-sections";

const VIEWER = { personId: "person-1", organizationId: "org-1" };

function tile(
  key: string,
  domain: PortalTile["domain"],
  category: PortalTile["category"] = "operate",
  extra: Partial<PortalTile> = {},
): PortalTile {
  return {
    key,
    label: `Tool ${key}`,
    description: "d",
    href: (slug: string) => `/o/${slug}/admin/${key}`,
    category,
    domain,
    ...extra,
  } as PortalTile;
}

afterEach(() => {
  cleanup();
  fixture.operate = [];
  fixture.administer = [];
  fixture.hub = true;
});

async function renderBoth() {
  const props = {
    slug: "alder-creek",
    organizationType: "congregation" as const,
    viewer: VIEWER,
  };
  const navTree = await PortalNav(props);
  const nav = render(navTree);
  const navLabels = Array.from(nav.container.querySelectorAll("a")).map((a) =>
    a.textContent?.trim(),
  );
  nav.unmount();

  const footerTree = await PortalFooter({
    ...props,
    organizationName: "Alder Creek Presbyterian Church",
    profile: null,
  });
  const footer = render(footerTree);
  const footerNav = footer.getByRole("navigation", { name: "Footer" });
  const home = within(footerNav).getByRole("link", { name: "Home" });
  const headings = within(footerNav)
    .queryAllByRole("heading")
    .map((h) => h.textContent);
  return { navLabels, footerLabels: [home.textContent, ...headings] };
}

describe("nav and footer render one menu", () => {
  it("nav labels, in order, equal Home then the footer's column headings", async () => {
    fixture.operate = [
      tile("c", "communications", "operate", { comingSoon: true }),
      tile("directory", "people"),
      tile("calendar", "worship"),
      tile("officers", "governance"),
    ];
    fixture.administer = [tile("roles", "administration", "administer")];

    const { navLabels, footerLabels } = await renderBoth();

    expect(footerLabels).toEqual([
      "Home",
      "Community",
      "Worship & Events",
      "Governance & Courts",
      "Communications",
      "Administration",
    ]);
    expect(navLabels).toEqual(footerLabels);
  });

  it("stays equal when Administration is absent (hub on, no administer tile)", async () => {
    fixture.operate = [tile("directory", "people")];
    const { navLabels, footerLabels } = await renderBoth();
    expect(footerLabels).toEqual(["Home", "Community"]);
    expect(navLabels).toEqual(footerLabels);
  });

  it("stays equal when the hub is off even with an administer tile visible", async () => {
    fixture.operate = [tile("directory", "people")];
    fixture.administer = [tile("roles", "administration", "administer")];
    fixture.hub = false;
    const { navLabels, footerLabels } = await renderBoth();
    expect(navLabels).toEqual(footerLabels);
    expect(navLabels).not.toContain("Administration");
  });

  it("stays equal with only Home", async () => {
    const { navLabels, footerLabels } = await renderBoth();
    expect(footerLabels).toEqual(["Home"]);
    expect(navLabels).toEqual(footerLabels);
  });
});

describe("every domain entry's anchor targets a DomainTileSections section", () => {
  it("matches #domain-<key> to a rendered <section id> for the same tiles", () => {
    const tiles = [
      tile("directory", "people"),
      tile("calendar", "worship"),
      tile("giving", "giving"),
      tile("officers", "governance"),
      tile("insights", "reports"),
      tile("comms", "communications"),
    ];
    const menu = buildPortalMenu({
      slug: "alder-creek",
      operateTiles: tiles,
      administerTiles: [],
      adminHubEnabled: false,
    });

    const { container } = render(
      <DomainTileSections
        tiles={tiles}
        getHref={(t) => t.href("alder-creek")}
        domainOrder={DOMAIN_ORDER}
        domainLabels={DOMAIN_LABELS}
      />,
    );

    const domainEntries = menu.filter((e) => e.key !== "home");
    expect(domainEntries).toHaveLength(6);
    for (const entry of domainEntries) {
      const fragment = entry.href.split("#")[1];
      const section = container.querySelector(`section[id="${fragment}"]`);
      expect(section, `section for ${fragment}`).not.toBeNull();
      expect(section?.querySelector("h2")?.textContent).toBe(entry.label);
    }
  });
});

