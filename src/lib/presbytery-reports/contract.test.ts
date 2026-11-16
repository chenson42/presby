import { describe, expect, it } from "vitest";
import { isUuid } from "@/lib/is-uuid";
import { REPORT_KEYS, REPORT_ORG_TYPES, REPORTS, REPORTS_FLAG, REPORT_SEGMENTS, reportByKey } from "./contract";

const FOUR_KEYS = ["credentials.manage", "statistics.manage", "congregation_oversight.manage", "per_capita.manage"];

describe("the report registry", () => {
  it("has one entry per report key, in the hub's order", () => {
    expect(REPORTS.map((r) => r.key)).toEqual([...REPORT_KEYS]);
    expect(REPORT_KEYS).toEqual(["vacant_pulpits", "membership_trend", "viability", "per_capita"]);
  });

  it("no segment can collide with the sibling [aboutOrgId] (every segment fails isUuid)", () => {
    for (const segment of REPORT_SEGMENTS) expect(isUuid(segment)).toBe(false);
  });

  it("segments, keys, titles and filename bases are unique", () => {
    for (const field of ["segment", "key", "title", "filenameBase", "permission"] as const) {
      const values = REPORTS.map((r) => r[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("each report is gated by one of the four existing keys, none shared, no umbrella key", () => {
    expect(REPORTS.map((r) => r.permission).sort()).toEqual([...FOUR_KEYS].sort());
    expect(REPORTS.some((r) => /reports\./.test(r.permission))).toBe(false);
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
