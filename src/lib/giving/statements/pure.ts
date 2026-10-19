import { errorChain } from "../db-util";

/**
 * The statement run's pure rules - no database, no pdfkit - so they are unit-
 * tested without a connection: the production gate, the tax-year bound, the
 * list cursor, and the mapping from a Postgres refusal to the issue
 * vocabulary (the Batch 5a error table in docs/work-log/2026-10-15-online-
 * giving.md). `statements.ts` re-exports what its callers need.
 */

const EARLIEST_YEAR = 2000;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The operator gate on issue and re-issue (Operator Q6: no real statement
 * before the CPA has ruled). An environment variable, not a platform flag.
 * Development, test and CI are never gated; production is until
 * `GIVING_STATEMENTS_ENABLED=1`.
 */
export function statementIssuingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.GIVING_STATEMENTS_ENABLED === "1";
}

/** A whole year from 2000 up to and including the organization's current year (never the future). */
export function isValidStatementYear(year: unknown, currentYear: number): year is number {
  return typeof year === "number" && Number.isInteger(year) && year >= EARLIEST_YEAR && year <= currentYear;
}

/** `?year=2027` as a number, or null for anything that is not four digits. */
export function parseYearParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && /^\d{4}$/.test(value) ? Number(value) : null;
}

export function encodeListCursor(row: { donorName: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.donorName.toLowerCase(), row.id]), "utf8").toString("base64url");
}

/** A tampered cursor is dropped (page one), never an error. */
export function decodeListCursor(cursor: string | undefined | null): { name: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      UUID_PATTERN.test(parsed[1])
    ) {
      return { name: parsed[0], id: parsed[1].toLowerCase() };
    }
  } catch {
    // fall through to page one
  }
  return null;
}

export type IssueFailureReason =
  | "donor_unavailable"
  | "consistency"
  | "render_failed"
  | "store_failed"
  | "forbidden"
  | "unknown";

export type MappedIssueError = "already_issued" | "already_reissued" | "nothing_to_count" | IssueFailureReason;

/**
 * Maps a rejection of a donor's transaction to the issue vocabulary. The
 * deferred consistency checks surface at COMMIT, as the rejection of the
 * `withOrgContext()` promise, not at the INSERT.
 */
export function mapIssueError(err: unknown): MappedIssueError {
  const text = errorChain(err);
  if (/giving_statements_version_key/.test(text)) return "already_issued";
  if (/giving_statements_supersedes_once_idx/.test(text)) return "already_reissued";
  if (/giving_statement: (supersedes_invalid|already_superseded)/.test(text)) return "already_reissued";
  if (/giving_statement: not permitted/.test(text)) return "forbidden";
  if (/giving_statement: (donor_unavailable|donor_unidentified)/.test(text)) return "donor_unavailable";
  if (/giving_statements_totals_shape/.test(text)) return "nothing_to_count";
  if (/giving_statements_consistency|inconsistent:|giving_statement: blob_invalid/.test(text)) return "consistency";
  return "unknown";
}
