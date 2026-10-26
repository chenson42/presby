/**
 * U13: the migration's toggle literals are the catalog entry's
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 Test Plan U13; R8).
 * `presby_person_photos_enabled()` (drizzle/0078) repeats the catalog entry's
 * key, its category and its (absent) applicability allow-list, plus the category
 * axis flag, because the anonymous roster and the door cannot call
 * `orgFeatureEnabledInTx`. This pins every literal to the entry, so changing the
 * entry without the migration fails here; `public-photo.db.test.ts` then proves
 * the composition over axis x category x toggle against a real database.
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

const MIGRATION = readFileSync(path.resolve(__dirname, "../../../drizzle/0078_presby_person_photos.sql"), "utf8");
const KEY = "org_portal.person_photos";

/** The body of presby_person_photos_enabled, from its create statement to its closing $$. */
function toggleFunction(): string {
  const start = MIGRATION.indexOf("create or replace function presby_person_photos_enabled");
  expect(start, "the function is in the migration").toBeGreaterThan(-1);
  return MIGRATION.slice(start, MIGRATION.indexOf("$$;", MIGRATION.indexOf("$$", start) + 2));
}

describe("the toggle composition in SQL is pinned to the catalog entry", () => {
  const entry = ORG_FEATURE_CATALOG.find((e) => e.key === KEY);

  it("the entry exists with the key the SQL names", () => {
    expect(entry).toBeDefined();
    expect(toggleFunction()).toContain(`t.feature_key = '${KEY}'`);
  });

  it("composes the category the catalog says", () => {
    expect(entry!.category).toBe("people");
    expect(toggleFunction()).toContain(`c.category = '${entry!.category}'`);
  });

  it("repeats no organization-type allow-list, because the entry has none (one added later fails here and forces the migration to follow)", () => {
    expect(entry!.orgTypes).toBeNull();
    expect(toggleFunction()).not.toMatch(/organization_type|organizations\b|orgTypes/);
  });

  it("is toggle-only: no platform flag to compose (the SQL reads the category axis flag only), and provisioned OFF so a missing row is off", () => {
    expect(entry!.flag).toBeNull();
    expect(entry!.provisionedOn).toBe(false);
    const sqlText = toggleFunction();
    expect(sqlText).toMatch(/from organization_feature_toggles t/);
    // A missing toggle row is false: coalesce(<toggle row>, false) and nothing else defaults it on.
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
});
