// @vitest-environment jsdom
/**
 * Tests for `PortalNav`'s server-side entry construction — portal-chrome
 * pipeline (docs/work-log/2026-08-25-portal-chrome.md, Phase 3), updated by
 * the portal-reorg pipeline for the "Administration" hub entry, the
 * credentials-tile-org-type bug fix for the required `organizationType`
 * prop, and — this commit — the product-IA scaffold's domain-anchor
 * computation (docs/work-log/2026-08-27-product-ia-scaffold.md Phase 3 §4,
 * DECISION-117): one nav entry per `PortalDomain` with at least one
 * flag-visible `"operate"` tile for this org's type, replacing the old
 * one-entry-per-tile row.
 *
 * `visiblePortalTiles()` is mocked; its own flag-filtering and org-type-
 * scoping behavior is pinned by `src/lib/org-portal/tiles.test.ts`. What
 * THIS file pins is the entry-construction contract: Home is hardcoded and
 * unconditional and `exact`; domain-anchor entries appear in `DOMAIN_ORDER`
 * order, are `exact: true`, and point at `/o/<slug>#domain-<key>`; the
 * `"administration"` domain is EXCLUDED from this computation even if a
 * misconfigured tile would otherwise qualify; "Administration" is appended
 * last, gated solely on `org_portal.admin_hub`; and `organizationType` is
 * forwarded to `visiblePortalTiles()` unchanged. Active-state styling itself
 * is `PortalNavLinks`' job (portal-nav-links.test.tsx).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PortalTile } from "@/lib/org-portal/tiles";

const visiblePortalTiles = vi.fn();
// `portal-nav.tsx` imports the REAL `DOMAIN_LABELS`/`DOMAIN_ORDER` runtime
// values from `@/lib/org-portal/tiles` — that module itself imports
// `server-only` and `@/lib/flags` (transitively `@/lib/db`), which cannot
// load in this jsdom test environment. Mocked here with the same literal
// values `tiles.ts` declares (independently pinned by `tiles.test.ts`'s own
// DOMAIN_ORDER/DOMAIN_LABELS shape assertion).
vi.mock("@/lib/org-portal/tiles", () => ({
  DOMAIN_LABELS: {
    people: "People & Membership",
    worship: "Worship & Events",
    giving: "Giving & Finance",
    governance: "Governance & Courts",
    reports: "Reports & Insights",
    communications: "Communications",
    administration: "Administration",
  },
  DOMAIN_ORDER: [
    "people",
    "worship",
    "giving",
    "governance",
    "reports",
    "communications",
    "administration",
  ],
  visiblePortalTiles: (category: string, organizationType: string) =>
    visiblePortalTiles(category, organizationType),
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

function tile(overrides: Partial<PortalTile> & Pick<PortalTile, "key" | "domain">): PortalTile {
  return {
    label: overrides.key,
    description: `${overrides.key} description.`,
    href: (slug: string) => `/o/${slug}/${overrides.key}`,
    flagKey: `org_portal.${overrides.key}`,
    category: "operate",
    ...overrides,
  };
}

describe("PortalNav — entry construction", () => {
  it("renders only Home when every tile flag and the admin-hub flag are off", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation" });
    render(tree);

    expect(screen.getByTestId("portal-nav-links-stub")).toBeTruthy();
    expect(linksSpy).toHaveBeenCalledWith({
      entries: [{ label: "Home", href: "/o/acme", exact: true }],
    });
  });

  it("calls visiblePortalTiles with the 'operate' category, never 'administer'", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    isFlagEnabled.mockResolvedValue(false);

    await PortalNav({ slug: "acme", organizationType: "congregation" });

    expect(visiblePortalTiles).toHaveBeenCalledWith("operate", "congregation");
  });

  it("forwards organizationType to visiblePortalTiles() unchanged — bug fix, docs/work-log/2026-08-27-credentials-tile-org-type.md", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    isFlagEnabled.mockResolvedValue(false);

    await PortalNav({ slug: "northern-reach", organizationType: "presbytery" });

    expect(visiblePortalTiles).toHaveBeenCalledWith("operate", "presbytery");
  });

  it("produces one anchor entry per domain with a visible tile, in DOMAIN_ORDER order, each pointing at /o/<slug>#domain-<key> and exact:true", async () => {
    visiblePortalTiles.mockResolvedValue([
      tile({ key: "events", domain: "worship" }),
      tile({ key: "directory", domain: "people" }),
      tile({ key: "officers", domain: "governance" }),
    ]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation" });
    render(tree);

    expect(linksSpy).toHaveBeenCalledWith({
      entries: [
        { label: "Home", href: "/o/acme", exact: true },
        { label: "People & Membership", href: "/o/acme#domain-people", exact: true },
        { label: "Worship & Events", href: "/o/acme#domain-worship", exact: true },
        { label: "Governance & Courts", href: "/o/acme#domain-governance", exact: true },
      ],
    });
  });

  it("a domain with no visible tile for this org type produces no anchor entry", async () => {
    // Simulates a congregation with Officers off and no other governance
    // tile visible — Governance & Courts must not appear.
    visiblePortalTiles.mockResolvedValue([
      tile({ key: "directory", domain: "people" }),
    ]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation" });
    render(tree);

    const entries = linksSpy.mock.calls[0][0].entries;
    expect(
      entries.some((e: { label: string }) => e.label === "Governance & Courts"),
    ).toBe(false);
  });

  it("collapses multiple tiles in the same domain to ONE anchor entry, not one per tile", async () => {
    visiblePortalTiles.mockResolvedValue([
      tile({ key: "directory", domain: "people" }),
      tile({ key: "members", domain: "people" }),
      tile({ key: "groups", domain: "people" }),
    ]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation" });
    render(tree);

    const entries = linksSpy.mock.calls[0][0].entries;
    const peopleEntries = entries.filter(
      (e: { label: string }) => e.label === "People & Membership",
    );
    expect(peopleEntries).toHaveLength(1);
  });

  it("EXCLUDES the 'administration' domain from anchor computation even when a misconfigured tile carries it with category:'operate' — proving the collision-avoidance rule (DECISION-117)", async () => {
    visiblePortalTiles.mockResolvedValue([
      // This tile should never exist in the real registry (every
      // "administration"-domain tile is category: "administer"), but
      // visiblePortalTiles() is mocked here specifically to prove the nav
      // itself enforces the exclusion rule, not merely benefiting from
      // today's data shape by accident.
      tile({ key: "rogue-admin-tile", domain: "administration" }),
    ]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation" });
    render(tree);

    expect(linksSpy).toHaveBeenCalledWith({
      entries: [{ label: "Home", href: "/o/acme", exact: true }],
    });
  });

  it("appends 'Administration' last when org_portal.admin_hub is on, after every domain anchor", async () => {
    visiblePortalTiles.mockResolvedValue([
      tile({ key: "directory", domain: "people" }),
    ]);
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.admin_hub",
    );

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation" });
    render(tree);

    expect(linksSpy).toHaveBeenCalledWith({
      entries: [
        { label: "Home", href: "/o/acme", exact: true },
        { label: "People & Membership", href: "/o/acme#domain-people", exact: true },
        { label: "Administration", href: "/o/acme/admin", exact: false },
      ],
    });
  });

  it("omits 'Administration' when org_portal.admin_hub is off, regardless of visible tiles", async () => {
    visiblePortalTiles.mockResolvedValue([
      tile({ key: "directory", domain: "people" }),
    ]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation" });
    render(tree);

    const entries = linksSpy.mock.calls[0][0].entries;
    expect(
      entries.some((e: { label: string }) => e.label === "Administration"),
    ).toBe(false);
  });

  it("checks isFlagEnabled with the exact org_portal.admin_hub key", async () => {
    visiblePortalTiles.mockResolvedValue([]);
    isFlagEnabled.mockResolvedValue(false);

    await PortalNav({ slug: "acme", organizationType: "congregation" });

    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.admin_hub");
  });
});

describe("PortalNav — a presbytery-only domain absent for a congregation", () => {
  it("produces no anchor entry when visiblePortalTiles() (mocking the real org-type-scoping behavior) returns nothing for that domain", async () => {
    // visiblePortalTiles() itself owns orgTypeScope filtering (pinned in
    // tiles.test.ts); this proves PortalNav correctly omits the domain when
    // the (mocked) tile list simply doesn't include it for this org type.
    visiblePortalTiles.mockResolvedValue([
      tile({ key: "directory", domain: "people" }),
      // No governance-domain tile returned — as would be the case for a
      // congregation when officers/credentials/committees/oversight are all
      // either off or presbytery-scoped.
    ]);
    isFlagEnabled.mockResolvedValue(false);

    const tree = await PortalNav({ slug: "acme", organizationType: "congregation" });
    render(tree);

    const entries = linksSpy.mock.calls[0][0].entries;
    expect(
      entries.some((e: { label: string }) => e.label === "Governance & Courts"),
    ).toBe(false);
  });
});
