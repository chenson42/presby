import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { rowsOf } from "./db-util";

/**
 * Bare counts of the current organization - docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 file plan (`counts.ts`) and Copy check C1.
 *
 * `openRequestCount` is the ONE exported function `org-feature-warnings.ts`
 * calls (that file may not name a `presby_reimbursement_*` function itself, T2).
 * It reads `presby_reimbursement_open_count()`, a SECURITY DEFINER BARE COUNT of
 * `presby_current_org()` with no actor and no key, which is why an
 * `org_features.manage` holder (who holds no money key) may see it: it reveals a
 * number and nothing else. Open means `submitted`, `returned` or `approved`;
 * drafts are excluded.
 */
export async function openRequestCount(tx: OrgTx): Promise<number> {
  const rows = rowsOf(await tx.execute(sql`select presby_reimbursement_open_count() as n`));
  return Number(rows[0]?.n ?? 0);
}

/** Effective holders of `reimbursement.pay` (the queue banner when it is zero). Same bare-count rules. */
export async function payHolderCount(tx: OrgTx): Promise<number> {
  const rows = rowsOf(await tx.execute(sql`select presby_reimbursement_pay_holder_count() as n`));
  return Number(rows[0]?.n ?? 0);
}
