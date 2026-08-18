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
  });
});
