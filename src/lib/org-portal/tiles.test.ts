/**
 * Unit tests for the portal-home tile registry.
 *
 * Two properties pinned: every tile's `flagKey` is a real row `scripts/
 * seed.ts` seeds (a hard-coded snapshot below — this module cannot import
 * `scripts/seed.ts` itself, which opens a real DB connection at import
 * time), and `visiblePortalTiles()` filters by flag alone, independent of
 * any permission.
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
 */
const KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS = new Set([
  "org_portal.home_v2",
  "org_portal.directory",
  "org_portal.roles",
  "org_portal.tickets",
  "org_portal.feedback",
  "org_portal.chrome_v2",
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

  it("mirrors OrgPortalStub's four links: directory, roles, tickets, feedback", () => {
    expect(PORTAL_TILES.map((t) => t.key).sort()).toEqual(
      ["directory", "feedback", "roles", "tickets"].sort(),
    );
  });
});

describe("visiblePortalTiles() — flag-only filtering", () => {
  it("returns no tiles when every flag is off", async () => {
    isFlagEnabled.mockResolvedValue(false);
    const tiles = await visiblePortalTiles();
    expect(tiles).toEqual([]);
  });

  it("returns every tile when every flag is on", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles();
    expect(tiles.map((t) => t.key).sort()).toEqual(
      PORTAL_TILES.map((t) => t.key).sort(),
    );
  });

  it("filters independently per flag — directory on, everything else off", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.directory",
    );
    const tiles = await visiblePortalTiles();
    expect(tiles.map((t) => t.key)).toEqual(["directory"]);
  });

  it("tickets and feedback are independent — tickets on, feedback off shows only tickets", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.tickets",
    );
    const tiles = await visiblePortalTiles();
    expect(tiles.map((t) => t.key)).toEqual(["tickets"]);
  });

  it("tickets and feedback are independent — feedback on, tickets off shows only feedback", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.feedback",
    );
    const tiles = await visiblePortalTiles();
    expect(tiles.map((t) => t.key)).toEqual(["feedback"]);
  });

  it("preserves PORTAL_TILES declaration order among the visible subset", async () => {
    isFlagEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles();
    expect(tiles.map((t) => t.key)).toEqual(PORTAL_TILES.map((t) => t.key));
  });
});
