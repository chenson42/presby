/**
 * The TypeScript twin of `presby_reimbursement__clean_text` (drizzle/0073
 * section 3a) - docs/work-log/2026-10-25-treasury-inc1.md, EC37. PURE.
 *
 * Free text is plain text. In this order: NFC; tab, newline and the other line
 * breaks become spaces; every other control character, bidi control and
 * zero-width character is removed; runs of whitespace collapse to one space;
 * trimmed; empty becomes `null`. The DATABASE cleans again on every write, so
 * this twin exists to (a) measure length the way the database will, so an
 * over-length value is a named field error and never a silent truncation, and
 * (b) show the requester exactly what will be stored.
 *
 * One known, accepted divergence: the database's `\s+` collapse follows the
 * database locale (a no-break space U+00A0 is whitespace to JavaScript and may
 * not be to Postgres), so `text.db.test.ts` pins parity on a corpus that
 * leaves that one character out. NUL is removed here as well (Postgres text
 * cannot hold it).
 */

const LINE_BREAKS = /[\u0009-\u000D\u0085\u2028\u2029]/g;
const REMOVED = /[\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value
    .normalize("NFC")
    .replace(LINE_BREAKS, " ")
    .replace(REMOVED, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" ? null : cleaned;
}

/** Length in characters (code points), as `char_length` counts them. */
export function textLength(value: string): number {
  return Array.from(value).length;
}
