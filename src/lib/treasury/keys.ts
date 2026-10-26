import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";

/**
 * `presby_has_permission` for a list of keys, read inside a transaction the
 * caller already holds (`withOrgContext`). The body of what was
 * `giving/keys.ts#holdsPermissions`, moved here so the giving and
 * reimbursement gates share one implementation (Phase 3 "Files to modify");
 * `giving/keys.ts` re-exports it, so every giving import is untouched.
 *
 * RLS enforces tenancy, not authorization: this is the authorization, and each
 * data function calls it first so it never trusts the page or action that
 * called it. Keys are bound parameters, never interpolated.
 */
export async function holdsPermissions(
  tx: OrgTx,
  viewer: { personId: string; organizationId: string },
  keys: readonly string[],
): Promise<boolean[]> {
  const selects = keys.map(
    (key, i) =>
      sql`presby_has_permission(${viewer.personId}::uuid, ${viewer.organizationId}::uuid, ${key}) as k${sql.raw(String(i))}`,
  );
  const result = await tx.execute(sql`select ${sql.join(selects, sql`, `)}`);
  const row = (result as unknown as { rows?: Array<Record<string, boolean>> }).rows?.[0] ?? {};
  return keys.map((_, i) => row[`k${i}`] === true);
}
