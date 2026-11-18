/**
 * The six presbytery report CSV writers - docs/work-log/2026-11-15-presbytery-reports.md
 * (Phase 3 "CSV headers, exactly"). PURE. Every builder takes the same `data`
 * its reader hands the page, so the file is the table as shown.
 *
 * Rules (Phase 1 and 2):
 *   - every TEXT cell goes through `csvTextCell` (formula guard + RFC 4180
 *     quoting): congregation names are written by other tenants and by
 *     platform admins, notes by the presbytery;
 *   - every INTEGER goes through `csvIntegerCell`, never the text guard, so a
 *     count or year stays a number;
 *   - money is integer cents rendered by `centsToDecimal`, so an overpayment is
 *     `-12.00`, not text;
 *   - the whole file is assembled with `joinCsvLines` (CRLF, every line);
 *   - a UTF-8 byte-order mark is prepended HERE, for these six files only, so
 *     Excel shows accented names; `joinCsvLines` and the giving and
 *     reimbursement writers are untouched and carry no BOM.
 * Nothing is concatenated by hand: no `.join(",")` appears outside this file.
 */

import { centsToDecimal, csvIntegerCell, csvTextCell, joinCsvLines } from "@/lib/csv";
import { PER_CAPITA_COPY, SUPPLY_CALL_TYPE_LABELS } from "./copy";
import type { MembershipTrendData, PerCapitaData, ViabilityData, VacantPulpitsData } from "./derive";
import type { Condition } from "@/lib/oversight/contract";
import { formatBuildingType, formatCondition } from "@/lib/oversight/derive";
import type { BuildingsData, InsuranceLoansData } from "./oversight-derive";

export const CSV_BOM = "﻿";

export const VACANT_PULPITS_HEADER = [
  "congregation",
  "vacant_since",
  "days_vacant",
  "supply_call_type",
  "supply_starts_on",
] as const;

export const MEMBERSHIP_TREND_HEADER = ["congregation", "year", "ending_active", "source"] as const;

export const VIABILITY_HEADER = [
  "congregation",
  "viability_label",
  "viability_score_1_at_risk_3_healthy",
  "redevelopment_notes",
  "last_updated",
] as const;

export const PER_CAPITA_HEADER = [
  "billing_year",
  "congregation",
  "membership",
  "basis_year",
  "ending_active_basis",
  "rate_per_member",
  "billed",
  "paid",
  "outstanding",
  "payment_status",
  "paid_on",
  "note",
] as const;

/**
 * Buildings (DECISION-348): one line per in-use building, and one line with only the
 * congregation (and its city and county) for a congregation with none. NEVER in this
 * file: a street address or a note.
 */
export const BUILDINGS_HEADER = [
  "congregation",
  "city",
  "county",
  "building",
  "building_type",
  "year_built",
  "first_addition_year",
  "second_addition_year",
  "square_feet",
  "roof_condition",
  "plumbing_condition",
  "hvac_condition",
  "boiler_condition",
  "sprinklers",
  "fire_alarm",
  "security_system",
  "primary",
] as const;

/**
 * Insurance and loans (DECISION-348): one line per active member congregation. Amounts are
 * decimal dollars; a sum that leaves unrecorded figures out says how many it left out
 * (`balance_unrecorded_loans`). NEVER in this file: a policy number, a lender, a street
 * address or a note. `guarantee` is the loans' guarantee text (the one free-text column the
 * design admits, R7), through the formula guard.
 */
export const INSURANCE_LOANS_HEADER = [
  "congregation",
  "carrier",
  "policy_year",
  "policy_expires_on",
  "recent_claims",
  "pool_interest",
  "open_loans",
  "original_amount",
  "balance",
  "balance_unrecorded_loans",
  "grants",
  "guarantee",
  "appraised_value",
  "buildings_without_appraisal",
] as const;

function line(cells: readonly string[]): string {
  return cells.join(",");
}

function file(header: readonly string[], lines: readonly string[]): string {
  return `${CSV_BOM}${joinCsvLines(header, lines)}`;
}

export function buildVacantPulpitsCsv(data: VacantPulpitsData): string {
  const lines = data.rows.map((row) =>
    line([
      csvTextCell(row.name),
      csvTextCell(row.vacantSince),
      csvIntegerCell(row.daysVacant),
      csvTextCell(row.supply ? labelOfSupply(row.supply.callType) : null),
      csvTextCell(row.supply?.startsOn ?? null),
    ]),
  );
  return file(VACANT_PULPITS_HEADER, lines);
}

function labelOfSupply(callType: string): string {
  const label = SUPPLY_CALL_TYPE_LABELS[callType];
  if (!label) throw new RangeError(`not a supply call type: ${callType}`);
  return label;
}

export function buildMembershipTrendCsv(data: MembershipTrendData): string {
  const lines: string[] = [];
  for (const row of data.rows) {
    data.years.forEach((year, i) => {
      const cell = row.cells[i];
      if (cell.kind === "not_member") return; // outside the affiliation window: no row
      lines.push(
        line([
          csvTextCell(row.name),
          csvIntegerCell(year),
          csvIntegerCell(cell.kind === "value" ? cell.endingActive : null),
          csvTextCell(cell.kind === "value" ? cell.source : "no_data"),
        ]),
      );
    });
  }
  return file(MEMBERSHIP_TREND_HEADER, lines);
}

export function buildViabilityCsv(data: ViabilityData): string {
  const lines = data.rows.map((row) =>
    line([
      csvTextCell(row.name),
      csvTextCell(row.label),
      csvIntegerCell(row.score),
      csvTextCell(row.notes),
      csvTextCell(row.lastUpdated),
    ]),
  );
  return file(VIABILITY_HEADER, lines);
}

/** Yes / No, and an empty cell for "not recorded" (a file never says "Not recorded" in a column). */
function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value ? "Yes" : "No";
}

export function buildBuildingsCsv(data: BuildingsData): string {
  const lines = data.rows.map((row) => {
    const b = row.building;
    return line([
      csvTextCell(row.name),
      csvTextCell(row.city),
      csvTextCell(row.county),
      csvTextCell(b?.name ?? null),
      csvTextCell(b ? formatBuildingType(b.buildingType) : null),
      csvIntegerCell(b?.yearBuilt ?? null),
      csvIntegerCell(b?.firstAdditionYear ?? null),
      csvIntegerCell(b?.secondAdditionYear ?? null),
      csvIntegerCell(b?.squareFeet ?? null),
      csvTextCell(conditionText(b?.roofCondition)),
      csvTextCell(conditionText(b?.plumbingCondition)),
      csvTextCell(conditionText(b?.hvacCondition)),
      csvTextCell(conditionText(b?.boilerCondition)),
      csvTextCell(yesNo(b?.hasSprinklers)),
      csvTextCell(yesNo(b?.hasFireAlarm)),
      csvTextCell(yesNo(b?.hasSecuritySystem)),
      csvTextCell(b ? yesNo(b.isPrimary) : null),
    ]);
  });
  return file(BUILDINGS_HEADER, lines);
}

function conditionText(condition: Condition | null | undefined): string | null {
  return condition === null || condition === undefined ? null : formatCondition(condition);
}

export function buildInsuranceLoansCsv(data: InsuranceLoansData): string {
  const lines = data.rows.map((row) =>
    line([
      csvTextCell(row.name),
      csvTextCell(row.insurance?.carrier ?? null),
      csvIntegerCell(row.insurance?.policyYear ?? null),
      csvTextCell(row.insurance?.policyExpiresOn ?? null),
      csvTextCell(yesNo(row.insurance?.recentClaims)),
      csvTextCell(yesNo(row.insurance?.poolInterest)),
      csvIntegerCell(row.openLoans),
      centsToDecimal(row.originalCents),
      centsToDecimal(row.balanceCents),
      csvIntegerCell(row.balanceUnrecorded),
      centsToDecimal(row.grantsCents),
      csvTextCell(row.guarantees.length === 0 ? null : row.guarantees.join("; ")),
      centsToDecimal(row.appraisedCents),
      csvIntegerCell(row.buildingsWithoutAppraisal),
    ]),
  );
  return file(INSURANCE_LOANS_HEADER, lines);
}

const RATE_TEXT = /^\d+(\.\d+)?$/;

export function buildPerCapitaCsv(data: PerCapitaData): string {
  const lines = data.rows.map((row) => {
    if (row.rateApplied !== null && !RATE_TEXT.test(row.rateApplied)) {
      throw new RangeError("per-capita rate is not a plain decimal");
    }
    const note =
      row.status === "not_billed"
        ? notBilledText(row.notBilledReason, row.basisYear)
        : row.outstandingCents !== null && row.outstandingCents < 0
          ? "Credit"
          : "";
    return line([
      csvIntegerCell(row.billingYear),
      csvTextCell(row.name),
      csvTextCell(row.membership === "member" ? "Member" : PER_CAPITA_COPY.departed),
      csvIntegerCell(row.basisYear),
      csvIntegerCell(row.endingActiveBasis),
      csvTextCell(row.rateApplied),
      centsToDecimal(row.billedCents),
      centsToDecimal(row.paidCents),
      centsToDecimal(row.outstandingCents),
      csvTextCell(PER_CAPITA_COPY.status[row.status]),
      csvTextCell(row.paidOn),
      csvTextCell(note),
    ]);
  });
  return file(PER_CAPITA_HEADER, lines);
}

function notBilledText(reason: "no_statistics" | "not_generated" | null, basisYear: number | null): string {
  if (reason === "no_statistics") return PER_CAPITA_COPY.notBilled.no_statistics(basisYear);
  if (reason === "not_generated") return PER_CAPITA_COPY.notBilled.not_generated;
  throw new RangeError("a not-billed row has no reason");
}
