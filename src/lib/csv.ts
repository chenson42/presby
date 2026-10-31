/**
 * The shared CSV primitives - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * "Files to modify" (`src/lib/csv.ts`). PURE: no imports, no `server-only`.
 *
 * Extracted byte for byte from `src/lib/giving/csv.ts` so the reimbursement
 * export (Batch 4) and the gifts export share ONE definition of the three rules
 * a spreadsheet makes security-relevant:
 *   - RFC 4180 quoting (a cell with a comma, a double quote, CR or LF is
 *     wrapped in double quotes, and a double quote inside doubles);
 *   - the formula guard: a TEXT cell beginning with `=`, `+`, `-`, `@`, TAB or
 *     CR is prefixed with a single quote so a spreadsheet reads it as text;
 *   - the line terminator: CRLF, one per row, including the last.
 *
 * `giving/csv.ts` re-exports `csvTextCell` and `centsToDecimal`, and its own
 * test (`csv.test.ts`) is unchanged and must keep passing byte for byte.
 */

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** A TEXT cell: formula-prefixed, then RFC 4180-quoted. null/undefined -> empty. */
export function csvTextCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  let text = String(value);
  if (FORMULA_LEAD.test(text)) text = `'${text}`;
  if (NEEDS_QUOTES.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Integer cents -> "12.34" (no currency symbol, no grouping). null -> "". */
export function centsToDecimal(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("centsToDecimal: cents must be a safe integer");
  }
  const abs = Math.abs(cents);
  const text = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${text}` : text;
}

/** The whole file: the header line, then one line per row, each CRLF-terminated. */
export function joinCsvLines(header: readonly string[], lines: readonly string[]): string {
  return `${[header.join(","), ...lines].join("\r\n")}\r\n`;
}
