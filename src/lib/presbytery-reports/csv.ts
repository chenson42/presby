/**
 * The four presbytery report CSV writers - docs/work-log/2026-11-15-presbytery-reports.md
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
 *   - a UTF-8 byte-order mark is prepended HERE, for these four files only, so
 *     Excel shows accented names; `joinCsvLines` and the giving and
 *     reimbursement writers are untouched and carry no BOM.
 * Nothing is concatenated by hand: no `.join(",")` appears outside this file.
 */

import { centsToDecimal, csvIntegerCell, csvTextCell, joinCsvLines } from "@/lib/csv";
import { PER_CAPITA_COPY, SUPPLY_CALL_TYPE_LABELS } from "./copy";
import type { MembershipTrendData, PerCapitaData, ViabilityData, VacantPulpitsData } from "./derive";

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
