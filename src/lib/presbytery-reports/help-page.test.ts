import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
});
