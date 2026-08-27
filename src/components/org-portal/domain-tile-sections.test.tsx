// @vitest-environment jsdom
/**
 * Tests for `DomainTileSections` — commit 2 of docs/work-log/
 * 2026-08-27-product-ia-scaffold.md (Phase 3 §4/§9, DECISION-117). Pins:
 *
 *   1. Given a mixed-domain tile list, renders one `<section
 *      id="domain-<key>">` per non-empty bucket, in DOMAIN_ORDER order, with
 *      the correct DOMAIN_LABELS heading text.
 *   2. A domain with zero matching tiles produces no section/heading at all
 *      — not an empty one.
 *   3. An empty or all-filtered-out tile list renders null.
 *   4. Card rendering is delegated to the real TileGrid (its own tests own
 *      the card internals) — this file only asserts the tiles that made it
 *      through render as links.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// `domain-tile-sections.tsx` imports the REAL `DOMAIN_LABELS`/`DOMAIN_ORDER`
// runtime values from `@/lib/org-portal/tiles` (not just the `PortalTile`
// type) — that module itself imports `server-only` and `@/lib/flags`
// (transitively `@/lib/db`), which cannot load in this jsdom test
// environment. Mocked here with the same literal values `tiles.ts` declares
// (pinned independently by `tiles.test.ts`'s own DOMAIN_ORDER/DOMAIN_LABELS
// shape assertion), the same pattern `portal-nav.test.tsx` uses.
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
}));

import { DomainTileSections } from "./domain-tile-sections";
import type { PortalTile } from "@/lib/org-portal/tiles";

afterEach(cleanup);

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

describe("DomainTileSections — bucketing", () => {
  it("renders one section per non-empty domain, in DOMAIN_ORDER order, with the correct heading text", () => {
    const tiles: PortalTile[] = [
      tile({ key: "events", label: "Events", domain: "worship" }),
      tile({ key: "directory", label: "Directory", domain: "people" }),
      tile({ key: "officers", label: "Officers", domain: "governance" }),
      tile({ key: "groups", label: "Groups", domain: "people" }),
    ];

    render(<DomainTileSections slug="alder-creek" tiles={tiles} />);

    const headings = screen.getAllByRole("heading", { level: 2 });
    // DOMAIN_ORDER = people, worship, giving, governance, reports,
    // communications, administration — so People & Membership must render
    // before Worship & Events, which must render before Governance & Courts,
    // regardless of the input array's own order.
    expect(headings.map((h) => h.textContent)).toEqual([
      "People & Membership",
      "Worship & Events",
      "Governance & Courts",
    ]);
  });

  it("gives each section the domain-<key> id, matching portal-nav.tsx's anchor convention", () => {
    const tiles: PortalTile[] = [
      tile({ key: "directory", label: "Directory", domain: "people" }),
    ];

    render(<DomainTileSections slug="alder-creek" tiles={tiles} />);

    expect(document.getElementById("domain-people")).toBeTruthy();
  });

  it("renders each domain's own tiles as links inside its section", () => {
    const tiles: PortalTile[] = [
      tile({ key: "directory", label: "Directory", domain: "people" }),
      tile({ key: "events", label: "Events", domain: "worship" }),
    ];

    render(<DomainTileSections slug="alder-creek" tiles={tiles} />);

    const peopleSection = document.getElementById("domain-people");
    const worshipSection = document.getElementById("domain-worship");
    expect(
      peopleSection?.querySelector('a[href="/o/alder-creek/directory"]'),
    ).toBeTruthy();
    expect(
      worshipSection?.querySelector('a[href="/o/alder-creek/events"]'),
    ).toBeTruthy();
  });

  it("a domain with zero matching tiles produces no section or heading at all — not an empty one", () => {
    const tiles: PortalTile[] = [
      tile({ key: "directory", label: "Directory", domain: "people" }),
    ];

    render(<DomainTileSections slug="alder-creek" tiles={tiles} />);

    expect(document.getElementById("domain-worship")).toBeNull();
    expect(document.getElementById("domain-giving")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Worship & Events" }),
    ).toBeNull();
  });
});

describe("DomainTileSections — empty input", () => {
  it("renders null for an empty tile list", () => {
    const { container } = render(
      <DomainTileSections slug="alder-creek" tiles={[]} />,
    );

    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });
});
