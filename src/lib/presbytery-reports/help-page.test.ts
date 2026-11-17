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

  it("documents the map (DECISION-343): where, who, the pin shapes, the phone gesture, and the oversight permission", () => {
    const start = page.indexOf("## The viability map");
    const section = page.slice(start, page.indexOf("## Vacant pulpits"));
    expect(start).toBeGreaterThan(page.indexOf("## Insights and analytics"));
    const oversight = REPORTS.find((r) => r.key === "viability")!.permissionPhrase;
    expect(section).toContain(`permission to ${oversight}`);
    for (const word of ["diamond", "square", "circle", "hollow circle", "Not on the map", "Open oversight page", "two fingers", "The map could not load", "/help/privacy-policy"]) {
      expect(section, word).toContain(word);
    }
  });

  it("documents entering a location: Map location, latitude first, a negative US longitude, both or neither, 0 and 0", () => {
    const start = page.indexOf("## Putting a congregation on the map");
    const section = page.slice(start, page.indexOf("## Per capita"));
    expect(start).toBeGreaterThan(page.indexOf("## Viability"));
    for (const text of ["Map location", "Latitude", "Longitude", "negative longitude", "Enter both numbers or neither", "0 and 0", "paste it into either box"]) {
      expect(section, text).toContain(text);
    }
  });

  it("still says the CSV holds no coordinates (the viability read for the file never reads them)", () => {
    expect(page).toMatch(/holds no email addresses, street addresses, coordinates or people's names/);
  });
});
