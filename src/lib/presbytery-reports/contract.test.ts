import { describe, expect, it } from "vitest";
import { isUuid } from "@/lib/is-uuid";
import {
  DASHBOARD_REPORT_KEYS,
  REPORT_KEYS,
  REPORT_ORG_TYPES,
  REPORTS,
  REPORTS_FLAG,
  REPORT_SEGMENTS,
  reportByKey,
} from "./contract";

const FOUR_KEYS = ["credentials.manage", "statistics.manage", "congregation_oversight.manage", "per_capita.manage"];
/** The six reports' keys: the four plus the Congregation Oversight finance key (DECISION-345, 348). */
const SIX_PERMISSIONS = [...FOUR_KEYS, "congregation_oversight.finance"];

describe("the report registry", () => {
  it("has one entry per report key, in the hub's order", () => {
    expect(REPORTS.map((r) => r.key)).toEqual([...REPORT_KEYS]);
    expect(REPORT_KEYS).toEqual([
      "vacant_pulpits",
      "membership_trend",
      "viability",
      "per_capita",
      "buildings",
      "insurance_and_loans",
    ]);
  });

  it("no segment can collide with the sibling [aboutOrgId] (every segment fails isUuid)", () => {
    for (const segment of REPORT_SEGMENTS) expect(isUuid(segment)).toBe(false);
  });

  it("segments, keys, titles and filename bases are unique", () => {
    for (const field of ["segment", "key", "title", "filenameBase"] as const) {
      const values = REPORTS.map((r) => r[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("each report is gated by an existing key, no umbrella key; only Viability and Buildings share one (manage)", () => {
    expect(new Set(REPORTS.map((r) => r.permission))).toEqual(new Set(SIX_PERMISSIONS));
    expect(REPORTS.some((r) => /reports\./.test(r.permission))).toBe(false);
    const shared = REPORTS.filter((r) => REPORTS.filter((o) => o.permission === r.permission).length > 1).map((r) => r.key);
    expect(shared.sort()).toEqual(["buildings", "viability"]);
  });

  it("Buildings is tier 1 (manage) and Insurance and loans is tier 2 (finance), by segment, title and phrase (DECISION-348)", () => {
    expect(reportByKey("buildings")).toMatchObject({
      segment: "buildings",
      title: "Buildings",
      permission: "congregation_oversight.manage",
      permissionPhrase: "manage congregation oversight",
      filenameBase: "buildings",
    });
    expect(reportByKey("insurance_and_loans")).toMatchObject({
      segment: "insurance-and-loans",
      title: "Insurance and loans",
      permission: "congregation_oversight.finance",
      permissionPhrase: "manage congregation property finances",
      filenameBase: "insurance-and-loans",
    });
  });

  it("the dashboard keeps its four keys: neither new report is one of them (no dashboard card)", () => {
    expect([...DASHBOARD_REPORT_KEYS]).toEqual(["vacant_pulpits", "membership_trend", "viability", "per_capita"]);
    for (const key of DASHBOARD_REPORT_KEYS) expect(REPORT_KEYS).toContain(key);
    expect(DASHBOARD_REPORT_KEYS.map((k) => reportByKey(k).permission).sort()).toEqual([...FOUR_KEYS].sort());
  });

  it("segments are kebab-case", () => {
    for (const segment of REPORT_SEGMENTS) expect(segment).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("names the existing flag and admits presbyteries only", () => {
    expect(REPORTS_FLAG).toBe("org_portal.reports");
    expect([...REPORT_ORG_TYPES]).toEqual(["presbytery"]);
  });

  it("reportByKey finds each and throws on an unknown key", () => {
    for (const r of REPORTS) expect(reportByKey(r.key)).toBe(r);
    expect(() => reportByKey("nope" as never)).toThrow();
  });
});
