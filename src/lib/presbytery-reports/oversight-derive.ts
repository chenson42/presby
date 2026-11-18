/**
 * The Buildings and Insurance-and-loans reports' derivation rules (DECISION-348;
 * docs/work-log/2026-11-17-congregation-profile.md, Phase 3 C15). PURE: no
 * database, no clock (`today` is injected), so the rules are tested with plain
 * values. The readers fetch facts (`src/lib/oversight/report-rows.ts`); this
 * file decides what they mean; `csv.ts` and the views render the result, so a
 * page and its file cannot disagree.
 *
 * Three rules every function here keeps:
 *   - the roster decides who is in the report and in what order (active
 *     member congregations, `roster.ts`); a fact about any other organization
 *     is ignored, never shown;
 *   - a figure that is not recorded is `null`, NEVER zero, and a sum of
 *     figures leaves the unrecorded ones out and COUNTS them, so the page can
 *     say "{n} not recorded" beside the total;
 *   - a date-only value (`YYYY-MM-DD`) stays text (the timezone-safe-dates
 *     lesson).
 */
import { expiryState, loanTotals, type ExpiryState } from "@/lib/oversight/derive";
import type {
  AppraisalReportFact,
  BuildingReportFact,
  BuildingsReportFacts,
  InsuranceLoansReportFacts,
} from "@/lib/oversight/report-facts";
import type { RosterEntry } from "./derive";

function addSafe(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new RangeError("a report total is not a safe integer");
  return sum;
}

/** The sum of the recorded figures, or null when none is recorded (never a false zero). */
function sumRecorded(values: ReadonlyArray<number | null>): number | null {
  let sum: number | null = null;
  for (const value of values) if (value !== null) sum = sum === null ? value : addSafe(sum, value);
  return sum;
}

function groupBy<T extends { aboutOrgId: string }>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.aboutOrgId);
    if (list) list.push(item);
    else map.set(item.aboutOrgId, [item]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/** One in-use building's report columns (`aboutOrgId` is the row's `organizationId`). */
export type BuildingReportItem = BuildingReportFact;

/**
 * One line per in-use building; a congregation with none in use has exactly one line with
 * `building: null` (the page says "None recorded", the file leaves the building cells empty).
 */
export interface BuildingsRow {
  organizationId: string;
  name: string;
  /** The profile's city and county (tier 1), or null when not recorded. */
  city: string | null;
  county: string | null;
  building: BuildingReportItem | null;
}

export interface BuildingsData {
  rosterCount: number;
  /** In roster order (name, then id); within a congregation the primary first, then by building name. */
  rows: BuildingsRow[];
  /** Congregations with no building in use recorded (their one line has `building: null`). */
  withoutBuildings: number;
  /** Buildings across all congregations. */
  buildingCount: number;
}

function compareBuildings(a: BuildingReportFact, b: BuildingReportFact): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  return byName !== 0 ? byName : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function deriveBuildings(roster: readonly RosterEntry[], facts: BuildingsReportFacts): BuildingsData {
  const profiles = new Map(facts.profiles.map((p) => [p.aboutOrgId, p]));
  const buildings = groupBy(facts.buildings);
  const rows: BuildingsRow[] = [];
  let withoutBuildings = 0;
  let buildingCount = 0;
  for (const congregation of roster) {
    const profile = profiles.get(congregation.id);
    const base = {
      organizationId: congregation.id,
      name: congregation.name,
      city: profile?.city ?? null,
      county: profile?.county ?? null,
    };
    const own = [...(buildings.get(congregation.id) ?? [])].sort(compareBuildings);
    if (own.length === 0) {
      withoutBuildings += 1;
      rows.push({ ...base, building: null });
      continue;
    }
    buildingCount += own.length;
    for (const building of own) rows.push({ ...base, building });
  }
  return { rosterCount: roster.length, rows, withoutBuildings, buildingCount };
}

// ---------------------------------------------------------------------------
// Insurance and loans
// ---------------------------------------------------------------------------

/** The congregation's newest policy year. No policy number and no note, by construction. */
export interface InsuranceSummary {
  policyYear: number;
  carrier: string | null;
  policyExpiresOn: string | null;
  /** "none" when no expiry is recorded, "expired" when it is before `today`; today itself is "current". */
  expiry: ExpiryState;
  recentClaims: boolean | null;
  poolInterest: boolean | null;
}

export interface InsuranceLoansRow {
  organizationId: string;
  name: string;
  /** Null when no live policy year is recorded. */
  insurance: InsuranceSummary | null;
  openLoans: number;
  /** Sums of the RECORDED figures of the open loans; null when none is recorded (never a false zero). */
  originalCents: number | null;
  balanceCents: number | null;
  grantsCents: number | null;
  /** How many open loans have no such figure recorded ("{n} not recorded" beside the total). */
  originalUnrecorded: number;
  balanceUnrecorded: number;
  grantsUnrecorded: number;
  /** The guarantee text of each open loan that has one (trimmed, non-empty), in the order the loans were recorded. */
  guarantees: string[];
  /** The sum of each in-use building's newest appraisal; null when none of its buildings has one. */
  appraisedCents: number | null;
  /** In-use buildings with no appraisal recorded (0 when the congregation has no building in use). */
  buildingsWithoutAppraisal: number;
}

export interface InsuranceLoansTotals {
  openLoans: number;
  originalCents: number | null;
  balanceCents: number | null;
  grantsCents: number | null;
  originalUnrecorded: number;
  balanceUnrecorded: number;
  grantsUnrecorded: number;
  appraisedCents: number | null;
  buildingsWithoutAppraisal: number;
}

export interface InsuranceLoansData {
  /** The organization's local date (`YYYY-MM-DD`), the day "expired" is measured against. */
  today: string;
  rosterCount: number;
  /** In roster order (name, then id): every active member congregation, with or without records. */
  rows: InsuranceLoansRow[];
  totals: InsuranceLoansTotals;
}

export function deriveInsuranceLoans(roster: readonly RosterEntry[], facts: InsuranceLoansReportFacts, today: string): InsuranceLoansData {
  const insuranceBy = new Map(facts.insurance.map((i) => [i.aboutOrgId, i]));
  const loansBy = groupBy(facts.openLoans);
  const buildingsBy = groupBy(facts.buildings);
  const appraisalsBy = groupBy<AppraisalReportFact>(facts.appraisals);

  const rows: InsuranceLoansRow[] = roster.map((congregation) => {
    const policy = insuranceBy.get(congregation.id);
    const loans = loansBy.get(congregation.id) ?? [];
    const totals = loanTotals(loans);

    // An appraisal counts only for a building the congregation has in use.
    const inUse = new Set((buildingsBy.get(congregation.id) ?? []).map((b) => b.id));
    const appraised = (appraisalsBy.get(congregation.id) ?? []).filter((a) => inUse.has(a.buildingId));
    const appraisedIds = new Set(appraised.map((a) => a.buildingId));

    const guarantees: string[] = [];
    for (const loan of loans) {
      const text = loan.guaranteeNote?.trim() ?? "";
      if (text !== "") guarantees.push(text);
    }

    return {
      organizationId: congregation.id,
      name: congregation.name,
      insurance: policy
        ? {
            policyYear: policy.policyYear,
            carrier: policy.carrier,
            policyExpiresOn: policy.policyExpiresOn,
            expiry: expiryState(policy.policyExpiresOn, today),
            recentClaims: policy.recentClaims,
            poolInterest: policy.poolInterest,
          }
        : null,
      openLoans: loans.length,
      originalCents: totals.originalCents,
      balanceCents: totals.balanceCents,
      grantsCents: totals.grantsCents,
      originalUnrecorded: totals.originalUnrecorded,
      balanceUnrecorded: totals.balanceUnrecorded,
      grantsUnrecorded: totals.grantsUnrecorded,
      guarantees,
      appraisedCents: sumRecorded(appraised.map((a) => a.amountCents)),
      buildingsWithoutAppraisal: inUse.size - appraisedIds.size,
    };
  });

  const sum = (pick: (row: InsuranceLoansRow) => number | null) => sumRecorded(rows.map(pick));
  const count = (pick: (row: InsuranceLoansRow) => number) => rows.reduce((acc, row) => addSafe(acc, pick(row)), 0);
  return {
    today,
    rosterCount: roster.length,
    rows,
    totals: {
      openLoans: count((r) => r.openLoans),
      originalCents: sum((r) => r.originalCents),
      balanceCents: sum((r) => r.balanceCents),
      grantsCents: sum((r) => r.grantsCents),
      originalUnrecorded: count((r) => r.originalUnrecorded),
      balanceUnrecorded: count((r) => r.balanceUnrecorded),
      grantsUnrecorded: count((r) => r.grantsUnrecorded),
      appraisedCents: sum((r) => r.appraisedCents),
      buildingsWithoutAppraisal: count((r) => r.buildingsWithoutAppraisal),
    },
  };
}
