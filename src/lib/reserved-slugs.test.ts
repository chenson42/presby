import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, isReservedSlug } from "./reserved-slugs";

describe("isReservedSlug", () => {
  it("rejects a live top-level route segment", () => {
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("o")).toBe(true);
    expect(isReservedSlug("api")).toBe(true);
    expect(isReservedSlug("launch")).toBe(true);
  });

  it("rejects a P5 infra label not yet a live route", () => {
    expect(isReservedSlug("www")).toBe(true);
    expect(isReservedSlug("staging")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isReservedSlug("ADMIN")).toBe(true);
    expect(isReservedSlug("Admin")).toBe(true);
  });

  it("accepts an ordinary congregation slug", () => {
    expect(isReservedSlug("fpcw")).toBe(false);
    expect(isReservedSlug("first-pres-anytown")).toBe(false);
  });

  it("RESERVED_SLUGS contains no empty or whitespace entries", () => {
    for (const slug of RESERVED_SLUGS) {
      expect(slug.trim()).toBe(slug);
      expect(slug.length).toBeGreaterThan(0);
    }
  });
});
