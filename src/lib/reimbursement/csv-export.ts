import "server-only";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit-tx";
import { withOrgContext } from "@/lib/authz";
import { auditReimbursement } from "./audit";
import { isNotPermitted, rowsOf } from "./db-util";
import { exceedsCsvCap, type CsvRequestRow } from "./csv-shape";
import { CSV_MAX_ROWS } from "./limits";
import type { ExportFilters } from "./queue-query";
import type { RequestActor } from "./requests";

/**
 * The CSV export's read and its audit - docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 P3-16 and DECISION-271, deferred from Batch 2a as V4.
 *
 * A BULK TIER-2 READ, so it is gated on `reimbursement.view` (the definer checks
 * it live; the route's gate checks it first) and AUDITED in the same transaction
 * as the read (`REIMBURSEMENT_EXPORTED`: the row count and the filters, never a
 * name, an amount or a purpose). Because the audit row shares the read's
 * transaction, a failed audit insert fails the export: there is no file without
 * its record. `check:audit` scans only `actions.ts` files and cannot see this;
 * `csv-export.test.ts` is the proof.
 *
 * CAP. The definer is asked for `CSV_MAX_ROWS + 1` rows (20,001; it clamps to
 * exactly that). More than the cap is `too_many` - the route answers 413 and the
 * file is never truncated, so a partial export can never pass for a whole one.
 * A refused export (too many, denied) is NOT audited: nothing left the database.
 *
 * FILTERS. `from` and `to` are organization-local dates of the request's last
 * SUBMISSION (the operator's ruling on Batch 1a: Copy says "submitted"); `status`
 * is any status but draft. They are applied by the database.
 */

type Actor = Pick<RequestActor, "userId" | "email" | "personId" | "organizationId">;

export type ExportResult =
  | { kind: "ok"; rows: CsvRequestRow[] }
  | { kind: "too_many" }
  | { kind: "denied" };

const orNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function exportRequests(actor: Actor, filters: ExportFilters): Promise<ExportResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<ExportResult> => {
      const raw = rowsOf(
        await tx.execute(sql`
          select id, status, kind, submitted_on::text as submitted_on, expense_date::text as expense_date,
                 group_name, category_name, payee_name, purpose, amount_cents,
                 approved_on::text as approved_on, approval_path, paid_on::text as paid_on,
                 payment_method, payment_reference, creator_name, approver_name, payer_name, self_paid
            from presby_reimbursement_export_rows(
              ${actor.userId}::uuid, ${filters.from ?? null}::date, ${filters.to ?? null}::date,
              ${filters.status ?? null}::text, ${CSV_MAX_ROWS + 1}::integer)`),
      );
      if (exceedsCsvCap(raw.length)) return { kind: "too_many" };

      await auditReimbursement(tx, {
        action: AUDIT_ACTIONS.REIMBURSEMENT_EXPORTED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_export",
        resourceId: actor.organizationId,
        metadata: {
          rowCount: raw.length,
          from: filters.from ?? null,
          to: filters.to ?? null,
          status: filters.status ?? null,
        },
      });

      return {
        kind: "ok",
        rows: raw.map((r) => ({
          id: String(r.id),
          status: String(r.status),
          kind: String(r.kind),
          submittedOn: orNull(r.submitted_on),
          expenseDate: orNull(r.expense_date),
          groupName: String(r.group_name),
          categoryName: orNull(r.category_name),
          payeeName: orNull(r.payee_name),
          purpose: orNull(r.purpose),
          amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
          approvedOn: orNull(r.approved_on),
          approvalPath: orNull(r.approval_path),
          paidOn: orNull(r.paid_on),
          paymentMethod: orNull(r.payment_method),
          paymentReference: orNull(r.payment_reference),
          creatorName: orNull(r.creator_name),
          approverName: orNull(r.approver_name),
          payerName: orNull(r.payer_name),
          selfPaid: r.self_paid === true,
        })),
      };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}
