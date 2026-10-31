import "server-only";
import { AUDIT_ACTIONS, insertAuditRow, type AuditActor } from "@/lib/audit-tx";
import type { OrgTx } from "@/lib/authz";

/**
 * The in-transaction audit helper - docs/work-log/2026-10-25-treasury-inc1.md,
 * Phase 3 P3-20 and EC43. Every function in `src/lib/reimbursement/` that calls
 * an AUDITED write definer calls this inside the same `withOrgContext`, so the
 * change and its audit row commit or roll back together (`recordAudit()` would
 * open its own connection and swallow a failure).
 *
 * `check:audit` scans only `actions.ts` files and cannot see these writes;
 * `audit-coverage.test.ts` is the proof (a source scan: every function that
 * calls a write definer either calls this or is on the documented unaudited
 * list - the events table is its record).
 *
 * Metadata is ids, counts and tags ONLY - never an amount, a purpose, a reason,
 * a note or a name. `organizationId` is always present.
 */

export type ReimbursementAuditAction =
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_APPROVED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_OVERRIDE_APPROVED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_RETURNED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_NOT_APPROVED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_VOIDED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_PAYMENT_RECORDED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_PAYMENT_REVERSED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_RECEIPT_WAIVED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_RECEIPT_VIEWED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_EXPORTED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_CHARGEABLE_CHANGED
  | typeof AUDIT_ACTIONS.REIMBURSEMENT_CATEGORY_CHANGED;

export async function auditReimbursement(
  tx: OrgTx,
  input: {
    action: ReimbursementAuditAction;
    actor: AuditActor;
    organizationId: string;
    /** The request, group or category the act is about (a uuid). */
    resourceType: "reimbursement_request" | "reimbursement_group" | "reimbursement_category" | "reimbursement_export";
    resourceId: string;
    metadata?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await insertAuditRow(tx, {
    action: input.action,
    actor: input.actor,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: { organizationId: input.organizationId, ...(input.metadata ?? {}) },
  });
}
