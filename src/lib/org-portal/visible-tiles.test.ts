/**
 * Unit tests for `visiblePortalTiles` (moved out of `tiles.test.ts` with the
 * function itself — member-calendar R1/F135, docs/work-log/
 * 2026-10-14-member-calendar.md). The flag read and the org-toggle read are
 * mocked; the registry (`PORTAL_TILES`) is the real one.
 *
 * Every pre-existing case is carried over unchanged except for the new
 * required third argument. The per-org toggle default in this file is OFF
 * (`isOrgFeatureEnabled` resolves false), so the legacy flag-only cases still
 * read as "everything else off"; the cases that mean "everything on" turn the
 * toggle on too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const isOrgFeatureEnabled = vi.fn();
// A hoisted, mutable stand-in for the catalog so a case can give a calendar-
// shaped entry a non-null platform `flag` without touching the real catalog.
const { catalog } = vi.hoisted(() => ({
  catalog: [] as Array<{ key: string; flag: string | null }>,
}));
vi.mock("@/lib/org-features", () => ({
  ORG_FEATURE_CATALOG: catalog,
  isOrgFeatureEnabled: (...args: unknown[]) => isOrgFeatureEnabled(...args),
}));

import { PORTAL_TILES } from "./tiles";
import { visiblePortalTiles } from "./visible-tiles";

const VIEWER = { personId: "person-1", organizationId: "org-1" };

beforeEach(() => {
  isFlagEnabled.mockReset();
  isOrgFeatureEnabled.mockReset().mockResolvedValue(false);
  catalog.length = 0;
  catalog.push({ key: "org_portal.calendar", flag: null });
});

describe("visiblePortalTiles(category, organizationType, viewer) — category, then org-type scope, then flag(s), then org toggle", () => {
  it("returns no operate tiles when every flag is off", async () => {
    isFlagEnabled.mockResolvedValue(false);
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles).toEqual([]);
  });

  it("returns no administer tiles when every flag is off", async () => {
    isFlagEnabled.mockResolvedValue(false);
    const tiles = await visiblePortalTiles("administer", "congregation", VIEWER);
    expect(tiles).toEqual([]);
  });

  it("returns every operate tile when every flag is on and the org type is presbytery (so presbytery-scoped tiles' own scope doesn't exclude them), and no administer tile leaks in", async () => {
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("operate", "presbytery", VIEWER);
    const expectedKeys = PORTAL_TILES.filter(
      (t) => t.category === "operate",
    ).map((t) => t.key);
    expect(tiles.map((t) => t.key).sort()).toEqual(expectedKeys.sort());
    for (const tile of tiles) {
      expect(tile.category).toBe("operate");
    }
  });

  it("returns every administer tile IN SCOPE FOR PRESBYTERY when every flag is on, and no operate tile leaks in — filings (congregation-only, DECISION-152) is correctly excluded here, not a bug", async () => {
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("administer", "presbytery", VIEWER);
    const expectedKeys = PORTAL_TILES.filter(
      (t) =>
        t.category === "administer" &&
        (!t.orgTypeScope || t.orgTypeScope.includes("presbytery")),
    ).map((t) => t.key);
    expect(tiles.map((t) => t.key).sort()).toEqual(expectedKeys.sort());
    expect(tiles.map((t) => t.key)).not.toContain("filings");
    for (const tile of tiles) {
      expect(tile.category).toBe("administer");
    }
  });

  it("returns every administer tile IN SCOPE FOR CONGREGATION when every flag is on, including filings — reports (presbytery-only) is correctly excluded here", async () => {
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("administer", "congregation", VIEWER);
    const expectedKeys = PORTAL_TILES.filter(
      (t) =>
        t.category === "administer" &&
        (!t.orgTypeScope || t.orgTypeScope.includes("congregation")),
    ).map((t) => t.key);
    expect(tiles.map((t) => t.key).sort()).toEqual(expectedKeys.sort());
    expect(tiles.map((t) => t.key)).toContain("filings");
    expect(tiles.map((t) => t.key)).not.toContain("reports");
    for (const tile of tiles) {
      expect(tile.category).toBe("administer");
    }
  });

  it("filters independently per flag — directory on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.directory",
    );
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["directory"]);
  });

  it("tickets is independent — org_portal.tickets on, everything else off (administer)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.tickets",
    );
    const tiles = await visiblePortalTiles("administer", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["tickets"]);
  });

  it("members tile is independent — members_create on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.members_create",
    );
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["members"]);
  });

  it("officers tile is independent — org_portal.officers on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.officers",
    );
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["officers"]);
  });

  it("groups tile is independent — org_portal.groups on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.groups",
    );
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["groups"]);
  });

  it("events tile is independent — org_portal.events on, everything else off (administer, not operate: member-calendar R6)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.events");
    const administer = await visiblePortalTiles("administer", "congregation", VIEWER);
    expect(administer.map((t) => t.key)).toEqual(["events"]);
    const operate = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(operate.map((t) => t.key)).not.toContain("events");
  });

  it("staff tile is independent — org_portal.staff on, everything else off (operate), and shows at both a congregation and a presbytery", async () => {
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.staff");
    const congregationTiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(congregationTiles.map((t) => t.key)).toEqual(["staff"]);
    const presbyteryTiles = await visiblePortalTiles("operate", "presbytery", VIEWER);
    expect(presbyteryTiles.map((t) => t.key)).toEqual(["staff"]);
  });

  it("credentials tile is independent — org_portal.credentials on, everything else off, at a presbytery (operate)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.credentials",
    );
    const tiles = await visiblePortalTiles("operate", "presbytery", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["credentials"]);
  });

  it("features tile is independent — org_portal.features on, everything else off (administer)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.features",
    );
    const tiles = await visiblePortalTiles("administer", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["features"]);
  });

  it("branding tile is independent — org_portal.branding on, everything else off (administer)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) =>
      key === "org_portal.branding",
    );
    const tiles = await visiblePortalTiles("administer", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["branding"]);
  });

  it("giving tile is independent — org_portal.giving on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(async (key: string) => key === "org_portal.giving");
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["giving"]);
  });

  it("worship tile is independent — org_portal.worship on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.worship",
    );
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["worship"]);
  });

  it("insights tile is independent — org_portal.insights on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.insights",
    );
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["insights"]);
  });

  it("communications tile is independent — org_portal.communications on, everything else off (operate)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.communications",
    );
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["communications"]);
  });

  it("reports tile is independent — org_portal.reports on, everything else off, at a presbytery (administer)", async () => {
    isFlagEnabled.mockImplementation(
      async (key: string) => key === "org_portal.reports",
    );
    const tiles = await visiblePortalTiles("administer", "presbytery", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["reports"]);
  });

  it("preserves PORTAL_TILES declaration order among the visible operate subset", async () => {
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("operate", "presbytery", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(
      PORTAL_TILES.filter((t) => t.category === "operate").map((t) => t.key),
    );
  });

  it("preserves PORTAL_TILES declaration order among the visible administer subset", async () => {
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("administer", "presbytery", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(
      PORTAL_TILES.filter(
        (t) =>
          t.category === "administer" &&
          (!t.orgTypeScope || t.orgTypeScope.includes("presbytery")),
      ).map((t) => t.key),
    );
  });

  it("category is routing-only: it never gates on isFlagEnabled with a permission-shaped key", async () => {
    // Every isFlagEnabled call this module makes is one of the tile
    // flagKeys — asserting the exact call set proves visiblePortalTiles()
    // consults nothing else (no permission resolver, no second gate).
    // filings is congregation-only (DECISION-152), so at organizationType
    // "presbytery" it is filtered out BEFORE isFlagEnabled is ever called —
    // excluded from the expected set here for that reason, not overlooked.
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    await visiblePortalTiles("administer", "presbytery", VIEWER);
    const administerFlagKeys = PORTAL_TILES.filter(
      (t) =>
        t.category === "administer" &&
        (!t.orgTypeScope || t.orgTypeScope.includes("presbytery")),
    ).map((t) => t.flagKey);
    const calledKeys = isFlagEnabled.mock.calls.map((call) => call[0]);
    expect(new Set(calledKeys)).toEqual(new Set(administerFlagKeys));
    expect(calledKeys).not.toContain("org_portal.filings");
  });

  describe("orgTypeScope — bug fix, docs/work-log/2026-08-27-credentials-tile-org-type.md", () => {
    it("a congregation does NOT get the credentials tile even with its flag on — the regression this fix closes", async () => {
      isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
      const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
      expect(tiles.map((t) => t.key)).not.toContain("credentials");
    });

    it("a presbytery DOES get the credentials tile with its flag on", async () => {
      isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
      const tiles = await visiblePortalTiles("operate", "presbytery", VIEWER);
      expect(tiles.map((t) => t.key)).toContain("credentials");
    });

    it("a tile without an orgTypeScope is unaffected by organization type — directory shows for both a congregation and a synod", async () => {
      isFlagEnabled.mockImplementation(async (key: string) =>
        key === "org_portal.directory",
      );
      const congregationTiles = await visiblePortalTiles("operate", "congregation", VIEWER);
      const synodTiles = await visiblePortalTiles("operate", "synod", VIEWER);
      expect(congregationTiles.map((t) => t.key)).toEqual(["directory"]);
      expect(synodTiles.map((t) => t.key)).toEqual(["directory"]);
    });

    it("neither synod nor general_assembly get the credentials tile — proves the allow-list, not a `!== \"congregation\"` exclusion", async () => {
      isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
      const synodTiles = await visiblePortalTiles("operate", "synod", VIEWER);
      const gaTiles = await visiblePortalTiles("operate", "general_assembly", VIEWER);
      expect(synodTiles.map((t) => t.key)).not.toContain("credentials");
      expect(gaTiles.map((t) => t.key)).not.toContain("credentials");
    });

    it("isFlagEnabled is never called for a tile excluded by orgTypeScope — the org-type filter runs before the flag check", async () => {
      isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
      await visiblePortalTiles("operate", "congregation", VIEWER);
      const calledKeys = isFlagEnabled.mock.calls.map((call) => call[0]);
      expect(calledKeys).not.toContain("org_portal.credentials");
      expect(calledKeys).not.toContain("org_portal.committees");
      expect(calledKeys).not.toContain("org_portal.oversight");
    });
  });

  describe("committees/oversight/reports — presbytery-only placeholder tiles (product-IA scaffold)", () => {
    it("a congregation does NOT get committees, oversight, or reports even with every flag on", async () => {
      isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
      const operateTiles = await visiblePortalTiles("operate", "congregation", VIEWER);
      const administerTiles = await visiblePortalTiles("administer", "congregation", VIEWER);
      const keys = [...operateTiles, ...administerTiles].map((t) => t.key);
      expect(keys).not.toContain("committees");
      expect(keys).not.toContain("oversight");
      expect(keys).not.toContain("reports");
    });

    it("a presbytery DOES get committees, oversight, and reports with every flag on", async () => {
      isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
      const operateTiles = await visiblePortalTiles("operate", "presbytery", VIEWER);
      const administerTiles = await visiblePortalTiles("administer", "presbytery", VIEWER);
      expect(operateTiles.map((t) => t.key)).toEqual(
        expect.arrayContaining(["committees", "oversight"]),
      );
      expect(administerTiles.map((t) => t.key)).toContain("reports");
    });
  });
});

describe("visiblePortalTiles — the per-org toggle gate (member-calendar R1, F135)", () => {
  it("shows the calendar tile when the org toggle is on and no platform flag is on", async () => {
    isFlagEnabled.mockResolvedValue(false);
    isOrgFeatureEnabled.mockResolvedValue(true);
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).toEqual(["calendar"]);
    expect(isOrgFeatureEnabled).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "org_portal.calendar",
    );
  });

  it("hides the calendar tile when the org toggle is off, even with every platform flag on", async () => {
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(false);
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).not.toContain("calendar");
  });

  it("HIDES the tile and does not throw when the toggle read rejects — logging the two ids only, never the message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      isFlagEnabled.mockResolvedValue(true);
      isOrgFeatureEnabled.mockRejectedValue(
        new Error("SECRET-DRIVER-MESSAGE select * from organization_feature_toggles"),
      );
      const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
      expect(tiles.map((t) => t.key)).not.toContain("calendar");
      // The flag-only tiles still render — one tile's failure never takes the rest down.
      expect(tiles.map((t) => t.key)).toContain("directory");

      expect(consoleError).toHaveBeenCalled();
      const logged = consoleError.mock.calls.flat().map(String).join(" ");
      expect(logged).toContain("org-1");
      expect(logged).toContain("person-1");
      expect(logged).not.toContain("SECRET-DRIVER-MESSAGE");
      expect(logged).not.toContain("organization_feature_toggles");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("treats an OrgAccessError-shaped rejection the same way (hidden, no throw)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      isFlagEnabled.mockResolvedValue(true);
      class OrgAccessError extends Error {}
      isOrgFeatureEnabled.mockRejectedValue(new OrgAccessError("no membership"));
      await expect(
        visiblePortalTiles("operate", "congregation", VIEWER),
      ).resolves.toBeDefined();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("never reads the toggle for a tile an earlier filter excluded (category, org-type scope)", async () => {
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    // calendar is `operate`: an `administer` call must never consult its toggle.
    await visiblePortalTiles("administer", "congregation", VIEWER);
    expect(isOrgFeatureEnabled).not.toHaveBeenCalled();
    // ...and an operate call does, exactly once, for the one toggle-gated tile.
    await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(isOrgFeatureEnabled).toHaveBeenCalledTimes(1);
  });

  it("reads the catalog entry's own platform flag when it is non-null, BEFORE the toggle", async () => {
    // Not true of the calendar today (flag: null); proves the rule for the
    // day a toggle-gated tile is also kill-switchable.
    catalog.length = 0;
    catalog.push({ key: "org_portal.calendar", flag: "org_portal.calendar_kill" });
    isOrgFeatureEnabled.mockResolvedValue(true);

    isFlagEnabled.mockImplementation(
      async (key: string) => key !== "org_portal.calendar_kill",
    );
    const tiles = await visiblePortalTiles("operate", "congregation", VIEWER);
    expect(tiles.map((t) => t.key)).not.toContain("calendar");
    expect(isOrgFeatureEnabled).not.toHaveBeenCalled();
  });

  it("with every platform flag off, only the toggle-only tile reads a toggle (flag-gated tiles are excluded before any toggle read)", async () => {
    isFlagEnabled.mockResolvedValue(false);
    await visiblePortalTiles("operate", "congregation", VIEWER);
    await visiblePortalTiles("administer", "congregation", VIEWER);
    // calendar has no flagKey, so its toggle IS read on the operate call —
    // that is the only read.
    expect(isOrgFeatureEnabled).toHaveBeenCalledTimes(1);
  });

  it("puts 'events' in administer and 'calendar' in operate, in PORTAL_TILES declaration order", async () => {
    isFlagEnabled.mockResolvedValue(true);
    isOrgFeatureEnabled.mockResolvedValue(true);
    const operate = (await visiblePortalTiles("operate", "congregation", VIEWER)).map((t) => t.key);
    const administer = (await visiblePortalTiles("administer", "congregation", VIEWER)).map((t) => t.key);
    expect(operate).toContain("calendar");
    expect(operate).not.toContain("events");
    expect(administer).toContain("events");
    expect(administer).not.toContain("calendar");
    expect(operate).toEqual(
      PORTAL_TILES.filter(
        (t) =>
          t.category === "operate" &&
          (!t.orgTypeScope || t.orgTypeScope.includes("congregation")),
      ).map((t) => t.key),
    );
  });
});
