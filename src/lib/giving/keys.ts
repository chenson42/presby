import "server-only";
import type { OrgTx } from "@/lib/authz";
import { holdsPermissions } from "@/lib/treasury/keys";
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

// The implementation moved to src/lib/treasury/keys.ts (shared with the
// reimbursement gate); re-exported under its old name and path.
export { holdsPermissions };

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
