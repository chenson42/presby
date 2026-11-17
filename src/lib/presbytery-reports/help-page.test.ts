import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPORTS } from "./contract";

// The reports' tile has only the global `org_portal.reports` flag, no
// per-organization toggle, so the help page must not tell a presbytery it
// "turned on" the reports (Phase 5 run 1, copy truthfulness).
const page = readFileSync(
  path.join(process.cwd(), "src/content/help/presbytery-reports.md"),
  "utf8",
);

describe("presbytery-reports help page", () => {
  it("does not say a presbytery turns the reports on", () => {
    expect(page).not.toMatch(/presbytery that has turned on/i);
    expect(page.startsWith('Where "Per-Capita, SASR & Imports" is turned on, a presbytery can read four reports')).toBe(true);
  });

  it("says the platform team switches the reports on", () => {
    expect(page).toMatch(/switched on by the PresbyPortal team for the whole platform/);
  });

  it("documents the dashboard: read-only, and the four permissions the reports name", () => {
    const section = page.slice(page.indexOf("## Insights and analytics"), page.indexOf("## Vacant pulpits"));
    expect(section.length).toBeGreaterThan(200);
    expect(section).toMatch(/It is read-only: nothing on it can be changed, and it has no download\./);
    for (const r of REPORTS) {
      // the permission column quotes each phrase, capitalised ("Manage statistics")
      const phrase = r.permissionPhrase.charAt(0).toUpperCase() + r.permissionPhrase.slice(1);
      expect(section, r.permissionPhrase).toContain(phrase);
    }
  });

  it("names the year on the trend and per-capita cards only", () => {
    const section = page.slice(page.indexOf("## Insights and analytics"), page.indexOf("## Vacant pulpits"));
    expect(section).toContain(
      'The "Ending active members" and "Per capita" cards name the year they show. "Member congregations", "Vacant pulpits" and "Viability" show how things stand today.',
    );
    expect(section).not.toContain("Each card says which year it shows");
  });
});
