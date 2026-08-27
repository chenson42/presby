/**
 * Unit tests for the platform-portal tile registry — commit 1 of
 * docs/work-log/2026-08-27-platform-home-and-portal.md (Phase 3, DECISION-
 * 123). Pins:
 *
 *   1. Exactly 10 tiles (11 FEATURES.* keys minus ADMIN_DASHBOARD, the door
 *      feature, never a tile).
 *   2. No `design-system` or `sites` entry (both named, deliberately
 *      excluded — see the module's own header comment and docs/TODO.md).
 *   3. Every `requiredFeature` is a real `FEATURES.*` key, checked against
 *      the live catalog import (not a hard-coded snapshot) — a registry
 *      entry pointing at a typo'd or renamed key fails here, not silently at
 *      render time.
 *   4. Domain assignment matches the design's table exactly.
 *   5. The module imports NOTHING from `@/lib/permissions`'s `hasFeature`,
 *      `@/lib/flags`, `next-auth`, or the db layer — a source-level pin on
 *      the architect's "pure synchronous data" constraint, the same style
 *      `admin/page.test.tsx`'s no-permission-check source scan uses.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/permissions";
import {
  ADMIN_DOMAIN_LABELS,
  ADMIN_DOMAIN_ORDER,
  ADMIN_TILES,
  type AdminDomain,
} from "./tiles";

const ALL_FEATURE_VALUES = new Set(Object.values(FEATURES));

describe("ADMIN_TILES — shape", () => {
  it("has exactly 10 tiles", () => {
    expect(ADMIN_TILES).toHaveLength(10);
  });

  it("has no design-system or sites entry", () => {
    const keys = ADMIN_TILES.map((t) => t.key);
    expect(keys).not.toContain("design-system");
    expect(keys).not.toContain("design_system");
    expect(keys).not.toContain("sites");
  });

  it("has no duplicate keys", () => {
    const keys = ADMIN_TILES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every requiredFeature is a real FEATURES.* key from the live catalog", () => {
    for (const tile of ADMIN_TILES) {
      expect(ALL_FEATURE_VALUES.has(tile.requiredFeature)).toBe(true);
    }
  });

  it("never gates a tile on FEATURES.ADMIN_DASHBOARD — the door feature, never a tile", () => {
    for (const tile of ADMIN_TILES) {
      expect(tile.requiredFeature).not.toBe(FEATURES.ADMIN_DASHBOARD);
    }
  });

  it("every domain is one of the three ADMIN_DOMAIN_ORDER values", () => {
    for (const tile of ADMIN_TILES) {
      expect(ADMIN_DOMAIN_ORDER).toContain(tile.domain);
    }
  });

  it("every href is a plain absolute string, not a function (no per-org slug on this axis)", () => {
    for (const tile of ADMIN_TILES) {
      expect(typeof tile.href).toBe("string");
      expect(tile.href.startsWith("/admin")).toBe(true);
    }
  });

  it("includes a Tickets tile gated on FEATURES.ADMIN_TICKETS (the second present defect this pipeline fixes)", () => {
    const tickets = ADMIN_TILES.find((t) => t.key === "tickets");
    expect(tickets).toBeDefined();
    expect(tickets?.requiredFeature).toBe(FEATURES.ADMIN_TICKETS);
    expect(tickets?.href).toBe("/admin/tickets");
  });
});

describe("ADMIN_TILES — domain assignment matches the design table", () => {
  const expected: Record<string, AdminDomain> = {
    users: "people_access",
    "2fa": "people_access",
    organizations: "platform_operations",
    flags: "platform_operations",
    audit: "platform_operations",
    email_queue: "platform_operations",
    docs: "content_communications",
    whats_new: "content_communications",
    feedback: "content_communications",
    tickets: "content_communications",
  };

  it.each(Object.entries(expected))("%s belongs to %s", (key, domain) => {
    const tile = ADMIN_TILES.find((t) => t.key === key);
    expect(tile?.domain).toBe(domain);
  });
});

describe("ADMIN_DOMAIN_LABELS/ADMIN_DOMAIN_ORDER — the three-domain taxonomy", () => {
  it("declares exactly the three domains, in order", () => {
    expect(ADMIN_DOMAIN_ORDER).toEqual([
      "people_access",
      "platform_operations",
      "content_communications",
    ]);
  });

  it("has a label for every domain in the order", () => {
    for (const domain of ADMIN_DOMAIN_ORDER) {
      expect(ADMIN_DOMAIN_LABELS[domain]).toBeTruthy();
    }
  });
});

describe("ADMIN_TILES — pure synchronous data module (architect Phase 2 constraint)", () => {
  it("imports nothing from @/lib/flags, next-auth, or the db layer, and calls neither hasFeature() nor isFlagEnabled()", () => {
    // Strip block comments before scanning: this module's own header
    // deliberately NAMES the functions it must never import (as a "do not
    // add this" warning), which would otherwise false-positive against a
    // naive substring scan of the raw source — same technique
    // `admin/page.test.tsx`'s no-permission-check source scan uses.
    const rawSource = readFileSync(resolve(__dirname, "tiles.ts"), "utf-8");
    const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toMatch(/@\/lib\/flags/);
    expect(source).not.toMatch(/next-auth/);
    expect(source).not.toMatch(/@\/lib\/db/);
    expect(source).not.toMatch(/@\/auth/);
    expect(source).not.toMatch(/hasFeature\(/);
    expect(source).not.toMatch(/isFlagEnabled\(/);
  });
});
