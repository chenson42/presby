/**
 * Pure tests for `buildPortalMenu()` (portal-sitemap-footer pipeline,
 * DECISION-220). Only `server-only` is mocked (`tiles.ts` imports it, as in
 * `tiles.test.ts`). If `tiles.ts` ever imported this module back, or this
 * module pulled in `org-features`, this file would stop loading with only that
 * one mock — which is the F135 cycle guard.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ADMIN_OVERVIEW_LABEL,
  buildPortalMenu,
  type PortalMenu,
} from "./portal-menu";
import {
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  PORTAL_TILES,
  type PortalTile,
} from "./tiles";

const SLUG = "alpha";

function tile(
  key: string,
  domain: PortalTile["domain"],
  category: PortalTile["category"] = "operate",
  extra: Partial<PortalTile> = {},
): PortalTile {
  return {
    key,
    label: `Label ${key}`,
    description: "d",
    href: (slug: string) => `/o/${slug}/admin/${key}`,
    category,
    domain,
    ...extra,
  } as PortalTile;
}

const build = (
  operateTiles: PortalTile[],
  administerTiles: PortalTile[] = [],
  adminHubEnabled = false,
): PortalMenu =>
  buildPortalMenu({ slug: SLUG, operateTiles, administerTiles, adminHubEnabled });

describe("buildPortalMenu — Home", () => {
  it("is always first and has no children, even with no tiles", () => {
    const menu = build([]);
    expect(menu).toHaveLength(1);
    expect(menu[0]).toEqual({
      key: "home",
      label: "Home",
      href: "/o/alpha",
      exact: true,
      icon: "home",
      children: [],
    });
  });
});

describe("buildPortalMenu — domain entries", () => {
  it("emits one entry per non-empty domain, in DOMAIN_ORDER, with anchor hrefs", () => {
    const menu = build([
      tile("c", "communications"),
      tile("p", "people"),
      tile("w", "worship"),
    ]);
    expect(menu.map((e) => e.key)).toEqual([
      "home",
      "people",
      "worship",
      "communications",
    ]);
    const people = menu[1];
    expect(people.href).toBe("/o/alpha#domain-people");
    expect(people.exact).toBe(true);
    expect(people.icon).toBe("people");
  });

  it("follows DOMAIN_ORDER regardless of tile order", () => {
    const tiles = [...DOMAIN_ORDER]
      .filter((d) => d !== "administration")
      .reverse()
      .map((d) => tile(`t-${d}`, d));
    const keys = build(tiles).map((e) => e.key);
    expect(keys).toEqual([
      "home",
      ...DOMAIN_ORDER.filter((d) => d !== "administration"),
    ]);
  });

  it("omits a domain with no visible tile", () => {
    const menu = build([tile("p", "people")]);
    expect(menu.map((e) => e.key)).toEqual(["home", "people"]);
  });

  it("lists a domain's tiles as children in input order with resolved hrefs", () => {
    const menu = build([tile("b", "people"), tile("a", "people")]);
    expect(menu[1].children).toEqual([
      { key: "b", label: "Label b", href: "/o/alpha/admin/b", comingSoon: false },
      { key: "a", label: "Label a", href: "/o/alpha/admin/a", comingSoon: false },
    ]);
  });

  it("carries comingSoon through to children and defaults it to false", () => {
    const menu = build([
      tile("soon", "communications", "operate", { comingSoon: true }),
      tile("real", "communications"),
    ]);
    const kids = menu[1].children;
    expect(kids.find((c) => c.key === "soon")?.comingSoon).toBe(true);
    expect(kids.find((c) => c.key === "real")?.comingSoon).toBe(false);
  });

  it("never emits the administration domain as a domain entry, and drops an operate tile carrying it", () => {
    const menu = build([tile("odd", "administration"), tile("p", "people")]);
    expect(menu.map((e) => e.key)).toEqual(["home", "people"]);
    expect(JSON.stringify(menu)).not.toContain("Label odd");
  });

  it("sources the Community label from DOMAIN_LABELS", () => {
    expect(DOMAIN_LABELS.people).toBe("Community");
    const menu = build([tile("p", "people")]);
    expect(menu[1].label).toBe(DOMAIN_LABELS.people);
  });
});

describe("buildPortalMenu — Administration truth table", () => {
  const adminTile = tile("roles", "administration", "administer");

  it.each([
    { hub: false, admin: [] as PortalTile[], present: false },
    { hub: false, admin: [adminTile], present: false },
    { hub: true, admin: [] as PortalTile[], present: false },
    { hub: true, admin: [adminTile], present: true },
  ])("hub=$hub, administer tiles=$admin.length -> present=$present", (c) => {
    const menu = build([tile("p", "people")], c.admin, c.hub);
    expect(menu.some((e) => e.key === "administration")).toBe(c.present);
  });

  it("is last, links to the hub, and has exactly the overview child", () => {
    const menu = build(
      [tile("p", "people"), tile("w", "worship")],
      [adminTile],
      true,
    );
    const last = menu[menu.length - 1];
    expect(last).toEqual({
      key: "administration",
      label: "Administration",
      href: "/o/alpha/admin",
      exact: false,
      icon: "administration",
      children: [
        {
          key: "administration-overview",
          label: ADMIN_OVERVIEW_LABEL,
          href: "/o/alpha/admin",
          comingSoon: false,
        },
      ],
    });
  });

  it("never copies an administer tile into any children (Q1)", () => {
    const admin = [
      tile("roles", "administration", "administer"),
      tile("events", "worship", "administer"),
    ];
    const menu = build([tile("p", "people")], admin, true);
    const childKeys = menu.flatMap((e) => e.children.map((c) => c.key));
    const childLabels = menu.flatMap((e) => e.children.map((c) => c.label));
    for (const t of admin) {
      expect(childKeys).not.toContain(t.key);
      expect(childLabels).not.toContain(t.label);
    }
  });
});

describe("buildPortalMenu — structure invariants", () => {
  const everything = (): PortalMenu =>
    build(
      PORTAL_TILES.filter((t) => t.category === "operate"),
      PORTAL_TILES.filter((t) => t.category === "administer"),
      true,
    );

  it("has unique top-level labels over the real registry", () => {
    const labels = everything().map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("puts Home first and Administration last over the real registry", () => {
    const keys = everything().map((e) => e.key);
    expect(keys[0]).toBe("home");
    expect(keys[keys.length - 1]).toBe("administration");
  });

  it("is plain serializable data (survives a JSON round trip)", () => {
    const menu = everything();
    expect(JSON.parse(JSON.stringify(menu))).toEqual(menu);
    for (const entry of menu) {
      expect(typeof entry.href).toBe("string");
      expect(typeof entry.icon).toBe("string");
      for (const child of entry.children) {
        expect(typeof child.href).toBe("string");
        expect(typeof child.comingSoon).toBe("boolean");
      }
    }
  });
});
