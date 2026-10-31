import "server-only";
import { errorChain, rowsOf } from "@/lib/treasury/db-util";

/**
 * Plumbing for the reimbursement modules: the driver-result reader and the
 * definers' identity refusal. Nothing here knows a table.
 */
export { rowsOf };

/**
 * True for the definers' IDENTITY refusal: SQLSTATE 42501 with the single
 * literal `reimbursement: not permitted` (`presby_deny_reimbursement`, 0073
 * section 6). Raised when the acting user has no live person at the
 * organization, or lacks the key a treasury definer requires. A STATE refusal
 * is never an exception: it comes back as an `outcome`.
 *
 * The raise aborts the transaction it ran in, so the caller catches it OUTSIDE
 * `withOrgContext` and never reuses that transaction.
 */
export function isNotPermitted(err: unknown): boolean {
  return /reimbursement: not permitted/.test(errorChain(err));
}
