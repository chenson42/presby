/**
 * U4: the contract's closed lists, limits and field names equal the CHECK lists
 * and `char_length` bounds PARSED OUT OF the migration (docs/work-log/
 * 2026-11-17-congregation-profile.md, Phase 3 "Test plan"). A list changed in one
 * place and not the other fails here. No database: the migration is read as text.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// Enter the domain cycle through the canonical entry point first (see oversight.db.test.ts);
// ./oversight is re-exported from domain/index.ts only at integration (Rule 16).
import "@/lib/db/schema";
import {
  OVERSIGHT_BUILDING_TYPES,
  OVERSIGHT_CONDITIONS,
  OVERSIGHT_LOAN_KINDS,
  OVERSIGHT_LOAN_STATUSES,
  OVERSIGHT_MONEY_MAX_CENTS,
  OVERSIGHT_PROVENANCES,
  OVERSIGHT_RETIRE_REASONS,
} from "@/lib/db/domain/oversight";
import {
  BUILDING_TYPES,
  CHANGED_FIELDS,
  CONDITIONS,
  LIMITS,
  LOAN_KINDS,
  LOAN_STATUSES,
  OVERSIGHT_FINANCE_KEY,
  OVERSIGHT_MANAGE_KEY,
  PROVENANCES,
  RETIRE_REASONS,
  TRI_STATE_VALUES,
  valuesOf,
} from "./contract";

const SQL = readFileSync(path.join(__dirname, "../../../drizzle/0089_presby_oversight_records.sql"), "utf8");

/** The values of the first `check (<column> ... in (...))` whose text names the column. */
function listFor(column: string, table: string): string[] {
  const re = new RegExp(`add constraint\\s+${table}_[a-z_]+\\s+check\\s*\\(([^;]*?\\b${column}\\b[^;]*?\\bin\\s*\\(([^)]*)\\)[^;]*?)\\);`, "is");
  const m = re.exec(SQL);
  if (!m) throw new Error(`no CHECK list for ${table}.${column} in 0089`);
  return [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

/** `check (<col> is null or char_length(<col>) <= N)` or `between 1 and N`. */
function lengthFor(table: string, column: string): number {
  const re = new RegExp(`add constraint\\s+${table}_${column}_length\\s+check\\s*\\([^;]*?char_length\\(${column}\\)\\s*(?:<=|between 1 and)\\s*(\\d+)`, "is");
  const m = re.exec(SQL);
  if (!m) throw new Error(`no length CHECK for ${table}.${column} in 0089`);
  return Number(m[1]);
}

function rangeFor(table: string, constraint: string): [number, number] {
  const re = new RegExp(`add constraint\\s+${table}_${constraint}\\s+check\\s*\\([^;]*?between\\s+(\\d+)\\s+and\\s+(\\d+)`, "is");
  const m = re.exec(SQL);
  if (!m) throw new Error(`no range CHECK ${table}_${constraint} in 0089`);
  return [Number(m[1]), Number(m[2])];
}

describe("the contract equals the migration", () => {
  it("the closed lists", () => {
    expect(valuesOf(BUILDING_TYPES)).toEqual(listFor("building_type", "oversight_buildings"));
    expect(valuesOf(RETIRE_REASONS)).toEqual(listFor("retired_reason", "oversight_buildings"));
    expect(valuesOf(LOAN_KINDS)).toEqual(listFor("kind", "oversight_loans"));
    expect(valuesOf(LOAN_STATUSES)).toEqual(listFor("status", "oversight_loans"));
    for (const col of ["roof_condition", "plumbing_condition", "hvac_condition", "boiler_condition"]) {
      expect(valuesOf(CONDITIONS), col).toEqual(listFor(col, "oversight_buildings"));
    }
    for (const table of ["oversight_profiles", "oversight_buildings", "oversight_building_appraisals", "oversight_insurance_years", "oversight_loans"]) {
      expect([...PROVENANCES], table).toEqual(listFor("provenance", table));
    }
  });

  it("the contract's lists equal the Drizzle mirror's (the other place a list lives)", () => {
    expect(valuesOf(BUILDING_TYPES)).toEqual([...OVERSIGHT_BUILDING_TYPES]);
    expect(valuesOf(CONDITIONS)).toEqual([...OVERSIGHT_CONDITIONS]);
    expect(valuesOf(RETIRE_REASONS)).toEqual([...OVERSIGHT_RETIRE_REASONS]);
    expect(valuesOf(LOAN_KINDS)).toEqual([...OVERSIGHT_LOAN_KINDS]);
    expect(valuesOf(LOAN_STATUSES)).toEqual([...OVERSIGHT_LOAN_STATUSES]);
    expect([...PROVENANCES]).toEqual([...OVERSIGHT_PROVENANCES]);
    expect(LIMITS.moneyMaxCents).toBe(OVERSIGHT_MONEY_MAX_CENTS);
  });

  it("the char_length bounds", () => {
    expect(lengthFor("oversight_profiles", "street_address")).toBe(LIMITS.addressMax);
    expect(lengthFor("oversight_profiles", "city")).toBe(LIMITS.cityMax);
    expect(lengthFor("oversight_profiles", "county")).toBe(LIMITS.countyMax);
    expect(lengthFor("oversight_profiles", "phone")).toBe(LIMITS.phoneMax);
    expect(lengthFor("oversight_buildings", "name")).toBe(LIMITS.buildingNameMax);
    expect(lengthFor("oversight_buildings", "notes")).toBe(LIMITS.buildingNotesMax);
    expect(lengthFor("oversight_building_photos", "caption")).toBe(LIMITS.captionMax);
    expect(lengthFor("oversight_building_appraisals", "notes")).toBe(LIMITS.appraisalNotesMax);
    expect(lengthFor("oversight_insurance_years", "carrier")).toBe(LIMITS.carrierMax);
    expect(lengthFor("oversight_insurance_years", "policy_number")).toBe(LIMITS.policyNumberMax);
    expect(lengthFor("oversight_insurance_years", "notes")).toBe(LIMITS.insuranceNotesMax);
    expect(lengthFor("oversight_loans", "lender")).toBe(LIMITS.lenderMax);
    expect(lengthFor("oversight_loans", "guarantee_note")).toBe(LIMITS.guaranteeNoteMax);
    expect(lengthFor("oversight_loans", "notes")).toBe(LIMITS.loanNotesMax);
    expect(lengthFor("oversight_buildings", "name")).toBeGreaterThan(0);
  });

  it("the year, area and money ranges", () => {
    expect(rangeFor("oversight_profiles", "year_organized_range")).toEqual([LIMITS.yearMin, LIMITS.yearMax]);
    expect(rangeFor("oversight_buildings", "year_built_range")).toEqual([LIMITS.yearMin, LIMITS.yearMax]);
    expect(rangeFor("oversight_buildings", "first_addition_year_range")).toEqual([LIMITS.yearMin, LIMITS.yearMax]);
    expect(rangeFor("oversight_buildings", "second_addition_year_range")).toEqual([LIMITS.yearMin, LIMITS.yearMax]);
    expect(rangeFor("oversight_buildings", "square_feet_range")).toEqual([LIMITS.squareFeetMin, LIMITS.squareFeetMax]);
    expect(rangeFor("oversight_building_appraisals", "assessed_year_range")).toEqual([LIMITS.yearMin, LIMITS.yearMax]);
    expect(rangeFor("oversight_insurance_years", "policy_year_range")).toEqual([LIMITS.policyYearMin, LIMITS.policyYearMax]);
    for (const [table, c] of [
      ["oversight_building_appraisals", "amount_range"],
      ["oversight_loans", "original_amount_range"],
      ["oversight_loans", "current_balance_range"],
      ["oversight_loans", "grants_amount_range"],
    ] as const) {
      expect(rangeFor(table, c), c).toEqual([0, LIMITS.moneyMaxCents]);
    }
  });

  it("the two permission keys are the ones 0089 creates", () => {
    expect(SQL).toContain(`'${OVERSIGHT_FINANCE_KEY}'`);
    expect(SQL).toContain(`'${OVERSIGHT_MANAGE_KEY}'`);
    expect(OVERSIGHT_MANAGE_KEY).toBe("congregation_oversight.manage");
    expect(OVERSIGHT_FINANCE_KEY).toBe("congregation_oversight.finance");
  });

  it("the tri-state values and the changed-field names are closed and duplicate-free", () => {
    expect([...TRI_STATE_VALUES]).toEqual(["", "yes", "no"]);
    expect(new Set(CHANGED_FIELDS).size).toBe(CHANGED_FIELDS.length);
    // A field NAME, never a value: no name looks like an amount, a number or free text.
    for (const name of CHANGED_FIELDS) expect(name).toMatch(/^[a-z][A-Za-z]+$/);
  });
});
