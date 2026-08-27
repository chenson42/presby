/**
 * Unit tests for `visibleAdminTiles()` — commit 1 of docs/work-log/
 * 2026-08-27-platform-home-and-portal.md (Phase 3 Tests, DECISION-123).
 * Pins the acceptance criterion this whole pipeline is built around: a
 * `support_operator`-shaped session sees exactly its two tiles, a
 * full-admin-shaped session sees all ten, and an `ADMIN_DASHBOARD`-only
 * session (admitted to `/admin` by the Edge, matching zero tiles) sees an
 * honest empty result rather than crashing or over-showing.
 */
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/permissions";
import { visibleAdminTiles } from "./visible-tiles";

describe("visibleAdminTiles()", () => {
  it("a support_operator-shaped features array returns exactly 2 tiles: Feedback and Tickets", () => {
    const tiles = visibleAdminTiles([
      FEATURES.ADMIN_DASHBOARD,
      FEATURES.ADMIN_TICKETS,
      FEATURES.ADMIN_FEEDBACK,
    ]);

    expect(tiles.map((t) => t.key).sort()).toEqual(["feedback", "tickets"]);
  });

  it("a full-admin-shaped features array (every FEATURES.* value) returns all 10 tiles", () => {
    const tiles = visibleAdminTiles(Object.values(FEATURES));
    expect(tiles).toHaveLength(10);
  });

  it("an ADMIN_DASHBOARD-only features array returns 0 tiles — the reachable empty-state case", () => {
    const tiles = visibleAdminTiles([FEATURES.ADMIN_DASHBOARD]);
    expect(tiles).toHaveLength(0);
  });

  it("returns an empty array for an undefined features array, not a throw", () => {
    expect(visibleAdminTiles(undefined)).toEqual([]);
  });

  it("returns an empty array for an empty features array", () => {
    expect(visibleAdminTiles([])).toEqual([]);
  });

  it("does not include a tile whose feature isn't held, even if adjacent features are", () => {
    const tiles = visibleAdminTiles([FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_USERS]);
    expect(tiles.map((t) => t.key)).toEqual(["users"]);
  });
});
