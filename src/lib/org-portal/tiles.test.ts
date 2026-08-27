/**
 * Unit tests for the portal-home tile registry.
 *
 * Properties pinned: every tile's `flagKey` is a real row `scripts/seed.ts`
 * seeds (a hard-coded snapshot below — this module cannot import `scripts/
 * seed.ts` itself, which opens a real DB connection at import time); every
 * tile's `category` is one of the two literal values (guards a future tile
 * shipping with neither filter matching it — a silent third state); and
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
 * `orgTypeScope`); calls that touch the `credentials` tile use
 * `"presbytery"` so its own scope doesn't exclude it from an
 * otherwise-unrelated assertion.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

import { PORTAL_TILES, visiblePortalTiles } from "./tiles";

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
  "org_portal.feedback",
  "org_portal.chrome_v2",
  "org_portal.members_create",
  "org_portal.features",
  "org_portal.branding",
  "org_portal.groups",
  "org_portal.events",
  "org_portal.credentials",
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

  it("mirrors OrgPortalStub's four links plus the members-management, officers, features, branding, groups, events, and credentials tiles (2026-08-26)", () => {
    expect(PORTAL_TILES.map((t) => t.key).sort()).toEqual(
      [
        "branding",
        "credentials",
        "directory",
        "events",
        "feedback",
        "features",
        "groups",
        "members",
        "officers",
        "roles",
        "tickets",
      ].sort(),
    );
  });

  it("classifies roles/features/branding/tickets as administer and directory/members/officers/feedback/groups/events/credentials as operate (operator correction 2026-08-26; groups-admin pipeline, DECISION-110 ruling 6; events-model pipeline, DECISION-113 ruling 7; presbytery-functionality Increment 2, Phase 3 Component/Page Plan)", () => {
    const byKey = Object.fromEntries(PORTAL_TILES.map((t) => [t.key, t]));
    expect(byKey.roles.category).toBe("administer");
    expect(byKey.features.category).toBe("administer");
    expect(byKey.branding.category).toBe("administer");
    expect(byKey.tickets.category).toBe("administer");
    expect(byKey.directory.category).toBe("operate");
    expect(byKey.members.category).toBe("operate");
    expect(byKey.officers.category).toBe("operate");
    expect(byKey.feedback.category).toBe("operate");
    expect(byKey.groups.category).toBe("operate");
    expect(byKey.events.category).toBe("operate");
    expect(byKey.credentials.category).toBe("operate");
  });

  it("the roles tile is labeled 'Roles', not 'Administration' — it now sits inside the Organization Administration hub", () => {
    const roles = PORTAL_TILES.find((t) => t.key === "roles");
    expect(roles?.label).toBe("Roles");
  });

  it("only the credentials tile declares an orgTypeScope, and it is the presbytery allow-list", () => {
    for (const tile of PORTAL_TILES) {
      if (tile.key === "credentials") {
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

  it("returns every operate tile when every flag is on and the org type is presbytery (so credentials' own scope doesn't exclude it), and no administer tile leaks in", async () => {
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
    const tiles = await visiblePortalTiles("administer", "congregation");
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

  it("tickets and feedback are independent — feedback on, tickets off shows only feedback", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.feedback",
    );
    const tiles = await visiblePortalTiles("operate", "congregation");
    expect(tiles.map((t) => t.key)).toEqual(["feedback"]);
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

  it("preserves PORTAL_TILES declaration order among the visible operate subset", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("operate", "presbytery");
    expect(tiles.map((t) => t.key)).toEqual(
      PORTAL_TILES.filter((t) => t.category === "operate").map((t) => t.key),
    );
  });

  it("preserves PORTAL_TILES declaration order among the visible administer subset", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("administer", "congregation");
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
    await visiblePortalTiles("administer", "congregation");
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
    });
  });
});
