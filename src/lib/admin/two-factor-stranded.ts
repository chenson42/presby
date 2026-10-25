import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getPlatformDb } from "@/lib/db";

/**
 * "Required, but not enrolled" - the one definition, shared by `/admin/2fa` (the
 * list) and the dashboard's Two-factor card (the count) so the two can never
 * disagree (docs/work-log/2026-10-25-platform-admin-redesign-inc1.md, E21).
 *
 * THE RECORDED EXCEPTION (DECISION-252, F276, operator ruling Q8). The predicate
 * resolves "required" through `people` and `memberships`: an account is required
 * by its own `two_factor_required` flag or by an active membership of an
 * organization whose policy requires two-factor. That is member-derived data on
 * the platform tier, and it is allowed in exactly this module. This file lives
 * outside `src/lib/admin-portal/dashboard/` ON PURPOSE (the dashboard's
 * allow-list scan would otherwise reject it), and it is confined by
 * `boundaries.test.ts`: it returns accounts (id, email, name, reason) or a bare
 * count, and it never exports a member count. The per-organization `member_count`
 * on `/admin/2fa` stays page-local and is never extracted.
 *
 * Runs on the platform connection; the caller has already checked
 * `FEATURES.ADMIN_TWO_FACTOR`.
 */

export interface StrandedRow {
  id: string;
  email: string;
  name: string | null;
  /** Why they are required: their own record, or a congregation's policy. */
  source: string;
}

/**
 * The predicate, moved verbatim from `2fa/page.tsx`. Active users with no
 * `user_totp` row who are required by their own flag or by an active
 * membership's organization. Refers to the `users` table as `u`.
 */
export const STRANDED_WHERE: SQL = sql`
  u.is_active
  AND NOT EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id)
  AND (
        u.two_factor_required
        OR EXISTS (
          SELECT 1
            FROM people p
            JOIN memberships m           ON m.person_id = p.id AND m.ended_on IS NULL
            JOIN organization_settings s ON s.organization_id = m.organization_id
           WHERE p.user_id = u.id
             AND p.merged_into_id IS NULL
             AND s.require_two_factor
        )
      )
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
           CASE WHEN u.two_factor_required THEN 'this user' ELSE 'congregation' END AS source,
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
      source: String(r.source),
    })),
    total: found.length === 0 ? 0 : Number(found[0]!.total ?? found.length),
  };
}
