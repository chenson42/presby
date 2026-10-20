import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { GIVING_KEYS } from "./access-pure";

/**
 * `presby_has_permission` for a list of keys, and the viewer's three giving
 * keys, read inside a transaction the caller already holds (`withOrgContext`).
 * Split out of `access.ts` so the giving DATA modules (`funds.ts`, `gifts.ts`,
 * `donors.ts`, `settings.ts`, `team.ts`) can gate on it without importing the
 * toggle machinery (`org-features.ts` -> audit -> auth). RLS enforces tenancy,
 * not authorization: this is the authorization, and each data function calls it
 * first so it never trusts the page or action that called it.
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

/** One round trip: exactly which giving keys the viewer holds right now. No key implies another. */
export async function givingKeysInTx(
  tx: OrgTx,
  viewer: { personId: string; organizationId: string },
): Promise<{ view: boolean; record: boolean; manage: boolean }> {
  const [view, record, manage] = await holdsPermissions(tx, viewer, [
    GIVING_KEYS.view,
    GIVING_KEYS.record,
    GIVING_KEYS.manage,
  ]);
  return { view: view === true, record: record === true, manage: manage === true };
}
