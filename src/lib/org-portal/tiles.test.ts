/**
 * Unit tests for the portal-home tile registry.
 *
 * Properties pinned: every tile's `flagKey` is a real row `scripts/seed.ts`
 * seeds (a hard-coded snapshot below — this module cannot import `scripts/
 * seed.ts` itself, which opens a real DB connection at import time); every
 * tile's `category` is one of the two literal values (guards a future tile
 * shipping with neither filter matching it — a silent third state); every
 * tile's `domain` is one of the seven `DOMAIN_ORDER` values (docs/work-log/
 * 2026-08-27-product-ia-scaffold.md, DECISION-117); and
 * `visiblePortalTiles(category, organizationType)` filters by category, then
 * by `orgTypeScope` (if the tile declares one), then by flag, independent of
 * any permission (portal-reorg pipeline, docs/work-log/
 * 2026-08-26-portal-reorg-and-modernization.md, Phase 3).
 *
 * `organizationType` bug fix, docs/work-log/
 * 2026-08-27-credentials-tile-org-type.md: `visiblePortalTiles()`'s
 * signature changed from `(category)` to `(category, organizationType)`,
 * REQUIRED (no default) — every existing call in this file below is updated
 * for the new signature, flagged in that work-log as expected churn. Most
 * calls below pass `"congregation"` where the org type is otherwise
 * immaterial to the assertion (no tile under test declares an
 * `orgTypeScope`); calls that touch a presbytery-scoped tile use
 * `"presbytery"` so its own scope doesn't exclude it from an otherwise-
 * unrelated assertion.
 *
 * `feedback` (docs/work-log/2026-08-27-product-ia-scaffold.md §6,
 * DECISION-117): removed from `PORTAL_TILES` entirely, mid-design operator
 * correction — it now re-surfaces as an avatar-menu item and the reused
 * daily feedback-prompt card (commit 2), never a tile. Every assertion below
 * that used to reference it is updated to its absence.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

import {
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  PORTAL_TILES,
  visiblePortalTiles,
} from "./tiles";

afterEach(() => {
  isFlagEnabled.mockReset();
});

/**
 * The `org_portal.*` keys `scripts/seed.ts`'s `seedFlags()` actually inserts
 * as of this pipeline. If a future flag rename lands there without a
 * matching update here, this is the test that catches the drift — a tile
 * pointing at a flag key nothing seeds would silently never show, for
 * every fork, forever.
 *
 * `org_portal.feedback` is DELIBERATELY NOT in this set any more — no tile
 * references it (it survives only as the avatar-menu item's and the
 * feedback-prompt card's own flag, commit 2), so asserting it here would pin
 * something untrue about this registry.
 *
 * `org_portal.admin_hub` is DELIBERATELY NOT in this set — it is not a
 * `PORTAL_TILES` flagKey, it is the hub route's own reachability gate
 * (checked directly by `admin/page.tsx` and `portal-nav.tsx`), so asserting
 * it here would pin something untrue about this registry.
 */
const KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS = new Set([
  "org_portal.home_v2",
  "org_portal.directory",
  "org_portal.roles",
  "org_portal.officers",
  "org_portal.tickets",
  "org_portal.chrome_v2",
  "org_portal.members_create",
  "org_portal.features",
  "org_portal.branding",
  "org_portal.groups",
  "org_portal.events",
  "org_portal.credentials",
  "org_portal.giving",
  "org_portal.worship",
  "org_portal.committees",
  "org_portal.oversight",
  "org_portal.reports",
  "org_portal.insights",
  "org_portal.communications",
  // docs/work-log/2026-08-27-staff-and-personnel.md, Phase 4 (api-developer
  // slice): new, seeded off.
  "org_portal.staff",
]);

describe("PORTAL_TILES — flag-key shape", () => {
  it("every tile's flagKey exists in the seed catalog", () => {
    for (const tile of PORTAL_TILES) {
      expect(KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS.has(tile.flagKey)).toBe(true);
    }
  });

  it("every tile has a non-empty key, label, description, and href builder", () => {
    for (const tile of PORTAL_TILES) {
      expect(tile.key.length).toBeGreaterThan(0);
      expect(tile.label.length).toBeGreaterThan(0);
      expect(tile.description.length).toBeGreaterThan(0);
      expect(tile.href("alder-creek")).toContain("/o/alder-creek/");
    }
  });

  it("tile keys are unique", () => {
    const keys = PORTAL_TILES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every tile's category is one of the two literal values", () => {
    for (const tile of PORTAL_TILES) {
      expect(["operate", "administer"]).toContain(tile.category);
    }
  });

  it("every tile's domain is one of the seven DOMAIN_ORDER values", () => {
    for (const tile of PORTAL_TILES) {
      expect(DOMAIN_ORDER).toContain(tile.domain);
    }
  });

  it("PORTAL_TILES has exactly 18 entries (10 existing + 7 product-IA placeholders + 1 staff)", () => {
    expect(PORTAL_TILES.length).toBe(18);
  });

  it("no tile is keyed 'feedback' — removed entirely, re-surfaces as an avatar-menu item + prompt card (commit 2)", () => {
    expect(PORTAL_TILES.map((t) => t.key)).not.toContain("feedback");
  });

  it("mirrors the full 18-tile universe by key (2026-08-27 product-IA scaffold + staff-and-personnel)", () => {
    expect(PORTAL_TILES.map((t) => t.key).sort()).toEqual(
      [
        "branding",
        "committees",
        "communications",
        "credentials",
        "directory",
        "events",
        "features",
        "giving",
        "groups",
        "insights",
        "members",
        "officers",
        "oversight",
        "reports",
        "roles",
        "staff",
        "tickets",
        "worship",
      ].sort(),
    );
  });

  it("classifies roles/features/branding/tickets as administer and directory/members/officers/groups/events/credentials as operate (operator correction 2026-08-26; groups-admin pipeline, DECISION-110 ruling 6; events-model pipeline, DECISION-113 ruling 7; presbytery-functionality Increment 2, Phase 3 Component/Page Plan)", () => {
    const byKey = Object.fromEntries(PORTAL_TILES.map((t) => [t.key, t]));
    expect(byKey.roles.category).toBe("administer");
    expect(byKey.features.category).toBe("administer");
    expect(byKey.branding.category).toBe("administer");
    expect(byKey.tickets.category).toBe("administer");
    expect(byKey.directory.category).toBe("operate");
    expect(byKey.members.category).toBe("operate");
    expect(byKey.officers.category).toBe("operate");
    expect(byKey.groups.category).toBe("operate");
    expect(byKey.events.category).toBe("operate");
    expect(byKey.credentials.category).toBe("operate");
  });

  it("the roles tile is labeled 'Roles', not 'Administration' — it now sits inside the Organization Administration hub", () => {
    const roles = PORTAL_TILES.find((t) => t.key === "roles");
    expect(roles?.label).toBe("Roles");
  });

  /**
   * Table-driven pin of every tile's `{domain, category, orgTypeScope}`
   * (docs/work-log/2026-08-27-product-ia-scaffold.md, Phase 3 §1's own
   * table). Catches an accidental re-domain/re-category/re-scope of any
   * single tile at `tsc`-adjacent speed rather than one assertion at a time.
   */
  const EXPECTED: Record<
    string,
    {
      domain: string;
      category: "operate" | "administer";
      orgTypeScope?: readonly string[];
    }
  > = {
    members: { domain: "people", category: "operate" },
    directory: { domain: "people", category: "operate" },
    groups: { domain: "people", category: "operate" },
    staff: { domain: "people", category: "operate" },
    officers: { domain: "governance", category: "operate" },
    credentials: {
      domain: "governance",
      category: "operate",
      orgTypeScope: ["presbytery"],
    },
    events: { domain: "worship", category: "operate" },
    roles: { domain: "administration", category: "administer" },
    features: { domain: "administration", category: "administer" },
    branding: { domain: "administration", category: "administer" },
    tickets: { domain: "administration", category: "administer" },
    giving: { domain: "giving", category: "operate" },
    worship: { domain: "worship", category: "operate" },
    committees: {
      domain: "governance",
      category: "operate",
      orgTypeScope: ["presbytery"],
    },
    oversight: {
      domain: "governance",
      category: "operate",
      orgTypeScope: ["presbytery"],
    },
    reports: {
      domain: "reports",
      category: "administer",
      orgTypeScope: ["presbytery"],
    },
    insights: { domain: "reports", category: "operate" },
    communications: { domain: "communications", category: "operate" },
  };

  it("pins every tile's {domain, category, orgTypeScope} against the Phase 3 design table", () => {
    for (const tile of PORTAL_TILES) {
      const expected = EXPECTED[tile.key];
      expect(expected, `no expectation recorded for tile "${tile.key}"`).toBeDefined();
      expect(tile.domain).toBe(expected.domain);
      expect(tile.category).toBe(expected.category);
      if (expected.orgTypeScope) {
        expect(tile.orgTypeScope).toEqual(expected.orgTypeScope);
      } else {
        expect(tile.orgTypeScope).toBeUndefined();
      }
    }
    // Every EXPECTED key must also be a real tile — catches a stale
    // expectation left behind after a tile is renamed or removed.
    expect(Object.keys(EXPECTED).sort()).toEqual(
      PORTAL_TILES.map((t) => t.key).sort(),
    );
  });

  it("DOMAIN_ORDER has exactly 7 unique entries matching DOMAIN_LABELS' keys", () => {
    expect(new Set(DOMAIN_ORDER).size).toBe(7);
    expect(DOMAIN_ORDER.length).toBe(7);
    expect([...DOMAIN_ORDER].sort()).toEqual(
      Object.keys(DOMAIN_LABELS).sort(),
    );
  });

  it("presbytery-only tiles (committees, oversight, reports) each declare the presbytery allow-list; credentials does too; every other tile declares none", () => {
    const presbyteryOnly = new Set([
      "credentials",
      "committees",
      "oversight",
      "reports",
    ]);
    for (const tile of PORTAL_TILES) {
      if (presbyteryOnly.has(tile.key)) {
        expect(tile.orgTypeScope).toEqual(["presbytery"]);
      } else {
        expect(tile.orgTypeScope).toBeUndefined();
      }
    }
  });
});

describe("visiblePortalTiles(category, organizationType) — category, then org-type scope, then flag", () => {
  it("returns no operate tiles when every flag is off", async () => {
    isFlagEnabled.mockResolvedValue(false);
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles).toEqual([]);
  });

  it("returns no administer tiles when every flag is off", async () => {
    isFlagEnabled.mockResolvedValue(false);
    const tiles = await visiblePortalTiles("administer", "congregation");
    expect(tiles).toEqual([]);
  });

  it("returns every operate tile when every flag is on and the org type is presbytery (so presbytery-scoped tiles' own scope doesn't exclude them), and no administer tile leaks in", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("operate", "presbytery");
    const expectedKeys = PORTAL_TILES.filter(
      (t) => t.category === "operate",
    ).map((t) => t.key);
    expect(tiles.map((t) => t.key).sort()).toEqual(expectedKeys.sort());
    for (const tile of tiles) {
      expect(tile.category).toBe("operate");
    }
  });

  it("returns every administer tile when every flag is on, and no operate tile leaks in", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("administer", "presbytery");
    const expectedKeys = PORTAL_TILES.filter(
      (t) => t.category === "administer",
    ).map((t) => t.key);
    expect(tiles.map((t) => t.key).sort()).toEqual(expectedKeys.sort());
    for (const tile of tiles) {
      expect(tile.category).toBe("administer");
    }
  });

  it("filters independently per flag — directory on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.directory",
    );
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["directory"]);
  });

  it("tickets is independent — org_portal.tickets on, everything else off (administer)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.tickets",
    );
    const tiles = await visiblePortalTiles("administer", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["tickets"]);
  });

  it("members tile is independent — members_create on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.members_create",
    );
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["members"]);
  });

  it("officers tile is independent — org_portal.officers on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.officers",
    );
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["officers"]);
  });

  it("groups tile is independent — org_portal.groups on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.groups",
    );
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["groups"]);
  });

  it("events tile is independent — org_portal.events on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.events");
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["events"]);
  });

  it("staff tile is independent — org_portal.staff on, everything else off (operate), and shows at both a congregation and a presbytery", async () => {
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.staff");
    const congregationTiles = await visiblePortalTiles("operate", "congregation");
    expect(congregationTiles.map((t) => t.key)).toEqual(["staff"]);
    const presbyteryTiles = await visiblePortalTiles("operate", "presbytery");
    expect(presbyteryTiles.map((t) => t.key)).toEqual(["staff"]);
  });

  it("credentials tile is independent — org_portal.credentials on, everything else off, at a presbytery (operate)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.credentials",
    );
    const tiles = await visiblePortalTiles("operate", "presbytery");
    expect(tiles.map((t) => t.key)).toEqual(["credentials"]);
  });

  it("features tile is independent — org_portal.features on, everything else off (administer)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.features",
    );
    const tiles = await visiblePortalTiles("administer", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["features"]);
  });

  it("branding tile is independent — org_portal.branding on, everything else off (administer)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.branding",
    );
    const tiles = await visiblePortalTiles("administer", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["branding"]);
  });

  it("giving tile is independent — org_portal.giving on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.giving");
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["giving"]);
  });

  it("worship tile is independent — org_portal.worship on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.worship",
    );
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["worship"]);
  });

  it("insights tile is independent — org_portal.insights on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.insights",
    );
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["insights"]);
  });

  it("communications tile is independent — org_portal.communications on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.communications",
    );
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["communications"]);
  });

  it("reports tile is independent — org_portal.reports on, everything else off, at a presbytery (administer)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.reports",
    );
    const tiles = await visiblePortalTiles("administer", "presbytery");
    expect(tiles.map((t) => t.key)).toEqual(["reports"]);
  });

  it("preserves PORTAL_TILES declaration order among the visible operate subset", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("operate", "presbytery");
    expect(tiles.map((t) => t.key)).toEqual(
      PORTAL_TILES.filter((t) => t.category === "operate").map((t) => t.key),
    );
  });

  it("preserves PORTAL_TILES declaration order among the visible administer subset", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("administer", "presbytery");
    expect(tiles.map((t) => t.key)).toEqual(
      PORTAL_TILES.filter((t) => t.category === "administer").map(
        (t) => t.key,
      ),
    );
  });

  it("category is routing-only: it never gates on isFlagEnabled with a permission-shaped key", async () => {
    // Every isFlagEnabled call this module makes is one of the tile
    // flagKeys — asserting the exact call set proves visiblePortalTiles()
    // consults nothing else (no permission resolver, no second gate).
    isFlagEnabled.mockResolvedValue(true);
    await visiblePortalTiles("administer", "presbytery");
    const administerFlagKeys = PORTAL_TILES.filter(
      (t) => t.category === "administer",
    ).map((t) => t.flagKey);
    const calledKeys = isFlagEnabled.mock.calls.map((call) => call[0]);
    expect(new Set(calledKeys)).toEqual(new Set(administerFlagKeys));
  });

  describe("orgTypeScope — bug fix, docs/work-log/2026-08-27-credentials-tile-org-type.md", () => {
    it("a congregation does NOT get the credentials tile even with its flag on — the regression this fix closes", async () => {
      isFlagEnabled.mockResolvedValue(true);
      const tiles = await visiblePortalTiles("operate", "congregation");
      expect(tiles.map((t) => t.key)).not.toContain("credentials");
    });

    it("a presbytery DOES get the credentials tile with its flag on", async () => {
      isFlagEnabled.mockResolvedValue(true);
      const tiles = await visiblePortalTiles("operate", "presbytery");
      expect(tiles.map((t) => t.key)).toContain("credentials");
    });

    it("a tile without an orgTypeScope is unaffected by organization type — directory shows for both a congregation and a synod", async () => {
      isFlagEnabled.mockImplementation(async (key: string) =>
        key === "org_portal.directory",
      );
      const congregationTiles = await visiblePortalTiles(
        "operate",
        "congregation",
      );
      const synodTiles = await visiblePortalTiles("operate", "synod");
      expect(congregationTiles.map((t) => t.key)).toEqual(["directory"]);
      expect(synodTiles.map((t) => t.key)).toEqual(["directory"]);
    });

    it("neither synod nor general_assembly get the credentials tile — proves the allow-list, not a `!== \"congregation\"` exclusion", async () => {
      isFlagEnabled.mockResolvedValue(true);
      const synodTiles = await visiblePortalTiles("operate", "synod");
      const gaTiles = await visiblePortalTiles(
        "operate",
        "general_assembly",
      );
      expect(synodTiles.map((t) => t.key)).not.toContain("credentials");
      expect(gaTiles.map((t) => t.key)).not.toContain("credentials");
    });

    it("isFlagEnabled is never called for a tile excluded by orgTypeScope — the org-type filter runs before the flag check", async () => {
      isFlagEnabled.mockResolvedValue(true);
      await visiblePortalTiles("operate", "congregation");
      const calledKeys = isFlagEnabled.mock.calls.map((call) => call[0]);
      expect(calledKeys).not.toContain("org_portal.credentials");
      expect(calledKeys).not.toContain("org_portal.committees");
      expect(calledKeys).not.toContain("org_portal.oversight");
    });
  });

  describe("committees/oversight/reports — presbytery-only placeholder tiles (product-IA scaffold)", () => {
    it("a congregation does NOT get committees, oversight, or reports even with every flag on", async () => {
      isFlagEnabled.mockResolvedValue(true);
      const operateTiles = await visiblePortalTiles("operate", "congregation");
      const administerTiles = await visiblePortalTiles(
        "administer",
        "congregation",
      );
      const keys = [...operateTiles, ...administerTiles].map((t) => t.key);
      expect(keys).not.toContain("committees");
      expect(keys).not.toContain("oversight");
      expect(keys).not.toContain("reports");
    });

    it("a presbytery DOES get committees, oversight, and reports with every flag on", async () => {
      isFlagEnabled.mockResolvedValue(true);
      const operateTiles = await visiblePortalTiles("operate", "presbytery");
      const administerTiles = await visiblePortalTiles(
        "administer",
        "presbytery",
      );
      expect(operateTiles.map((t) => t.key)).toEqual(
        expect.arrayContaining(["committees", "oversight"]),
      );
      expect(administerTiles.map((t) => t.key)).toContain("reports");
    });
  });
});
