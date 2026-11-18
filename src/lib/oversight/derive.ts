/**
 * Pure derivations over the congregation records (docs/work-log/2026-11-17-
 * congregation-profile.md, Phase 3 "Module and file plan" and Copy C1, C5 to C8).
 * No imports from the database, no clock: `today` is injected, so "Expired" and
 * the newest-year rules are testable with plain strings.
 *
 * Two rules every function here keeps: a figure that is not recorded is NEVER
 * shown as zero ("Not recorded"), and a date-only value (`YYYY-MM-DD`) is
 * compared and kept as text, never turned into a `Date` (the timezone-safe-dates
 * lesson).
 */
import { BUILDING_TYPES, CONDITIONS, type BuildingType, type Condition } from "./contract";
import { STATE } from "./copy";

// ---------------------------------------------------------------------------
// Insurance expiry (C1 T8, C7)
// ---------------------------------------------------------------------------

export type ExpiryState = "none" | "current" | "expired";

/** Today is not expired; yesterday is. Both are `YYYY-MM-DD` in the organization's local calendar. */
export function expiryState(expiresOn: string | null, today: string): ExpiryState {
  if (expiresOn === null) return "none";
  return expiresOn < today ? "expired" : "current";
}

/** The list's insurance cell: the date and whether it is "Expired {date}", or "Not recorded". */
export function insuranceExpiryCell(
  expiresOn: string | null,
  today: string,
): { kind: "none" } | { kind: "current" | "expired"; date: string } {
  const state = expiryState(expiresOn, today);
  if (state === "none") return { kind: "none" };
  return { kind: state, date: expiresOn! };
}

/**
 * The newest policy year's expiry (T8): the highest `policyYear` among the rows
 * given (the caller passes live rows), never "soonest of all years". Null when
 * there are no rows or that year has no expiry recorded.
 */
export function newestInsuranceExpiry(rows: ReadonlyArray<{ policyYear: number; policyExpiresOn: string | null }>): string | null {
  let best: { policyYear: number; policyExpiresOn: string | null } | null = null;
  for (const row of rows) if (best === null || row.policyYear > best.policyYear) best = row;
  return best?.policyExpiresOn ?? null;
}

// ---------------------------------------------------------------------------
// Buildings (C1, C5)
// ---------------------------------------------------------------------------

/** "{n} building" / "{n} buildings", or "Not recorded" when there are none. */
export function buildingsInUseLabel(count: number): string {
  if (count <= 0) return STATE.notRecorded;
  return count === 1 ? "1 building" : `${count} buildings`;
}

/** The card's two optional lines: "Built {year}" and "{n} square feet", each only when recorded. */
export function buildingSummary(building: { yearBuilt: number | null; squareFeet: number | null }): string[] {
  const lines: string[] = [];
  if (building.yearBuilt !== null) lines.push(`Built ${building.yearBuilt}`);
  if (building.squareFeet !== null) lines.push(`${formatInteger(building.squareFeet)} square feet`);
  return lines;
}

export function formatBuildingType(type: BuildingType): string {
  return BUILDING_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function formatCondition(condition: Condition | null): string {
  if (condition === null) return STATE.notRecorded;
  return CONDITIONS.find((c) => c.value === condition)?.label ?? STATE.notRecorded;
}

/** Yes / No / Not recorded for a nullable boolean (T2). */
export function formatTriState(value: boolean | null): string {
  if (value === null) return STATE.notRecorded;
  return value ? "Yes" : "No";
}

/** The additions line: "First addition {year}; second addition {year}", or "Not recorded". */
export function additionsLabel(first: number | null, second: number | null): string {
  const parts: string[] = [];
  if (first !== null) parts.push(`First addition ${first}`);
  if (second !== null) parts.push(`${parts.length === 0 ? "Second" : "second"} addition ${second}`);
  return parts.length === 0 ? STATE.notRecorded : parts.join("; ");
}

// ---------------------------------------------------------------------------
// Appraisals (C6)
// ---------------------------------------------------------------------------

/** The newest assessed year wins ("Current"); null when there are none. */
export function latestAppraisal<T extends { assessedYear: number }>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) if (best === null || row.assessedYear > best.assessedYear) best = row;
  return best;
}

// ---------------------------------------------------------------------------
// Loans (C8)
// ---------------------------------------------------------------------------

export interface LoanTotals {
  /** The sum of the recorded figures, or null when none is recorded (never a false zero). */
  balanceCents: number | null;
  originalCents: number | null;
  grantsCents: number | null;
  /** How many of the loans given have no figure recorded. */
  balanceUnrecorded: number;
  originalUnrecorded: number;
  grantsUnrecorded: number;
}

function sumRecorded(values: ReadonlyArray<number | null>): { sum: number | null; unrecorded: number } {
  let sum: number | null = null;
  let unrecorded = 0;
  for (const value of values) {
    if (value === null) unrecorded += 1;
    else sum = (sum ?? 0) + value;
  }
  return { sum, unrecorded };
}

/** Sums only what is recorded and counts what is not. The caller decides which loans (open, live). */
export function loanTotals(
  loans: ReadonlyArray<{
    currentBalanceCents: number | null;
    originalAmountCents: number | null;
    grantsAmountCents: number | null;
  }>,
): LoanTotals {
  const balance = sumRecorded(loans.map((l) => l.currentBalanceCents));
  const original = sumRecorded(loans.map((l) => l.originalAmountCents));
  const grants = sumRecorded(loans.map((l) => l.grantsAmountCents));
  return {
    balanceCents: balance.sum,
    originalCents: original.sum,
    grantsCents: grants.sum,
    balanceUnrecorded: balance.unrecorded,
    originalUnrecorded: original.unrecorded,
    grantsUnrecorded: grants.unrecorded,
  };
}

// ---------------------------------------------------------------------------
// Money and numbers
// ---------------------------------------------------------------------------

/** 1250000 -> "1,250,000". */
export function formatInteger(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Integer cents to "$1,250,000" (no cents when whole) or "$1,250,000.50"; "$0" for exactly zero. */
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const body = formatInteger(dollars) + (remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`);
  return `${negative ? "-" : ""}$${body}`;
}

/** Cents to the plain text a money field shows: "1250000" or "1250000.50" (no symbol, no commas). */
export function centsToInputText(cents: number | null): string {
  if (cents === null) return "";
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return remainder === 0 ? String(dollars) : `${dollars}.${String(remainder).padStart(2, "0")}`;
}
