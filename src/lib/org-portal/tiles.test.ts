/**
 * Unit tests for the portal-home tile registry.
 *
 * Three properties pinned: every tile's `flagKey` is a real row `scripts/
 * seed.ts` seeds (a hard-coded snapshot below — this module cannot import
 * `scripts/seed.ts` itself, which opens a real DB connection at import
 * time); every tile's `category` is one of the two literal values (guards a
 * future tile shipping with neither filter matching it — a silent third
 * state); and `visiblePortalTiles(category)` filters by category, then by
 * flag, independent of any permission (portal-reorg pipeline, docs/work-log/
 * 2026-08-26-portal-reorg-and-modernization.md, Phase 3).
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

  it("mirrors OrgPortalStub's four links plus the members-management, officers, features, branding, and groups tiles (2026-08-26)", () => {
    expect(PORTAL_TILES.map((t) => t.key).sort()).toEqual(
      [
        "branding",
        "directory",
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

  it("classifies roles/features/branding/tickets as administer and directory/members/officers/feedback/groups as operate (operator correction 2026-08-26; groups-admin pipeline, DECISION-110 ruling 6)", () => {
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
  });

  it("the roles tile is labeled 'Roles', not 'Administration' — it now sits inside the Organization Administration hub", () => {
    const roles = PORTAL_TILES.find((t) => t.key === "roles");
    expect(roles?.label).toBe("Roles");
  });
});

describe("visiblePortalTiles(category) — category, then flag-only filtering", () => {
  it("returns no operate tiles when every flag is off", async () => {
    isFlagEnabled.mockResolvedValue(false);
    const tiles = await visiblePortalTiles("operate");
    expect(tiles).toEqual([]);
  });

  it("returns no administer tiles when every flag is off", async () => {
    isFlagEnabled.mockResolvedValue(false);
    const tiles = await visiblePortalTiles("administer");
    expect(tiles).toEqual([]);
  });

  it("returns every operate tile when every flag is on, and no administer tile leaks in", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("operate");
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
    const tiles = await visiblePortalTiles("administer");
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
    const tiles = await visiblePortalTiles("operate");
    expect(tiles.map((t) => t.key)).toEqual(["directory"]);
  });

  it("tickets is independent — org_portal.tickets on, everything else off (administer)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.tickets",
    );
    const tiles = await visiblePortalTiles("administer");
    expect(tiles.map((t) => t.key)).toEqual(["tickets"]);
  });

  it("tickets and feedback are independent — feedback on, tickets off shows only feedback", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.feedback",
    );
    const tiles = await visiblePortalTiles("operate");
    expect(tiles.map((t) => t.key)).toEqual(["feedback"]);
  });

  it("members tile is independent — members_create on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.members_create",
    );
    const tiles = await visiblePortalTiles("operate");
    expect(tiles.map((t) => t.key)).toEqual(["members"]);
  });

  it("officers tile is independent — org_portal.officers on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.officers",
    );
    const tiles = await visiblePortalTiles("operate");
    expect(tiles.map((t) => t.key)).toEqual(["officers"]);
  });

  it("groups tile is independent — org_portal.groups on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.groups",
    );
    const tiles = await visiblePortalTiles("operate");
    expect(tiles.map((t) => t.key)).toEqual(["groups"]);
  });

  it("features tile is independent — org_portal.features on, everything else off (administer)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.features",
    );
    const tiles = await visiblePortalTiles("administer");
    expect(tiles.map((t) => t.key)).toEqual(["features"]);
  });

  it("branding tile is independent — org_portal.branding on, everything else off (administer)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.branding",
    );
    const tiles = await visiblePortalTiles("administer");
    expect(tiles.map((t) => t.key)).toEqual(["branding"]);
  });

  it("preserves PORTAL_TILES declaration order among the visible operate subset", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("operate");
    expect(tiles.map((t) => t.key)).toEqual(
      PORTAL_TILES.filter((t) => t.category === "operate").map((t) => t.key),
    );
  });

  it("preserves PORTAL_TILES declaration order among the visible administer subset", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("administer");
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
    await visiblePortalTiles("administer");
    const administerFlagKeys = PORTAL_TILES.filter(
      (t) => t.category === "administer",
    ).map((t) => t.flagKey);
    const calledKeys = isFlagEnabled.mock.calls.map((call) => call[0]);
    expect(new Set(calledKeys)).toEqual(new Set(administerFlagKeys));
  });
});
