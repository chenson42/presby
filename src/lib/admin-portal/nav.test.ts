/**
 * The console nav registry. Pins: every `requiredFeature` is a real
 * `FEATURES.*` key (checked against the live catalog, not a snapshot), every
 * `admin.*` key except the door appears somewhere, hrefs are unique and live
 * under /admin, only Dashboard is `exact`, the labels the e2e suite matches by
 * name are present, and the module stays pure synchronous data.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/permissions";
import { ADMIN_NAV_GROUPS } from "./nav";

const items = ADMIN_NAV_GROUPS.flatMap((g) => g.items);

describe("ADMIN_NAV_GROUPS", () => {
  it("lists the groups in the designed order", () => {
    expect(ADMIN_NAV_GROUPS.map((g) => g.heading)).toEqual([
      null,
      "Organizations",
      "Support",
      "Access and settings",
      "Content",
      "Reference",
    ]);
    expect(ADMIN_NAV_GROUPS.filter((g) => g.footer).map((g) => g.key)).toEqual([
      "reference",
    ]);
  });

  it("uses only real FEATURES keys (or null for door-only)", () => {
    const real = new Set<string>(Object.values(FEATURES));
    for (const item of items) {
      if (item.requiredFeature !== null) {
        expect(real.has(item.requiredFeature)).toBe(true);
      }
    }
  });

  it("covers every admin.* key except the door key", () => {
    const used = new Set(items.map((i) => i.requiredFeature));
    for (const key of Object.values(FEATURES)) {
      if (key === FEATURES.ADMIN_DASHBOARD) continue;
      expect(used.has(key), key).toBe(true);
    }
    expect(used.has(FEATURES.ADMIN_DASHBOARD)).toBe(false);
  });

  it("has unique hrefs, all under /admin", () => {
    const hrefs = items.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href).toMatch(/^\/admin(\/|$)/);
  });

  it("makes only the Dashboard exact, and links nothing into /o/", () => {
    expect(items.filter((i) => i.exact).map((i) => i.label)).toEqual(["Dashboard"]);
    for (const item of items) expect(item.href).not.toMatch(/^\/o\//);
  });

  it("keeps the labels existing e2e specs match by name", () => {
    const labels = items.map((i) => i.label);
    for (const label of [
      "Users & roles",
      "Feature flags",
      "Release notes",
      "2FA policy",
      "Audit log",
      "Email queue",
      "What's new",
      "Organizations",
    ]) {
      expect(labels).toContain(label);
    }
  });

  it("keeps Design system and Dashboard door-level (F281)", () => {
    const door = items.filter((i) => i.requiredFeature === null).map((i) => i.label);
    expect(door.sort()).toEqual(["Dashboard", "Design system"]);
  });

  it("is pure data: no permission check, session, flag or database import", () => {
    const src = readFileSync(resolve(__dirname, "nav.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(src).not.toMatch(/hasFeature|isFlagEnabled|next-auth|@\/auth|@\/lib\/db/);
  });
});
