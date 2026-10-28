import { describe, expect, it } from "vitest";
import { SLUG_HISTORY } from "./slug-history";

describe("SLUG_HISTORY (append-only)", () => {
  it("is a list of unique, kebab-case slugs", () => {
    expect(new Set(SLUG_HISTORY).size).toBe(SLUG_HISTORY.length);
    for (const s of SLUG_HISTORY) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
