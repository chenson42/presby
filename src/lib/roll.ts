import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { withOrgContext } from "@/lib/authz";
import { rollActions } from "@/lib/db/domain/roll";
import { people } from "@/lib/db/domain/people";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

/**
 * The roll-action approve/deny worklist — member management Increment 1's
 * fold-in (docs/work-log/2026-08-25-member-management.md Deliverable B,
 * Phase 2 open question (b): a roll action outranks a role grant in
 * constitutional weight, so both mutations are audited even though routine
 * roll reads are not).
 *
 * Both mutations gated on `roll.approve`, checked inside the same
 * transaction as the write (same discipline as `role-grants.ts`).
 *
 * APPEND-ONLY IS RESPECTED, NEVER RE-IMPLEMENTED: `presby_freeze_approved_
 * roll_action` (`drizzle/0009_presby_rls.sql`) is invariant 4's actual
 * enforcement floor, untouched here. This module's own pre-check
 * (`approval_status = 'pending'` in the `UPDATE`'s `WHERE`, row count
 * checked) exists so a double-approve RACE returns the typed
 * `already_decided` instead of a raw Postgres exception surfacing to the
 * caller — it is an error-reporting nicety layered ON TOP of the trigger,
 * not a substitute for it. `roll.test.ts` proves the trigger itself still
 * rejects a direct `UPDATE` against an already-approved row, independent of
 * this module's own pre-check.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ROLL_APPROVE = "roll.approve";

async function hasRollApprove(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${ROLL_APPROVE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

export type RollActionDecisionResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "already_decided" };

/**
 * The `withOrgContext()` pre-check + conditional `UPDATE`, shared by
 * `approveRollAction()` and `denyRollAction()` — `updateFields` carries the
 * ONE thing that differs (the target `approval_status` plus whatever
 * decision-specific column each sets), so the "does the row exist / is it
 * still pending" logic can never drift between the two.
 */
async function decideRollAction(
  actingPersonId: string,
  organizationId: string,
  rollActionId: string,
  updateFields: Record<string, unknown>,
): Promise<RollActionDecisionResult> {
  return withOrgContext(actingPersonId, organizationId, async (tx) => {
    if (!(await hasRollApprove(tx, actingPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [existing] = await tx
      .select({
        id: rollActions.id,
        approvalStatus: rollActions.approvalStatus,
      })
      .from(rollActions)
      .where(
        and(
          eq(rollActions.id, rollActionId),
          eq(rollActions.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) {
      return { kind: "not_found" };
    }
    if (existing.approvalStatus !== "pending") {
      return { kind: "already_decided" };
    }

    const updated = await tx
      .update(rollActions)
      .set(updateFields)
      .where(
        and(
          eq(rollActions.id, rollActionId),
          eq(rollActions.organizationId, organizationId),
          eq(rollActions.approvalStatus, "pending"),
        ),
      )
      .returning({ id: rollActions.id });

    // The re-check in WHERE closes the race a second decision arriving
    // between the SELECT above and this UPDATE would otherwise hit as a raw
    // presby_freeze_approved_roll_action exception.
    if (updated.length === 0) {
      return { kind: "already_decided" };
    }
    return { kind: "ok" };
  });
}

/**
 * Approves `rollActionId`. A successful `UPDATE` fires `presby_sync_current_
 * roll` (`AFTER UPDATE`, `drizzle/0012_presby_roll_read.sql`), projecting
 * `memberships.current_roll` — untouched by this module, inherited as-is.
 *
 * `minuteReference`, when supplied, overwrites the proposer's own value (the
 * clerk's official minute reference at approval time); when omitted, the
 * proposer's original value is left untouched rather than clobbered with
 * `null`.
 */
export async function approveRollAction(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  rollActionId: string,
  input: { minuteReference?: string },
): Promise<RollActionDecisionResult> {
  const updateFields: Record<string, unknown> = {
    approvalStatus: "approved",
    approvedBy: actingUserId,
    approvedOn: sql`current_date`,
  };
  if (input.minuteReference !== undefined) {
    updateFields.minuteReference = input.minuteReference;
  }

  const result = await decideRollAction(
    actingPersonId,
    organizationId,
    rollActionId,
    updateFields,
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.ROLL_ACTION_APPROVED,
      resourceType: "roll_action",
      resourceId: rollActionId,
      metadata: {
        organizationId,
        minuteReference: input.minuteReference ?? null,
      },
    });
  }

  return result;
}

/** Denies `rollActionId`. A denied action never projects into `memberships.
 * current_roll` — the sync trigger only fires on `approved`. */
export async function denyRollAction(
  actingPersonId: string,
  organizationId: string,
  rollActionId: string,
  input: { reason: string },
): Promise<RollActionDecisionResult> {
  const result = await decideRollAction(
    actingPersonId,
    organizationId,
    rollActionId,
    { approvalStatus: "denied", denialReason: input.reason },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.ROLL_ACTION_DENIED,
      resourceType: "roll_action",
      resourceId: rollActionId,
      metadata: { organizationId, reason: input.reason },
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// listPendingRollActions
// ---------------------------------------------------------------------------

export interface PendingRollAction {
  id: string;
  personDisplayName: string;
  kind: string;
  /** 'YYYY-MM-DD'. */
  effectiveDate: string;
  /** True when `proposed_by` (a `users.id`) matches the viewer's own
   * `users.id` — Phase 2's resolution: same-actor propose/approve is
   * permitted by design, surfaced (not blocked) so the approver can see
   * they are reviewing their own proposal. */
  proposedByIsViewer: boolean;
}

export type ListPendingRollActionsResult =
  | { kind: "ok"; actions: PendingRollAction[] }
  | { kind: "forbidden" };

interface PendingRollActionRow {
  id: string;
  kind: string;
  effective_date: string;
  proposed_by: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}

/** The clerk's session-agenda worklist — future `/admin/members/pending`
 * page's data. Gated on `roll.approve`. */
export async function listPendingRollActions(
  viewerPersonId: string,
  organizationId: string,
): Promise<ListPendingRollActionsResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasRollApprove(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    // proposed_by is a users.id (see roll_actions.proposedBy's own FK) — the
    // viewer's own users.id is read via THEIR people row, same personId-vs-
    // users.id discipline role-grants.ts's header documents.
    const [viewer] = await tx
      .select({ userId: people.userId })
      .from(people)
      .where(eq(people.id, viewerPersonId))
      .limit(1);
    const viewerUserId = viewer?.userId ?? null;

    const result = await tx.execute(sql`
      select ra.id as id,
             ra.kind as kind,
             ra.effective_date::text as effective_date,
             ra.proposed_by as proposed_by,
             p.first_name as first_name,
             p.last_name as last_name,
             p.preferred_name as preferred_name
        from roll_actions ra
        join people p on p.id = ra.person_id
       where ra.organization_id = ${organizationId}::uuid
         and ra.approval_status = 'pending'
       order by ra.effective_date, ra.id
    `);
    const rows =
      (result as unknown as { rows?: PendingRollActionRow[] }).rows ?? [];

    return {
      kind: "ok",
      actions: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        effectiveDate: row.effective_date,
        personDisplayName: `${row.preferred_name ?? row.first_name} ${row.last_name}`,
        proposedByIsViewer:
          viewerUserId !== null && row.proposed_by === viewerUserId,
      })),
    };
  });
}
