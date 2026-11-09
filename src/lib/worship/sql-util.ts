import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";

/**
 * Small helpers shared by the worship store, reads and notifier. Not a public
 * surface: nothing outside `src/lib/worship/` imports it.
 */

export type Row = Record<string, unknown>;

/** The rows of a `tx.execute()` result, whichever shape the driver returns. */
export function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] } | null)?.rows ?? []) as Row[];
}

/** The organization's local date as 'YYYY-MM-DD' (`presby_worship_org_today`). */
export async function orgToday(tx: OrgTx, organizationId: string): Promise<string> {
  const row = rowsOf(
    await tx.execute(sql`select presby_worship_org_today(${organizationId}::uuid)::text as today`),
  )[0];
  return String(row!.today);
}

/**
 * The day a platform-stamped grant or roster row counts from and to, as
 * 'YYYY-MM-DD' (`presby_worship_in_effect_day`, F434): the later of the
 * organization's day and the UTC day. Use it for any comparison against, or
 * end-stamp on, a `role_grants` or `group_memberships` date. Blockouts,
 * "upcoming" and reminders stay on `orgToday`.
 */
export async function inEffectDay(tx: OrgTx, organizationId: string): Promise<string> {
  const row = rowsOf(
    await tx.execute(sql`select presby_worship_in_effect_day(${organizationId}::uuid)::text as day`),
  )[0];
  return String(row!.day);
}

/** The organization's name (the org tree is public, so this reads under any context). */
export async function orgName(tx: OrgTx, organizationId: string): Promise<string> {
  const row = rowsOf(
    await tx.execute(sql`select name from organizations where id = ${organizationId}::uuid`),
  )[0];
  return String(row?.name ?? "");
}

/** `preferred_name ?? first_name` + last name, the house display name. */
export function displayName(row: { first_name: unknown; preferred_name: unknown; last_name: unknown }): string {
  return `${String(row.preferred_name ?? row.first_name)} ${String(row.last_name)}`;
}

/** Escapes `%`, `_` and `\` so a search term is matched literally by LIKE. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** A SQL `uuid[]` literal fragment from ids that have already been checked uuid-shaped. */
export function uuidList(ids: readonly string[]) {
  return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}
