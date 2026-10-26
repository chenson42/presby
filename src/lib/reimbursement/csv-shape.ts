import { centsToDecimal, csvTextCell, joinCsvLines } from "@/lib/csv";
import { CSV_MAX_ROWS } from "./limits";

/**
 * The reimbursement CSV writer - docs/work-log/2026-10-25-treasury-inc1.md,
 * Phase 3 P3-16 and DECISION-271. PURE: its one import is the shared `@/lib/csv`
 * (the cell primitives the gifts export also uses). The route
 * (`admin/reimbursements/export/route.ts`) gates, queries, audits and streams;
 * this file only formats.
 *
 * What the contract fixes, and where it is enforced:
 *   - the header is exactly CSV_HEADER, pinned by `csv-shape.test.ts`, so adding
 *     a column is a deliberate edit to this file and its test, never a
 *     drive-by. It carries the PURPOSE (a treasurer cannot reconcile without
 *     it) and none of: the pre-approver's name, any bank detail, any email,
 *     phone or address, a note or a receipt;
 *   - RFC 4180 quoting and the formula guard (a TEXT cell beginning with `=`,
 *     `+`, `-`, `@`, TAB or CR is prefixed with a quote) are the shared
 *     primitives', applied to EVERY free-text cell, and the line terminator is
 *     CRLF including the last line;
 *   - the row cap is a number the route compares against (`CSV_MAX_ROWS`, in
 *     `limits.ts`), so an over-cap export is a 413 and never a truncated file
 *     that looks whole.
 *
 * Amounts are bare decimal dollars ("41.50"): a spreadsheet parses a bare
 * decimal as a number and a currency string as text.
 */

export const CSV_HEADER = [
  "request_id",
  "status",
  "kind",
  "submitted_on",
  "expense_date",
  "charged_to",
  "category",
  "payee",
  "purpose",
  "amount",
  "approved_on",
  "approval_path",
  "paid_on",
  "payment_method",
  "payment_reference",
  "requested_by",
  "approved_by",
  "paid_by",
  "self_paid",
] as const;

export interface CsvRequestRow {
  id: string;
  status: string;
  kind: string;
  /** `YYYY-MM-DD`, the organization's local date. */
  submittedOn: string | null;
  expenseDate: string | null;
  groupName: string;
  categoryName: string | null;
  payeeName: string | null;
  purpose: string | null;
  amountCents: number | null;
  approvedOn: string | null;
  approvalPath: string | null;
  paidOn: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  creatorName: string | null;
  approverName: string | null;
  payerName: string | null;
  selfPaid: boolean;
}

/** One data row, in CSV_HEADER order. */
export function csvRow(row: CsvRequestRow): string {
  return [
    csvTextCell(row.id),
    csvTextCell(row.status),
    csvTextCell(row.kind),
    csvTextCell(row.submittedOn),
    csvTextCell(row.expenseDate),
    csvTextCell(row.groupName),
    csvTextCell(row.categoryName),
    csvTextCell(row.payeeName),
    csvTextCell(row.purpose),
    centsToDecimal(row.amountCents),
    csvTextCell(row.approvedOn),
    csvTextCell(row.approvalPath),
    csvTextCell(row.paidOn),
    csvTextCell(row.paymentMethod),
    csvTextCell(row.paymentReference),
    csvTextCell(row.creatorName),
    csvTextCell(row.approverName),
    csvTextCell(row.payerName),
    row.selfPaid ? "true" : "false",
  ].join(",");
}

/** The whole file: the header, then one CRLF-terminated line per row. */
export function buildRequestsCsv(rows: readonly CsvRequestRow[]): string {
  return joinCsvLines(CSV_HEADER, rows.map(csvRow));
}

/** The route selects CSV_MAX_ROWS + 1 rows; this is the "too many" test (413, never a truncated file). */
export function exceedsCsvCap(rowCount: number): boolean {
  return rowCount > CSV_MAX_ROWS;
}
