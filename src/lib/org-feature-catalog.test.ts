/**
 * The per-org feature catalog's shape (DECISION-160, R1). Pure: it reads the
 * exported constant and `scripts/seed.ts` as text; no database.
 *
 * `server-only`, `@/lib/authz`, `@/lib/flags` and `@/lib/audit` are mocked
 * because `org-features.ts` imports them for its (separately tested) resolver
 * functions; none is exercised here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({ withOrgContext: vi.fn() }));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn(),
}));

// The app always enters the domain schema through `@/lib/db/schema`; entering
// at a leaf domain file reaches authz.ts before org.ts has initialised
// (see events.schema.test.ts), so load it first in the canonical order.
import "@/lib/db/schema";
import { ORG_FEATURE_CATALOG } from "./org-features";
import { PORTAL_TILES } from "./org-portal/tiles";

const SEED = readFileSync(
  path.resolve(__dirname, "../../scripts/seed.ts"),
  "utf8",
);
const SEEDED_FLAG_KEYS = new Set(
  [...SEED.matchAll(/key:\s*"([a-z0-9_.]+)"/g)].map((m) => m[1]),
);

describe("ORG_FEATURE_CATALOG", () => {
  it("has unique keys", () => {
    const keys = ORG_FEATURE_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every entry a `flag` (string or null) and a boolean `provisionedOn`", () => {
    for (const entry of ORG_FEATURE_CATALOG) {
      expect(
        entry.flag === null || typeof entry.flag === "string",
        `${entry.key}.flag`,
      ).toBe(true);
      expect(typeof entry.provisionedOn, `${entry.key}.provisionedOn`).toBe(
        "boolean",
      );
    }
  });

  it("names, for every non-null flag, a key scripts/seed.ts actually seeds (a drift guard, not a snapshot)", () => {
    expect(SEEDED_FLAG_KEYS.size).toBeGreaterThan(10); // the regex really matched
    for (const entry of ORG_FEATURE_CATALOG) {
      if (entry.flag === null) continue;
      expect(SEEDED_FLAG_KEYS.has(entry.flag), `${entry.key} -> ${entry.flag}`).toBe(
        true,
      );
    }
  });

  it("makes org_portal.calendar the one toggle-only (flag: null) and provisioned-on entry", () => {
    const toggleOnly = ORG_FEATURE_CATALOG.filter((e) => e.flag === null);
    expect(toggleOnly.map((e) => e.key)).toEqual(["org_portal.calendar"]);

    const provisioned = ORG_FEATURE_CATALOG.filter((e) => e.provisionedOn);
    expect(provisioned.map((e) => e.key)).toEqual(["org_portal.calendar"]);

    const calendar = ORG_FEATURE_CATALOG.find(
      (e) => e.key === "org_portal.calendar",
    );
    expect(calendar?.category).toBe("worship");
    expect(calendar?.name).toBe("Member calendar");
  });

  it("keeps the two members entries behind their same-string flag and unprovisioned (a missing row stays OFF)", () => {
    for (const key of ["org_portal.members_create", "org_portal.sensitive_info"]) {
      const entry = ORG_FEATURE_CATALOG.find((e) => e.key === key);
      expect(entry?.flag).toBe(key);
      expect(entry?.provisionedOn).toBe(false);
    }
  });

  it("names, for every PORTAL_TILES orgFeatureKey, a real catalog key (R1: a typo'd toggle key would hide the tile for everyone, forever)", () => {
    const catalogKeys = new Set<string>(ORG_FEATURE_CATALOG.map((e) => e.key));
    const gated = PORTAL_TILES.filter((t) => t.orgFeatureKey !== undefined);
    expect(gated.map((t) => t.key)).toContain("calendar");
    for (const tile of gated) {
      expect(
        catalogKeys.has(tile.orgFeatureKey as string),
        `${tile.key} -> ${tile.orgFeatureKey}`,
      ).toBe(true);
    }
  });
});
