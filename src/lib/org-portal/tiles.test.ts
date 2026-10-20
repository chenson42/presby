/**
 * Unit tests for the portal-home tile registry (data and types only).
 *
 * MEMBER-CALENDAR (docs/work-log/2026-10-14-member-calendar.md, R1/R6/F135):
 * `visiblePortalTiles` moved to `./visible-tiles.ts` and its tests moved to
 * `./visible-tiles.test.ts`. This file no longer mocks `@/lib/flags` — it
 * does not need to, and that is the point: importing `tiles.ts` must not
 * pull in the resolver chain (F135).
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
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DOMAIN_LABELS, DOMAIN_ORDER, PORTAL_TILES } from "./tiles";

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
  "org_portal.worship",
  "org_portal.committees",
  "org_portal.oversight",
  "org_portal.reports",
  // DECISION-152, docs/work-log/2026-09-26-withdraw-publication.md: new,
  // seeded off — the congregation's own withdraw-a-filing surface.
  "org_portal.filings",
  "org_portal.insights",
  "org_portal.communications",
  // docs/work-log/2026-08-27-staff-and-personnel.md, Phase 4 (api-developer
  // slice): new, seeded off.
  "org_portal.staff",
]);

describe("PORTAL_TILES — flag-key shape", () => {
  it("every tile has a gate — a flagKey, an orgFeatureKey, or both", () => {
    for (const tile of PORTAL_TILES) {
      expect(
        tile.flagKey !== undefined || tile.orgFeatureKey !== undefined,
        `tile "${tile.key}" has neither gate`,
      ).toBe(true);
    }
  });

  it("every flagKey a tile declares exists in the seed catalog", () => {
    for (const tile of PORTAL_TILES) {
      if (tile.flagKey === undefined) continue;
      expect(
        KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS.has(tile.flagKey),
        `${tile.key} -> ${tile.flagKey}`,
      ).toBe(true);
    }
  });

  // "Every orgFeatureKey is an ORG_FEATURE_CATALOG key" lives in
  // `src/lib/org-feature-catalog.test.ts`, where the resolver chain is already
  // mocked: this file deliberately imports nothing from `org-features` (F135),
  // so a runtime import creeping back into `tiles.ts` fails here at load.

  it("the two giving tiles are toggle-only (no flagKey, no comingSoon) and gated by the org_portal.giving org toggle — R11: giving has no platform flag", () => {
    for (const key of ["giving", "giving-admin"]) {
      const tile = PORTAL_TILES.find((t) => t.key === key);
      expect(tile, key).toBeDefined();
      expect(tile?.orgFeatureKey, key).toBe("org_portal.giving");
      expect(tile?.flagKey, key).toBeUndefined();
      expect(tile?.comingSoon, key).toBeUndefined();
    }
    const byKey = Object.fromEntries(PORTAL_TILES.map((t) => [t.key, t]));
    expect(byKey.giving.href("alder-creek")).toBe("/o/alder-creek/giving");
    expect(byKey["giving-admin"].href("alder-creek")).toBe(
      "/o/alder-creek/admin/giving",
    );
    expect(byKey.giving.category).toBe("operate");
    expect(byKey["giving-admin"].category).toBe("administer");
  });

  it("the domains tile is toggle-only (no flagKey, no comingSoon), gated by the operator-enabled org_portal.domains toggle, administer under Communications, for every org type (custom-domains, G32)", () => {
    const tile = PORTAL_TILES.find((t) => t.key === "domains");
    expect(tile).toBeDefined();
    expect(tile?.orgFeatureKey).toBe("org_portal.domains");
    expect(tile?.flagKey).toBeUndefined();
    expect(tile?.comingSoon).toBeUndefined();
    expect(tile?.orgTypeScope).toBeUndefined();
    expect(tile?.category).toBe("administer");
    expect(tile?.domain).toBe("communications");
    expect(tile?.href("alder-creek")).toBe("/o/alder-creek/admin/domains");
  });

  it("the calendar tile is toggle-only (no flagKey) — DECISION-160", () => {
    const calendar = PORTAL_TILES.find((t) => t.key === "calendar");
    expect(calendar?.orgFeatureKey).toBe("org_portal.calendar");
    expect(calendar?.flagKey).toBeUndefined();
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

  it("PORTAL_TILES has exactly 22 entries (10 existing + 7 product-IA placeholders + 1 staff + 1 filings + 1 calendar + 1 giving-admin + 1 domains)", () => {
    expect(PORTAL_TILES.length).toBe(22);
  });

  it("no tile is keyed 'feedback' — removed entirely, re-surfaces as an avatar-menu item + prompt card (commit 2)", () => {
    expect(PORTAL_TILES.map((t) => t.key)).not.toContain("feedback");
  });

  it("mirrors the full 22-tile universe by key (2026-08-27 product-IA scaffold + staff-and-personnel + 2026-09-26 withdraw-publication + 2026-10-14 member-calendar + 2026-10-15 online-giving + 2026-10-19 custom-domains)", () => {
    expect(PORTAL_TILES.map((t) => t.key).sort()).toEqual(
      [
        "branding",
        "calendar",
        "committees",
        "communications",
        "credentials",
        "directory",
        "domains",
        "events",
        "features",
        "filings",
        "giving",
        "giving-admin",
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

  it("classifies roles/features/branding/tickets as administer and directory/members/officers/groups/calendar/credentials as operate, and events as administer (member-calendar R6 reverses DECISION-113 ruling 7 for events only) (operator correction 2026-08-26; groups-admin pipeline, DECISION-110 ruling 6; events-model pipeline, DECISION-113 ruling 7; presbytery-functionality Increment 2, Phase 3 Component/Page Plan)", () => {
    const byKey = Object.fromEntries(PORTAL_TILES.map((t) => [t.key, t]));
    expect(byKey.roles.category).toBe("administer");
    expect(byKey.features.category).toBe("administer");
    expect(byKey.branding.category).toBe("administer");
    expect(byKey.tickets.category).toBe("administer");
    expect(byKey.directory.category).toBe("operate");
    expect(byKey.members.category).toBe("operate");
    expect(byKey.officers.category).toBe("operate");
    expect(byKey.groups.category).toBe("operate");
    expect(byKey.calendar.category).toBe("operate");
    expect(byKey.events.category).toBe("administer");
    expect(byKey.credentials.category).toBe("operate");
  });

  it("labels the member read surface 'Calendar' and the authoring surface 'Manage events', both under Worship & Events", () => {
    const byKey = Object.fromEntries(PORTAL_TILES.map((t) => [t.key, t]));
    expect(byKey.calendar.label).toBe("Calendar");
    expect(byKey.calendar.href("alder-creek")).toBe("/o/alder-creek/calendar");
    expect(byKey.calendar.domain).toBe("worship");
    expect(byKey.events.label).toBe("Manage events");
    expect(byKey.events.href("alder-creek")).toBe("/o/alder-creek/admin/events");
    expect(byKey.events.domain).toBe("worship");
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
    calendar: { domain: "worship", category: "operate" },
    events: { domain: "worship", category: "administer" },
    roles: { domain: "administration", category: "administer" },
    features: { domain: "administration", category: "administer" },
    branding: { domain: "administration", category: "administer" },
    tickets: { domain: "administration", category: "administer" },
    giving: {
      domain: "giving",
      category: "operate",
      orgTypeScope: ["congregation", "new_worshiping_community"],
    },
    "giving-admin": {
      domain: "giving",
      category: "administer",
      orgTypeScope: ["congregation", "new_worshiping_community"],
    },
    domains: { domain: "communications", category: "administer" },
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
    filings: {
      domain: "reports",
      category: "administer",
      orgTypeScope: ["congregation"],
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

  it("presbytery-only tiles (committees, oversight, reports) each declare the presbytery allow-list; credentials does too; filings declares the congregation allow-list (DECISION-152); every other tile declares none", () => {
    const presbyteryOnly = new Set([
      "credentials",
      "committees",
      "oversight",
      "reports",
    ]);
    const congregationOnly = new Set(["filings"]);
    const congregationAndNwc = new Set(["giving", "giving-admin"]);
    for (const tile of PORTAL_TILES) {
      if (presbyteryOnly.has(tile.key)) {
        expect(tile.orgTypeScope).toEqual(["presbytery"]);
      } else if (congregationOnly.has(tile.key)) {
        expect(tile.orgTypeScope).toEqual(["congregation"]);
      } else if (congregationAndNwc.has(tile.key)) {
        expect([...(tile.orgTypeScope ?? [])].sort()).toEqual([
          "congregation",
          "new_worshiping_community",
        ]);
      } else {
        expect(tile.orgTypeScope).toBeUndefined();
      }
    }
  });
});
