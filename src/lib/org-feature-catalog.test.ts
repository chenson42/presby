/**
 * The per-org feature catalog's shape (DECISION-160, R1). Pure: it reads the
 * exported constant and `scripts/seed.ts` as text; no database.
 *
 * `server-only`, `@/lib/authz`, `@/lib/flags` and `@/lib/audit` are mocked
 * because `org-features.ts` imports them for its (separately tested) resolver
 * functions; none is exercised here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
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
import { ORG_FEATURE_CATALOG, orgTypeAdmitted } from "./org-features";
import { PORTAL_TILES } from "./org-portal/tiles";

const SRC_ROOT = path.resolve(__dirname, "..");
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

  it("makes org_portal.calendar and org_portal.giving the toggle-only (flag: null) entries, and calendar the one provisioned-on entry", () => {
    const toggleOnly = ORG_FEATURE_CATALOG.filter((e) => e.flag === null);
    expect(toggleOnly.map((e) => e.key).sort()).toEqual([
      "org_portal.calendar",
      "org_portal.giving",
    ]);

    const provisioned = ORG_FEATURE_CATALOG.filter((e) => e.provisionedOn);
    expect(provisioned.map((e) => e.key)).toEqual(["org_portal.calendar"]);

    const calendar = ORG_FEATURE_CATALOG.find(
      (e) => e.key === "org_portal.calendar",
    );
    expect(calendar?.category).toBe("worship");
    expect(calendar?.name).toBe("Member calendar");
  });

  it("gives every entry an `orgTypes` (null = every type, or a non-empty allow-list of real organization types)", () => {
    const REAL_TYPES = new Set([
      "general_assembly",
      "synod",
      "presbytery",
      "congregation",
      "new_worshiping_community",
    ]);
    for (const entry of ORG_FEATURE_CATALOG) {
      expect("orgTypes" in entry, `${entry.key}.orgTypes present`).toBe(true);
      const { orgTypes } = entry;
      if (orgTypes === null) continue;
      expect(orgTypes.length, `${entry.key}.orgTypes`).toBeGreaterThan(0);
      for (const type of orgTypes) {
        expect(REAL_TYPES.has(type), `${entry.key} -> ${type}`).toBe(true);
      }
    }
  });

  it("scopes org_portal.giving to congregation + new_worshiping_community, provisioned OFF, with NO platform flag (R11), and leaves every other entry unscoped", () => {
    const giving = ORG_FEATURE_CATALOG.find((e) => e.key === "org_portal.giving");
    expect(giving).toBeDefined();
    expect([...(giving!.orgTypes ?? [])].sort()).toEqual([
      "congregation",
      "new_worshiping_community",
    ]);
    expect(giving!.flag).toBeNull();
    expect(giving!.provisionedOn).toBe(false);
    expect(giving!.category).toBe("giving");
    for (const entry of ORG_FEATURE_CATALOG) {
      if (entry.key === "org_portal.giving") continue;
      expect(entry.orgTypes, entry.key).toBeNull();
    }
  });

  it("orgTypeAdmitted is an ALLOW-LIST: null admits everything, a list admits only its members, an unknown organization is never admitted by a list", () => {
    expect(orgTypeAdmitted(null, "presbytery")).toBe(true);
    expect(orgTypeAdmitted(null, null)).toBe(true);
    const list = ["congregation", "new_worshiping_community"] as const;
    expect(orgTypeAdmitted(list, "congregation")).toBe(true);
    expect(orgTypeAdmitted(list, "new_worshiping_community")).toBe(true);
    for (const t of ["presbytery", "synod", "general_assembly"] as const) {
      expect(orgTypeAdmitted(list, t), t).toBe(false);
    }
    expect(orgTypeAdmitted(list, null)).toBe(false);
  });

  it("no src file reads a platform flag named org_portal.giving (R11: giving is toggle-only; 0055 deleted the row)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(full, "utf8");
        if (/isFlagEnabled\(\s*["'`]org_portal\.giving["'`]/.test(text)) {
          offenders.push(path.relative(SRC_ROOT, full));
        }
        if (/flagKey:\s*["'`]org_portal\.giving["'`]/.test(text)) {
          offenders.push(`${path.relative(SRC_ROOT, full)} (tile flagKey)`);
        }
      }
    };
    walk(SRC_ROOT);
    expect(offenders).toEqual([]);
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

  it("gives every tile gated by a catalog entry that has an `orgTypes` allow-list an `orgTypeScope` EQUAL to it (set-equality) — the tile and the toggle must never disagree about which organizations Giving is for", () => {
    const gated = PORTAL_TILES.filter((t) => t.orgFeatureKey !== undefined);
    const scoped = gated.filter((t) => {
      const entry = ORG_FEATURE_CATALOG.find((e) => e.key === t.orgFeatureKey);
      return entry?.orgTypes !== null;
    });
    expect(scoped.map((t) => t.key).sort()).toEqual(["giving", "giving-admin"]);
    for (const tile of scoped) {
      const entry = ORG_FEATURE_CATALOG.find((e) => e.key === tile.orgFeatureKey)!;
      expect([...(tile.orgTypeScope ?? [])].sort(), tile.key).toEqual(
        [...(entry.orgTypes ?? [])].sort(),
      );
    }
  });
});
