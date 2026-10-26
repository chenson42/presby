import { describe, it, expect } from "vitest";
import { FEATURES, FEATURE_CATALOG, hasFeature } from "./permissions";

describe("permissions", () => {
  describe("hasFeature", () => {
    it("returns true when the feature is in the user's feature list", () => {
      expect(hasFeature([FEATURES.ADMIN_USERS], FEATURES.ADMIN_USERS)).toBe(true);
    });

    it("returns false when the feature is missing", () => {
      expect(hasFeature([FEATURES.ADMIN_USERS], FEATURES.ADMIN_FLAGS)).toBe(false);
    });

    it("returns false when the feature list is empty", () => {
      expect(hasFeature([], FEATURES.ADMIN_DASHBOARD)).toBe(false);
    });

    it("returns false when the feature list is undefined", () => {
      expect(hasFeature(undefined, FEATURES.ADMIN_DASHBOARD)).toBe(false);
    });
  });

  describe("FEATURE_CATALOG", () => {
    it("covers every key in the FEATURES constant", () => {
      const catalogKeys = new Set(FEATURE_CATALOG.map((f) => f.key));
      for (const key of Object.values(FEATURES)) {
        expect(catalogKeys.has(key)).toBe(true);
      }
    });

    it("has no duplicate keys", () => {
      const keys = FEATURE_CATALOG.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("assigns every entry a non-empty category", () => {
      for (const f of FEATURE_CATALOG) {
        expect(f.category.length).toBeGreaterThan(0);
      }
    });

    it("keeps every key string, the FEATURES map, the array order and the categories as shipped — the ADMIN_ORGANIZATIONS change is copy only", () => {
      expect(FEATURES).toEqual({
        ADMIN_DASHBOARD: "admin.dashboard",
        ADMIN_USERS: "admin.users",
        ADMIN_FLAGS: "admin.flags",
        ADMIN_RELEASE_NOTES: "admin.release_notes",
        ADMIN_FEEDBACK: "admin.feedback",
        ADMIN_AUDIT: "admin.audit",
        ADMIN_EMAIL_QUEUE: "admin.email_queue",
        ADMIN_WHATS_NEW: "admin.whats_new",
        ADMIN_TWO_FACTOR: "admin.two_factor",
        ADMIN_ORGANIZATIONS: "admin.organizations",
        ADMIN_TICKETS: "admin.tickets",
      });
      expect(FEATURE_CATALOG.map((f) => [f.key, f.category])).toEqual([
        ["admin.dashboard", "admin"],
        ["admin.two_factor", "admin"],
        ["admin.users", "admin"],
        ["admin.organizations", "admin"],
        ["admin.tickets", "admin"],
        ["admin.flags", "admin"],
        ["admin.release_notes", "admin"],
        ["admin.feedback", "admin"],
        ["admin.audit", "admin"],
        ["admin.email_queue", "admin"],
        ["admin.whats_new", "admin"],
      ]);
    });

    it("describes ADMIN_ORGANIZATIONS as organization management, not only branding", () => {
      const entry = FEATURE_CATALOG.find(
        (f) => f.key === FEATURES.ADMIN_ORGANIZATIONS,
      );
      expect(entry?.name).toBe("Manage organizations");
      expect(entry?.description).not.toMatch(/abusive|tenant|neutralis/i);
    });
  });
});
