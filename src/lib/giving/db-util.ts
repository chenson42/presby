import "server-only";
import { sql, type SQL } from "drizzle-orm";

/**
 * Small, shared plumbing for the giving data modules (`funds.ts`, `gifts.ts`,
 * `donors.ts`, `settings.ts`, `team.ts`, `attention.ts`). Nothing here knows a
 * table; it only reads a driver result and a Postgres error.
 */

type Row = Record<string, unknown>;

/** The rows of a `tx.execute(sql...)` result, however the driver shapes it. */
export function rowsOf<T extends Row = Row>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] } | null)?.rows ?? []) as T[];
}

/** `err.message` plus every `.cause`'s, joined - Drizzle wraps the driver's Postgres error. */
export function errorChain(err: unknown, depth = 0): string {
  if (depth > 5 || err === null || err === undefined) return "";
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  return cause ? `${message} :: ${errorChain(cause, depth + 1)}` : message;
}

/**
 * The code in a `giving_offline_gift: <code>` / `giving_void: <code>` raise
 * (a `check_violation` from the DEFINER functions), or null when `err` is not
 * one. The codes are the functions' own vocabulary (drizzle/0055 section 17p/q).
 */
export function givingFunctionCode(err: unknown, prefix: "giving_offline_gift" | "giving_void"): string | null {
  const match = new RegExp(`${prefix}: ([a-z_]+)`).exec(errorChain(err));
  return match ? match[1]! : null;
}

/** True for the DEFINER functions' identity refusal (`giving: not permitted`). */
export function isNotPermitted(err: unknown): boolean {
  return /giving: not permitted/.test(errorChain(err));
}

/** True when the failure is the named constraint (23505/23514 messages carry its name). */
export function violatesConstraint(err: unknown, constraint: string): boolean {
  return errorChain(err).includes(constraint);
}

/**
 * A timestamptz column as an ISO-8601 UTC string (`2026-10-15T14:03:09Z`).
 * The neon driver hands back Date objects for column reads but STRINGS for
 * computed expressions (check:sql-date), so every timestamp the giving modules
 * return is cast here, once, and arrives as the same string shape - the shape
 * `<FormattedDate>` renders. `column` is a trusted literal (`"g.created_at"`),
 * never user input.
 */
export function isoTs(column: string): SQL {
  return sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
}
