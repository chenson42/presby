import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { rowsOf } from "./sql-util";

/**
 * `select presby_worship_open_count()`: a bare count of distinct PEOPLE (guests
 * are not people here) with a `requested` or `confirmed` assignment on an
 * uncancelled service that starts after the organization's wall-clock now, for
 * the current organization only (zero with no context). A SECURITY DEFINER
 * count so an `org_features.manage` holder with no worship key can read it for
 * the off-switch warning (the `presby_reimbursement_open_count` precedent: it
 * returns nothing else). Runs in the transaction the Features page already
 * holds (`org-feature-warnings.ts`).
 */
export async function countUpcomingScheduled(tx: OrgTx): Promise<number> {
  const row = rowsOf(await tx.execute(sql`select presby_worship_open_count() as n`))[0];
  return Number(row?.n ?? 0);
}
