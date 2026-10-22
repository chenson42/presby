import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, isReservedSlug } from "./reserved-slugs";

const APP_DIR = path.resolve(__dirname, "../app");

/**
 * Every live top-level URL segment under src/app: bare top-level directories
 * plus the children of every route group (a `(group)` directory adds no URL
 * segment, so its own children are top-level paths; groups may nest). Dynamic
 * `[param]` segments, private `_folders` and `@parallel` slots are not
 * literal paths and are skipped.
 */
function liveTopLevelSegments(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith("(") && name.endsWith(")")) {
      out.push(...liveTopLevelSegments(path.join(dir, name)));
    } else if (!/^[[_@]/.test(name)) {
      out.push(name);
    }
  }
  return out;
}

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

  // Regression for F157 (RESERVED_SLUGS drift): `file-statistics` (DECISION-147)
  // was added as a route and never to the list, and nothing tested the list
  // against the route tree - the invariant was paper-only.
  it("reserves every live top-level route segment in src/app — regression for RESERVED_SLUGS drift (F157)", () => {
    const segments = liveTopLevelSegments(APP_DIR);
    expect(segments.length).toBeGreaterThan(10);
    const unreserved = segments.filter((segment) => !isReservedSlug(segment));
    expect(unreserved).toEqual([]);
  });

  it("reserves `file-statistics` and `invite` — regression for RESERVED_SLUGS drift (F157)", () => {
    // `file-statistics` is a live route; `invite` is the account-invitation
    // route group's path (DECISION-185), reserved before the route lands so no
    // organization can take the slug in the meantime.
    expect(isReservedSlug("file-statistics")).toBe(true);
    expect(isReservedSlug("invite")).toBe(true);
    expect(isReservedSlug("Invite")).toBe(true);
  });

  it("RESERVED_SLUGS contains no empty or whitespace entries", () => {
    for (const slug of RESERVED_SLUGS) {
      expect(slug.trim()).toBe(slug);
      expect(slug.length).toBeGreaterThan(0);
    }
  });
});
