/**
 * The migration's toggle literals are the catalog entry's - docs/work-log/
 * 2026-11-04-worship-inc1.md, Phase 3 "Data Model" (`presby_worship_enabled`)
 * and the Tests table (`worship-toggle.test.ts`). `presby_worship_enabled()`
 * (drizzle/0085) repeats the catalog entry's key, its category, its
 * organization-type allow-list and the category axis flag, because the
 * reminder claim and Increment 1b's credential definers cannot call
 * `orgFeatureEnabledInTx`. This pins every literal to the entry, so changing
 * the entry without the migration fails here; `enabled.db.test.ts` then proves
 * the composition against a real database over the whole matrix.
 * Pure: the migration is read as text.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({ withOrgContext: vi.fn() }));
const mockIsFlagEnabled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flags", () => ({ isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args) }));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: { ORG_FEATURE_TOGGLED: "tenant.org_feature.toggled" }, recordAudit: vi.fn() }));

import "@/lib/db/schema";
import { ORG_FEATURE_CATALOG, isCategoryAxisOn } from "@/lib/org-features";
import { WORSHIP_TOGGLE_KEY } from "./vocab";

const MIGRATION = readFileSync(path.resolve(__dirname, "../../../drizzle/0085_presby_worship.sql"), "utf8");

/** The body of presby_worship_enabled, from its create statement to its closing $function$. */
function toggleFunction(): string {
  const start = MIGRATION.indexOf("create or replace function presby_worship_enabled");
  expect(start, "the function is in the migration").toBeGreaterThan(-1);
  const bodyStart = MIGRATION.indexOf("$function$", start);
  return MIGRATION.slice(start, MIGRATION.indexOf("$function$;", bodyStart + 10));
}

describe("the toggle composition in SQL is pinned to the catalog entry", () => {
  const entry = ORG_FEATURE_CATALOG.find((e) => e.key === WORSHIP_TOGGLE_KEY);

  it("the entry exists with the key the SQL names", () => {
    expect(entry).toBeDefined();
    expect(toggleFunction()).toContain(`t.feature_key = '${WORSHIP_TOGGLE_KEY}'`);
  });

  it("composes the category the catalog says", () => {
    expect(entry!.category).toBe("worship");
    expect(toggleFunction()).toContain(`c.category = '${entry!.category}'`);
  });

  it("repeats the organization-type allow-list exactly (a type added to either side fails here)", () => {
    expect([...(entry!.orgTypes ?? [])].sort()).toEqual(["congregation", "new_worshiping_community"]);
    const quoted = [...entry!.orgTypes!].sort().map((t) => `'${t}'`);
    const inList = toggleFunction().match(/organization_type::text in \(([^)]*)\)/);
    expect(inList, "an organization_type allow-list").not.toBeNull();
    const sqlTypes = inList![1]!.split(",").map((s) => s.trim()).sort();
    expect(sqlTypes).toEqual(quoted);
  });

  it("is toggle-only: no platform flag to compose beyond the category axis, and provisioned OFF so a missing row is off", () => {
    expect(entry!.flag).toBeNull();
    expect(entry!.provisionedOn).toBe(false);
    const sqlText = toggleFunction();
    expect(sqlText).toMatch(/from organization_feature_toggles t/);
    // A missing toggle row is false, and nothing else defaults it on.
    expect(sqlText).toMatch(/coalesce\(\(select t\.enabled[\s\S]*?\), false\)/);
  });

  it("reads the same category-axis flag the application reads, and a MISSING category row defaults to on (the app's own default)", async () => {
    mockIsFlagEnabled.mockResolvedValue(true);
    await isCategoryAxisOn();
    const flagKey = String(mockIsFlagEnabled.mock.calls[0]![0]);
    expect(flagKey).toBe("org_portal.feature_categories");
    expect(toggleFunction()).toContain(`f.key = '${flagKey}'`);
    expect(toggleFunction()).toMatch(/from organization_feature_categories c[\s\S]*?\), true\)/);
  });

  it("the entry is self-service: an org_features.manage holder, never the operator, turns it on", () => {
    expect(entry!.operatorEnabled).toBe(false);
  });

  it("the migration deletes the old global flag row and the seed no longer carries it", () => {
    expect(MIGRATION).toMatch(/delete from feature_flags where key = 'org_portal\.worship'/);
    const seed = readFileSync(path.resolve(__dirname, "../../../scripts/seed.ts"), "utf8");
    expect(seed).not.toMatch(/key:\s*"org_portal\.worship"/);
    const reset = readFileSync(path.resolve(__dirname, "../../../scripts/ci/e2e-reset-flags.sql"), "utf8");
    expect(reset).not.toMatch(/org_portal\.worship/);
  });
});
