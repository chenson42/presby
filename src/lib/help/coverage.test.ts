/**
 * The vitest half of check:help (P3-1, F-new-1). ORG_FEATURE_CATALOG and PORTAL_TILES
 * cannot be imported by `tsx` (both modules begin `import "server-only"` and reach the
 * database), so the rules that need them live here, under the same mocks
 * src/lib/org-feature-catalog.test.ts uses. `npm run test` and CI run this on every PR.
 *
 *   (1) every catalog key and every tile key is covered by some PUBLISHED page, or is
 *       in the shrink-only allowlist with a reason;
 *   (2) every `covers` entry on a published page names something real;
 *   (3) a published `needs.turnOn` equals the catalog entry it names;
 *   (4) the allowlist is pinned, and nothing is both allowlisted and covered;
 *   (5) pending pages' `covers` are not checked (their keys are not on main yet).
 *
 * The rules are plain functions over data so each has a failing fixture below.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({ withOrgContext: vi.fn() }));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" },
  recordAudit: vi.fn(),
}));

// Same load order as org-feature-catalog.test.ts: the domain schema first.
import "@/lib/db/schema";
import { ORG_FEATURE_CATALOG } from "@/lib/org-features";
import { PORTAL_TILES } from "@/lib/org-portal/tiles";
import { COVERAGE_ALLOWLIST } from "./coverage-allowlist";
import { HELP_PAGES } from "./registry";
import type { HelpContentEntry, HelpEntry } from "./types";

/** Shrink-only (P3-16): this number may be lowered, never raised. Batch 5a and 5b delete the
 * "written later in this increment" entries as the pages that cover them publish. */
const ALLOWLIST_PIN = 29;

const ROOT = path.resolve(__dirname, "../../..");

// ---- the rules, as functions over data -------------------------------------

interface CatalogLike {
  key: string;
  name: string;
  provisionedOn: boolean;
  orgTypes: readonly string[] | null;
  operatorEnabled: boolean;
  flag: string | null;
}

export function appliesToOf(orgTypes: readonly string[] | null): string {
  if (orgTypes === null) return "all";
  const key = [...orgTypes].sort().join("+");
  const map: Record<string, string> = {
    congregation: "congregations",
    "congregation+new_worshiping_community": "congregations-and-nwcs",
    presbytery: "presbyteries",
  };
  return map[key] ?? `unmapped:${key}`;
}

/** The set of keys (`org_portal.x`, `tile:y`) a page list covers. Pending and planned never count;
 * an `overview` page counts only for its own tile entries, never for a toggle key (P3-16). */
export function coveredKeys(pages: readonly HelpEntry[]): Set<string> {
  const out = new Set<string>();
  for (const p of pages) {
    if (p.status !== "published") continue;
    for (const c of p.covers) {
      if (p.overview && !c.startsWith("tile:")) continue;
      out.add(c);
    }
  }
  return out;
}

export function uncoveredKeys(
  required: readonly string[],
  pages: readonly HelpEntry[],
  allowlist: readonly { key: string }[],
): string[] {
  const covered = coveredKeys(pages);
  const allowed = new Set(allowlist.map((a) => a.key));
  return required.filter((k) => !covered.has(k) && !allowed.has(k));
}

export function unknownCovers(
  pages: readonly HelpEntry[],
  real: { keys: ReadonlySet<string>; flags: ReadonlySet<string>; routes: ReadonlySet<string> },
): string[] {
  const out: string[] = [];
  for (const p of pages) {
    if (p.status !== "published") continue; // (5): pending pages are not checked
    for (const c of p.covers) {
      if (c.startsWith("route:")) {
        if (!real.routes.has(c.slice("route:".length))) out.push(`${p.slug}: ${c}`);
      } else if (c.startsWith("flag:")) {
        if (!real.flags.has(c.slice("flag:".length))) out.push(`${p.slug}: ${c}`);
      } else if (!real.keys.has(c)) out.push(`${p.slug}: ${c}`);
    }
  }
  return out;
}

export function needsMismatches(pages: readonly HelpEntry[], catalog: readonly CatalogLike[]): string[] {
  const out: string[] = [];
  for (const p of pages) {
    if (p.status !== "published" || !p.needs?.turnOn) continue;
    const t = p.needs.turnOn;
    const entry = catalog.find((e) => e.key === t.toggleKey);
    if (!entry) {
      out.push(`${p.slug}: ${t.toggleKey} is not a catalog key`);
      continue;
    }
    if (t.name !== entry.name) out.push(`${p.slug}: name "${t.name}" != catalog "${entry.name}"`);
    if (t.defaultOn !== entry.provisionedOn) out.push(`${p.slug}: defaultOn ${t.defaultOn} != provisionedOn ${entry.provisionedOn}`);
    if ((p.needs.appliesTo ?? "all") !== appliesToOf(entry.orgTypes)) out.push(`${p.slug}: appliesTo differs from orgTypes`);
    if ((p.needs.operatorEnabled ?? false) !== entry.operatorEnabled) out.push(`${p.slug}: operatorEnabled differs`);
  }
  return out;
}

// ---- real data ---------------------------------------------------------------

const REQUIRED_KEYS = [
  ...ORG_FEATURE_CATALOG.map((e) => e.key as string),
  ...PORTAL_TILES.map((t) => `tile:${t.key}`),
];

function pageRoutes(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string, segs: string[]) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const group = /^\(.*\)$/.test(ent.name);
        const seg = group ? [] : [ent.name.replace(/^\[(.+)\]$/, "{$1}")];
        walk(path.join(dir, ent.name), [...segs, ...seg]);
      } else if (/^page\.tsx?$/.test(ent.name)) {
        routes.add(`/${segs.join("/")}`.replace(/\/$/, "") || "/");
      }
    }
  };
  walk(path.join(ROOT, "src/app"), []);
  return routes;
}

function seededFlags(): Set<string> {
  const seed = readFileSync(path.join(ROOT, "scripts/seed.ts"), "utf8");
  return new Set([...seed.matchAll(/key:\s*"([a-z0-9_.]+)"/g)].map((m) => m[1]));
}

// ---- the checks on the real repo ----------------------------------------------

describe("catalog and tile coverage (the real registry)", () => {
  it("(1) every catalog key and tile key is covered by a published page or allowlisted with a reason", () => {
    expect(REQUIRED_KEYS.length).toBeGreaterThan(20); // the imports really loaded
    expect(uncoveredKeys(REQUIRED_KEYS, HELP_PAGES, COVERAGE_ALLOWLIST)).toEqual([]);
  });

  it("(2) every covers entry on a published page names a real key, flag or route", () => {
    const real = {
      keys: new Set(REQUIRED_KEYS),
      flags: seededFlags(),
      routes: pageRoutes(),
    };
    expect(real.routes.size).toBeGreaterThan(10);
    expect(real.routes.has("/o/{slug}/admin")).toBe(true);
    expect(unknownCovers(HELP_PAGES, real)).toEqual([]);
  });

  it("(3) every published needs.turnOn equals its catalog entry", () => {
    expect(needsMismatches(HELP_PAGES, ORG_FEATURE_CATALOG as unknown as CatalogLike[])).toEqual([]);
  });
});

describe("the shrink-only allowlist", () => {
  const real = new Set(REQUIRED_KEYS);

  it("(4) is pinned: it may shrink, it may not grow without editing this number", () => {
    expect(COVERAGE_ALLOWLIST.length).toBeLessThanOrEqual(ALLOWLIST_PIN);
  });
  it("has unique keys, each with a reason, each naming a real catalog or tile key", () => {
    const keys = COVERAGE_ALLOWLIST.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of COVERAGE_ALLOWLIST) {
      expect(a.reason.trim().length, a.key).toBeGreaterThan(10);
      expect(real.has(a.key), `${a.key} is not a catalog or tile key`).toBe(true);
    }
  });
  it("(4) lists nothing that a published page already covers", () => {
    const covered = coveredKeys(HELP_PAGES);
    expect(COVERAGE_ALLOWLIST.filter((a) => covered.has(a.key)).map((a) => a.key)).toEqual([]);
  });
  it("still lists the deliberately undocumented keys of P3-12 and Phase 1 Q5/Q6", () => {
    const keys = new Set(COVERAGE_ALLOWLIST.map((a) => a.key));
    for (const k of [
      "org_portal.giving", "tile:giving", "tile:giving-admin", "org_portal.mail_domain",
      "org_portal.sensitive_info", "org_portal.parishes", "tile:groups", "tile:staff",
      "tile:credentials", "tile:oversight", "tile:reports", "tile:filings", "tile:committees",
      "tile:worship", "tile:insights", "tile:communications",
    ]) expect(keys.has(k), k).toBe(true);
  });
});

// ---- failing fixtures for each rule -----------------------------------------------

const published = (slug: string, extra: Record<string, unknown> = {}): HelpContentEntry =>
  ({
    status: "published", slug, title: slug, summary: "s", order: 1, audience: "everyone",
    covers: [], labels: [], verifiedIn: "0.47.0", ...extra,
  }) as HelpContentEntry;
const pending = (slug: string, extra: Record<string, unknown> = {}): HelpContentEntry =>
  ({
    status: "pending", slug, title: slug, summary: "s", order: 1, audience: "everyone",
    covers: [], labels: [], verifiedIn: null, requires: "t", ...extra,
  }) as HelpContentEntry;

describe("the coverage rules on fixtures", () => {
  it("(1) fails a key no published page covers and no allowlist entry names", () => {
    expect(uncoveredKeys(["tile:x", "org_portal.y"], [], [])).toEqual(["tile:x", "org_portal.y"]);
  });
  it("(1) passes a covered key, an allowlisted key", () => {
    const pages = [published("a", { covers: ["tile:x"] })];
    expect(uncoveredKeys(["tile:x", "org_portal.y"], pages, [{ key: "org_portal.y" }])).toEqual([]);
  });
  it("(1) pending and planned pages never count as coverage", () => {
    const pages: HelpEntry[] = [
      pending("p", { covers: ["tile:x"] }),
      { status: "planned", slug: "pl", title: "t", summary: "s", order: 1, forWhom: "w", today: "t", confirmedOn: "2026-10-26" },
    ];
    expect(uncoveredKeys(["tile:x"], pages, [])).toEqual(["tile:x"]);
  });
  it("(1) an overview page covers its own tile, never a toggle key", () => {
    const pages = [published("o", { overview: true, covers: ["tile:features", "org_portal.calendar"] })];
    expect(uncoveredKeys(["tile:features", "org_portal.calendar"], pages, [])).toEqual(["org_portal.calendar"]);
  });
  it("(2) fails a covers entry that names nothing real, and passes real ones", () => {
    const real = { keys: new Set(["tile:x"]), flags: new Set(["ui.f"]), routes: new Set(["/home"]) };
    const bad = [published("a", { covers: ["tile:nope", "flag:nope", "route:/nope", "org_portal.nope"] })];
    expect(unknownCovers(bad, real)).toHaveLength(4);
    const good = [published("a", { covers: ["tile:x", "flag:ui.f", "route:/home"] })];
    expect(unknownCovers(good, real)).toEqual([]);
  });
  it("(5) does not check a pending page's covers", () => {
    const real = { keys: new Set<string>(), flags: new Set<string>(), routes: new Set<string>() };
    expect(unknownCovers([pending("p", { covers: ["org_portal.not-on-main-yet"] })], real)).toEqual([]);
  });
  const cat: CatalogLike = {
    key: "org_portal.careers", name: "Job openings", provisionedOn: false,
    orgTypes: null, operatorEnabled: false, flag: null,
  };
  it("(3) fails a turn-on name, default, applies-to or operator mismatch; passes an equal one", () => {
    const turn = (over: Record<string, unknown>, needs: Record<string, unknown> = {}) =>
      published("a", {
        needs: { who: "An administrator", turnOn: { toggleKey: "org_portal.careers", name: "Job openings", defaultOn: false, ...over }, ...needs },
      });
    expect(needsMismatches([turn({})], [cat])).toEqual([]);
    expect(needsMismatches([turn({ name: "Job postings" })], [cat])).toHaveLength(1);
    expect(needsMismatches([turn({ defaultOn: true })], [cat])).toHaveLength(1);
    expect(needsMismatches([turn({}, { appliesTo: "congregations" })], [cat])).toHaveLength(1);
    expect(needsMismatches([turn({}, { operatorEnabled: true })], [cat])).toHaveLength(1);
    expect(needsMismatches([turn({ toggleKey: "org_portal.nope" })], [cat])).toHaveLength(1);
  });
  it("(3) maps orgTypes to appliesTo", () => {
    expect(appliesToOf(null)).toBe("all");
    expect(appliesToOf(["congregation"])).toBe("congregations");
    expect(appliesToOf(["new_worshiping_community", "congregation"])).toBe("congregations-and-nwcs");
    expect(appliesToOf(["presbytery"])).toBe("presbyteries");
  });
  it("(3) does not check a pending page's needs", () => {
    const p = pending("p", { needs: { who: "x", turnOn: { toggleKey: "org_portal.nope", name: "n", defaultOn: true } } });
    expect(needsMismatches([p], [cat])).toEqual([]);
  });
});
