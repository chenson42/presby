import "server-only";
import { sql } from "drizzle-orm";
import type { getPlatformDb } from "@/lib/db";

/**
 * The first-treasurer designation's applicability and holder gate -
 * docs/work-log/2026-10-15-online-giving.md Phase 2 R2 (G1, DECISION-170), as
 * reshaped by docs/work-log/2026-10-21-invitations.md (DECISION-183, Batch 2d).
 *
 * WHAT THIS MODULE IS NOW. It used to hold `designateTreasurer()`, a
 * `getPlatformDb()` transaction that resolved a typed email to a `users` row,
 * then to that user's person at the org. Under the invitation model (C1, C6) a
 * designation is an INVITATION to an address the congregation already has on
 * file for a member, accepted by that address's owner, and the effect it used
 * to write lives in the ungranted plpgsql helper `presby_apply_treasurer`
 * (drizzle/0059), reached only through `presby_accept_invitation`. The
 * TypeScript transaction and its helpers were DELETED in Batch 2d, after
 * `designation-parity.db.test.ts` proved the SQL writes exactly what the
 * TypeScript wrote and froze that as a golden snapshot (now the pin). What
 * remains is what the page and `issue.ts` still read:
 *
 *   - the org-type ALLOW-LIST (`TREASURER_DESIGNATION_ORG_TYPES`) and its
 *     predicate - an allow-list, because the org-type enum has five values and
 *     a new one must default to "not applicable" (a presbytery cannot hold
 *     giving keys: the toggle and this designation both refuse it);
 *   - `countGivingManageHolders()`: a thin wrapper over the owner-only
 *     `presby_giving_manage_holder_count(org)`, the single source for the send
 *     gate, this page's count and the accept gate. "Effective" mirrors the
 *     resolver's arms 1 and 2 (grant inside its window, person not merged and
 *     holding an ACTIVE membership here, a group-arm member's membership inside
 *     its window); commission and delegation arms are absent by design
 *     (DECISION-175 (1) / F139: three 0055 triggers keep `giving.*` keys off
 *     those roles). Never `presby_effective_permissions()` (F107).
 *
 * Imports no giving table (`@/lib/db/domain/giving`): the designation is
 * authority plumbing, not giving data, and a static test holds the line. The
 * four resolver-side files are not imported and are unchanged by the
 * invitation pipeline (see founding-administrator.ts).
 */

/** Organization types a treasurer can be designated at. An ALLOW-LIST — the
 * org-type enum has five values and a new one must default to "not
 * applicable". Equal to `ORG_FEATURE_CATALOG`'s `org_portal.giving`
 * `orgTypes` (set-equality pinned in the catalog test). */
export const TREASURER_DESIGNATION_ORG_TYPES = [
  "congregation",
  "new_worshiping_community",
] as const;

type DesignationOrgType = (typeof TREASURER_DESIGNATION_ORG_TYPES)[number];

/** Whether `organizationType` is one a treasurer can be designated at. */
export function treasurerDesignationApplies(
  organizationType: string,
): organizationType is DesignationOrgType {
  return (TREASURER_DESIGNATION_ORG_TYPES as readonly string[]).includes(
    organizationType,
  );
}

type PlatformDb = ReturnType<typeof getPlatformDb>;
type PlatformTx = Parameters<Parameters<PlatformDb["transaction"]>[0]>[0];

/**
 * How many DISTINCT people CURRENTLY effectively hold `giving.manage` at
 * `organizationId`, read fresh on every call. A thin wrapper over
 * `presby_giving_manage_holder_count()` (drizzle/0059), the CTE lifted
 * verbatim from the retired TypeScript. Exported for the admin page's read-only
 * display; `issue.ts` and the accept function use the SQL function directly as
 * their gate.
 */
export async function countGivingManageHolders(
  tx: PlatformTx | PlatformDb,
  organizationId: string,
): Promise<number> {
  const result = await tx.execute(
    sql`select presby_giving_manage_holder_count(${organizationId}::uuid) as holder_count`,
  );
  return Number(
    (result as unknown as { rows?: Array<{ holder_count?: number | string }> }).rows?.[0]
      ?.holder_count ?? 0,
  );
}
