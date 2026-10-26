/**
 * The developer nav registry (E17): every href resolves to a page on disk, hrefs
 * are unique, the registry is pure data, and the admin nav never links here
 * (DECISION-044).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV_GROUPS } from "@/lib/admin-portal/nav";
import { activeNavHref } from "@/components/shared/console-nav-links";
import { DEVELOPER_NAV_GROUPS } from "./nav";

const ROOT = resolve(__dirname, "../../..");
const PAGES = resolve(ROOT, "src/app/(admin)/developer");
const items = DEVELOPER_NAV_GROUPS.flatMap((g) => g.items);

describe("DEVELOPER_NAV_GROUPS", () => {
  it("lists the groups in order, Home without a heading", () => {
    expect(DEVELOPER_NAV_GROUPS.map((g) => g.heading)).toEqual([
      null,
      "Reference",
      "Guides",
    ]);
    expect(items.map((i) => i.label)).toEqual([
      "Home",
      "Data model",
      "Documentation",
    ]);
  });

  it("points every item at a page.tsx on disk", () => {
    for (const item of items) {
      const dir = item.href.replace(/^\/developer\/?/, "");
      expect(existsSync(resolve(PAGES, dir, "page.tsx")), item.href).toBe(true);
    }
  });

  it("has unique hrefs, all inside /developer", () => {
    const hrefs = items.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(h).toMatch(/^\/developer(\/|$)/);
  });

  it("makes only Home exact", () => {
    expect(items.filter((i) => i.exact).map((i) => i.label)).toEqual(["Home"]);
  });

  it("lights Data model on table and diagram pages, Home only on /developer (E18)", () => {
    const at = (p: string) => activeNavHref(p, DEVELOPER_NAV_GROUPS);
    expect(at("/developer")).toBe("/developer");
    expect(at("/developer/data-model")).toBe("/developer/data-model");
    expect(at("/developer/tables/roll_actions")).toBe("/developer/data-model");
    expect(at("/developer/erd/d-rolls")).toBe("/developer/data-model");
    expect(at("/developer/docs")).toBe("/developer/docs");
    expect(at("/developerx")).toBeNull();
  });

  it("is never linked from the admin nav (DECISION-044)", () => {
    const adminHrefs = ADMIN_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(adminHrefs.filter((h) => h.startsWith("/developer"))).toEqual([]);
  });

  it("stays pure data: imports nothing", () => {
    const src = readFileSync(resolve(__dirname, "nav.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
