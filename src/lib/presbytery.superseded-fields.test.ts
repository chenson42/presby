/**
 * U10 (source half): the superseded `congregation_oversight.insurance_carrier` and
 * `insurance_expires_on` are no longer read or written by `src/lib/presbytery.ts`
 * (docs/work-log/2026-11-17-congregation-profile.md, R8, DECISION-347; F451 on the
 * write side, F454 on the read side). The columns stay in the table, dormant; the
 * database half (a legacy row survives a save, and neither reader returns it) is
 * `presbytery.test.ts`, which needs a database. This half runs everywhere.
 *
 * Also pinned: both oversight readers name their columns (a bare `select()` reads
 * every column, the superseded two included, under the tier-1 key), and
 * `src/lib/presbytery.ts` names none of the six new oversight tables (R4).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(path.join(__dirname, "presbytery.ts"), "utf8");
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The text of one exported function, from its signature to the next top-level export. */
function bodyOf(name: string): string {
  const start = code.indexOf(`export async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const next = code.indexOf("\nexport ", start + 10);
  return code.slice(start, next < 0 ? undefined : next);
}

describe("presbytery.ts and the superseded oversight fields (F451, F454)", () => {
  it("neither insuranceCarrier nor insuranceExpiresOn appears in code, and neither does the snake_case column", () => {
    expect(code).not.toMatch(/\binsuranceCarrier\b/);
    expect(code).not.toMatch(/\binsuranceExpiresOn\b/);
    expect(code).not.toMatch(/insurance_carrier|insurance_expires_on/);
  });

  it("neither oversight reader uses a bare select() (an explicit column list, so the superseded columns are never read)", () => {
    for (const name of ["getCongregationOversightList", "getCongregationOversightDetail"]) {
      const body = bodyOf(name);
      expect(body, name).not.toMatch(/\.select\(\s*\)/);
      expect(body, name).toMatch(/\.select\(\{/);
    }
  });

  it("the write names no carrier, expiry or free-form insurance value, and the notes message is the renamed one", () => {
    const set = bodyOf("setCongregationOversight");
    expect(set).not.toMatch(/insurance/i);
    expect(set).toContain("Property notes must be");
    expect(set).not.toContain("Buildings notes must be");
  });

  it("resolveMemberCongregation and listMemberCongregations are exported (the one roster the record surface uses)", () => {
    expect(code).toMatch(/export async function resolveMemberCongregation\(/);
    expect(code).toMatch(/export async function listMemberCongregations\(/);
  });

  it("presbytery.ts names none of the six new oversight tables (R4): they belong to src/lib/oversight/", () => {
    expect(code).not.toMatch(
      /\boversight_(profiles|buildings|building_photos|building_appraisals|insurance_years|loans)\b|\boversight(Profiles|Buildings|BuildingPhotos|BuildingAppraisals|InsuranceYears|Loans)\b/,
    );
  });

  it("the scan reads real code: the legacy table is still named (a vacuous scan would pass the rules above)", () => {
    expect(code).toMatch(/congregationOversight/);
    expect(code).toMatch(/setCongregationOversight/);
  });
});
