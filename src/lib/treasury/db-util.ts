/**
 * Small plumbing shared by the treasury team and the reimbursement modules:
 * nothing here knows a table. (A copy of the two helpers in
 * `giving/db-util.ts`, kept separate so the treasury layer does not import the
 * giving module it sits underneath - `giving/team.ts` imports `treasury/team.ts`.)
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
