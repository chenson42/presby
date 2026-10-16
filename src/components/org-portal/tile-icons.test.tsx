/**
 * The org-portal tile-key -> icon map. Before this file nothing pinned it: an
 * unmapped key silently falls back to `LayoutGrid` in <TileGrid>. Online giving
 * adds a second giving tile (the treasurer's "Manage giving"), which must be
 * distinguishable from the member's "Giving" tile.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PORTAL_TILES } from "@/lib/org-portal/tiles";
import { TILE_ICONS } from "./tile-icons";

describe("TILE_ICONS", () => {
  it("maps both giving tiles (an unmapped key falls back to a generic glyph). NOT asserted for every tile: staff, credentials and filings were already unmapped before this pipeline (observed 2026-10-15, left alone as out of scope)", () => {
    for (const key of ["giving", "giving-admin"]) {
      expect(PORTAL_TILES.some((t) => t.key === key), key).toBe(true);
      expect(TILE_ICONS[key], key).toBeDefined();
    }
  });

  it("gives the member Giving tile and the admin Manage-giving tile different icons", () => {
    expect(TILE_ICONS.giving).toBeDefined();
    expect(TILE_ICONS["giving-admin"]).toBeDefined();
    expect(TILE_ICONS["giving-admin"]).not.toBe(TILE_ICONS.giving);
  });

  it("has no icon for a tile that no longer exists", () => {
    const keys = new Set(PORTAL_TILES.map((t) => t.key));
    const orphans = Object.keys(TILE_ICONS).filter((key) => !keys.has(key));
    expect(orphans).toEqual([]);
  });
});
