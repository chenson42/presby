/**
 * The gifts CSV writer - docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "CSV export" (G25). PURE: its one import is the pure shared `@/lib/csv`, no
 * `server-only`, unit-tested to the byte. The route handler (`admin/giving/gifts/export/route.ts`) gates,
 * queries, audits and streams; this file only formats.
 *
 * What the contract fixes, and where it is enforced here:
 *   - the header row is exactly CSV_HEADER, and no email, address or memo
 *     column exists (a static test pins the header, so adding one is a
 *     deliberate edit to this file and its test, never a drive-by);
 *   - RFC 4180 quoting (a cell with a comma, a double quote, CR or LF is
 *     wrapped in double quotes, and a double quote inside doubles);
 *   - formula injection: a TEXT cell beginning with `=`, `+`, `-`, `@`, TAB or
 *     CR is prefixed with a single quote so a spreadsheet reads it as text;
 *   - the row cap (CSV_MAX_ROWS) is a number the route compares against, so a
 *     request over it is a 413 and never a truncated file that looks whole.
 *
 * Amounts are decimal dollars ("12.34"), never "$12.34": a spreadsheet parses
 * a bare decimal as a number, and a currency string as text.
 */

import { centsToDecimal, csvTextCell, joinCsvLines } from "@/lib/csv";

// The cell primitives live in src/lib/csv.ts (shared with the reimbursement
// export); re-exported so every existing import and csv.test.ts is untouched.
export { centsToDecimal, csvTextCell };

export const CSV_HEADER = [
  "gift_id",
  "date",
  "donor_id",
  "donor_name",
  "fund",
  "source",
  "method",
  "status",
  "amount",
  "donor_covered_fee",
  "stripe_fee",
  "net",
  "reversed",
  "check_number",
] as const;

/** More rows than this and the export answers 413 "Narrow the date range". */
export const CSV_MAX_ROWS = 50_000;

/** The route selects CSV_MAX_ROWS + 1 rows; this is the "too many" test. */
export function exceedsCsvCap(rowCount: number): boolean {
  return rowCount > CSV_MAX_ROWS;
}

export interface CsvGiftRow {
  giftId: string;
  /** 'YYYY-MM-DD' (the organization's local date). */
  occurredOn: string;
  donorId: string;
  donorName: string;
  fundName: string;
  source: string;
  method: string | null;
  status: string;
  amountCents: number;
  donorCoveredFeeCents: number;
  /** null for an offline gift or a gift whose fee has not settled. */
  feeCents: number | null;
  netCents: number | null;
  /** Net of reversals and reinstatements, 0..amount. */
  reversedCents: number;
  checkNumber: string | null;
}

/** One data row, in CSV_HEADER order. */
export function csvRow(row: CsvGiftRow): string {
  return [
    csvTextCell(row.giftId),
    csvTextCell(row.occurredOn),
    csvTextCell(row.donorId),
    csvTextCell(row.donorName),
    csvTextCell(row.fundName),
    csvTextCell(row.source),
    csvTextCell(row.method),
    csvTextCell(row.status),
    centsToDecimal(row.amountCents),
    centsToDecimal(row.donorCoveredFeeCents),
    centsToDecimal(row.feeCents),
    centsToDecimal(row.netCents),
    centsToDecimal(row.reversedCents),
    csvTextCell(row.checkNumber),
  ].join(",");
}

/** The whole file: header, then one CRLF-terminated line per row. */
export function buildGiftsCsv(rows: readonly CsvGiftRow[]): string {
  return joinCsvLines(CSV_HEADER, rows.map(csvRow));
}
