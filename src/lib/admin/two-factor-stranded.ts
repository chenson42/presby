import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";

/**
 * "Required, but not enrolled" - the one definition, shared by `/admin/2fa` (the
 * list) and the dashboard's Two-factor card (the count) so the two can never
 * disagree (docs/work-log/2026-10-25-platform-admin-redesign-inc1.md, E21).
 *
 * THE RECORDED EXCEPTION (DECISION-252, F276, operator ruling Q8; narrowed by
 * DECISION-291). "Required" is resolved the way sign-in resolves it: the
 * account's own `two_factor_required`, OR `presby_two_factor_required(u.id)`,
 * the same SECURITY DEFINER function the jwt callback calls (a congregation's
 * policy, or any held key flagged `requires_two_factor`), so this list, the
 * dashboard's card and sign-in agree by construction and not by a parallel
 * hand-copy of the resolver. The one label-only join below (`congregation`)
 * reads `people`, `memberships` and `organization_settings` to say WHY, and is
 * allowed in exactly this module. The exception now reaches member data through
 * one per-account boolean plus that label. This file lives outside
 * `src/lib/admin-portal/dashboard/` ON PURPOSE (the dashboard's allow-list scan
 * would otherwise reject it), and it is confined by `boundaries.test.ts` (E20,
 * which also pins that no other `presby_*` function is named here): it returns
 * accounts (id, email, name, reason) or a bare count, and it never exports a
 * member count. The per-organization `member_count` on `/admin/2fa` stays
 * page-local and is never extracted.
 *
 * Like the sign-in computation's input, but NOT its master switch: this asks
 * "would be required", and ignores `auth.require_2fa`. The page copy says
 * "While enforcement is on".
 *
 * Runs on the platform connection; the caller has already checked
 * `FEATURES.ADMIN_TWO_FACTOR`.
 */

/**
 * Why they are required, first reason found: their own setting, a congregation's
 * policy, or - by exclusion, because the definer said yes and neither of the
 * first two is true - a role (a held key flagged `requires_two_factor`).
 */
export type StrandedSource = "this user" | "congregation" | "role";

export interface StrandedRow {
  id: string;
  email: string;
  name: string | null;
  source: StrandedSource;
}

/**
 * Arm A for the LABEL only: an active membership of an organization whose policy
 * requires two-factor. Not part of the predicate (the definer covers it).
 */
const CONGREGATION_LABEL_EXISTS: SQL = sql`
  EXISTS (
    SELECT 1
      FROM people p
      JOIN memberships m           ON m.person_id = p.id AND m.ended_on IS NULL
      JOIN organization_settings s ON s.organization_id = m.organization_id
     WHERE p.user_id = u.id
       AND p.merged_into_id IS NULL
       AND s.require_two_factor
  )
`;

/**
 * The predicate. Active users with no `user_totp` row who are required by their
 * own setting or by `presby_two_factor_required(u.id)`. The column comes first
 * in the OR so it short-circuits, and Postgres orders the AND quals by cost, so
 * the definer (about 3 ms a call, 0055 section 18) runs last. Refers to the
 * `users` table as `u`.
 */
export const STRANDED_WHERE: SQL = sql`
  u.is_active
  AND NOT EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id)
  AND (u.two_factor_required OR presby_two_factor_required(u.id))
`;

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] } | null)?.rows ?? []) as Row[];
}

/** The dashboard card's number. One statement; no address leaves it. */
export async function countStranded(): Promise<number> {
  const result = await getPlatformDb().execute(
    sql`SELECT count(*)::int AS n FROM users u WHERE ${STRANDED_WHERE}`,
  );
  return Number(rowsOf(result)[0]?.n ?? 0);
}

/**
 * The page's list: the first `limit` accounts by email, plus the true total from
 * the same statement (`count(*) over ()`), so a truncation note cannot disagree
 * with the rows it sits above. `limit` is clamped to 1..1000.
 */
export async function listStranded(limit: number): Promise<{ rows: StrandedRow[]; total: number }> {
  const bounded = Math.min(1000, Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : 50)));
  const result = await getPlatformDb().execute(sql`
    SELECT u.id,
           u.email,
           u.name,
           CASE WHEN u.two_factor_required THEN 'this user'
                WHEN ${CONGREGATION_LABEL_EXISTS} THEN 'congregation'
                ELSE 'role' END AS source,
           (count(*) OVER ())::int AS total
      FROM users u
     WHERE ${STRANDED_WHERE}
     ORDER BY u.email
     LIMIT ${bounded}
  `);
  const found = rowsOf(result);
  return {
    rows: found.map((r) => ({
      id: String(r.id),
      email: String(r.email),
      name: typeof r.name === "string" ? r.name : null,
      source: String(r.source) as StrandedSource,
    })),
    total: found.length === 0 ? 0 : Number(found[0]!.total ?? found.length),
  };
}
