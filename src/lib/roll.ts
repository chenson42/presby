import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { withOrgContext } from "@/lib/authz";
import { rollActions } from "@/lib/db/domain/roll";
import { people, memberships } from "@/lib/db/domain/people";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  EDIT_TIME_ROLL_ACTION_KINDS,
  ROLL_ACTION_KIND_TO_ROLL,
  type EditTimeRollActionKind,
  type RollActionKind,
} from "@/lib/roll-action-kinds";

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
 *
 * `recordRollAction()`/`getPendingRollActionsForPerson()` below are a second
 * pipeline's addition (docs/work-log/2026-08-26-member-roll-on-edit.md): the
 * edit screen's own entry point for PROPOSING a roll action against an
 * already-existing person, gated on `roll.propose`, not `roll.approve` —
 * two different permissions in this one module, matched to the two
 * different verbs (propose vs. decide) it now performs.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ROLL_APPROVE = "roll.approve";
const ROLL_PROPOSE = "roll.propose";

async function hasPermission(
  tx: OrgTx,
  personId: string,
  organizationId: string,
  permissionKey: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${permissionKey}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

async function hasRollApprove(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  return hasPermission(tx, personId, organizationId, ROLL_APPROVE);
}

async function hasRollPropose(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  return hasPermission(tx, personId, organizationId, ROLL_PROPOSE);
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

// ---------------------------------------------------------------------------
// recordRollAction — edit-time entry point (docs/work-log/2026-08-26-member-
// roll-on-edit.md Phase 3)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `ageAtAction` from a birthdate and an as-of date — matches `presby_roll_
 * changes()`'s own `coalesce(age_at_action, 99)` handling of an unknown
 * birthdate (this function is never called when `dateOfBirth` is null; the
 * caller leaves `ageAtAction` null in that case instead).
 */
function ageAsOf(dateOfBirth: string, asOf: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ay, am, ad] = asOf.split("-").map(Number);
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) {
    age -= 1;
  }
  return age;
}

export type RecordRollActionResult =
  | { kind: "ok"; rollActionId: string }
  | { kind: "forbidden" }
  | { kind: "not_found" } // personId has no membership at this org
  | { kind: "invalid_kind" }; // kind not in EDIT_TIME_ROLL_ACTION_KINDS — server-side re-check

export interface RecordRollActionInput {
  personId: string;
  kind: EditTimeRollActionKind;
  /** 'YYYY-MM-DD'. */
  effectiveDate: string;
  minuteReference?: string;
}

/**
 * Records a NEW `pending` `roll_actions` row against an ALREADY-EXISTING
 * person — the edit-screen's second, independent entry point (Phase 2's
 * placement ruling: this is a roll-action-domain mutation against an
 * existing person, not a person-identity mutation, so it lives here and not
 * in `people.ts`/`createPerson()`).
 *
 * Gated on `roll.propose` ONLY — deliberately NOT `people.manage`, the
 * mirror image of `updatePerson()`'s own `people.manage`-only gate
 * (DECISION-107). A session clerk who proposes roll actions but doesn't
 * edit contact details must be able to use this function.
 *
 * `input.kind` is re-validated against `EDIT_TIME_ROLL_ACTION_KINDS` here,
 * server-side, before any write — never trusts the client `<select>` alone
 * (Phase 1's adversarial pass, same discipline `createPerson()` already
 * follows). This is the ONLY increment-in-scope kind check: the exclusion
 * of `death`/`certificate_dismissed`/etc. (F19, open — see
 * `docs/schema-design.md`) is enforced here, not by any database
 * constraint, because `roll_action_kind` the enum itself still allows every
 * value — the allow-list is application-layer, by design (Phase 3).
 *
 * `resultingRoll` is computed from `ROLL_ACTION_KIND_TO_ROLL` and inserted —
 * NOT left null, unlike `createPerson()`'s own pre-existing insert (a
 * separate, already-filed defect, `docs/TODO.md`). `ageAtAction` is computed
 * from the person's `dateOfBirth` when known, else left null.
 *
 * NOT AUDITED — same precedent this file's own header already documents:
 * roll-action proposal is deliberately unaudited; only approve/deny is.
 */
export async function recordRollAction(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: RecordRollActionInput,
): Promise<RecordRollActionResult> {
  if (!DATE_RE.test(input.effectiveDate)) {
    // Genuine bad input, not a denial — thrown, matching createPerson's own
    // "malformed effectiveDate" contract.
    throw new Error(
      `recordRollAction: effectiveDate must be 'YYYY-MM-DD', got ${JSON.stringify(
        input.effectiveDate,
      )}`,
    );
  }
  if (!EDIT_TIME_ROLL_ACTION_KINDS.includes(input.kind)) {
    return { kind: "invalid_kind" };
  }

  return withOrgContext(actingPersonId, organizationId, async (tx) => {
    if (!(await hasRollPropose(tx, actingPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    // RLS-scoped by construction, same discipline as updatePerson()'s own
    // lookup: a zero-row result is already the correct "not visible to me
    // at this org" answer — this is NOT the F21 cross-org case createPerson
    // had to work around, because both the actor and the target are read
    // through this same single-org tx.
    const [target] = await tx
      .select({ dateOfBirth: people.dateOfBirth })
      .from(people)
      .innerJoin(
        memberships,
        and(
          eq(memberships.personId, people.id),
          eq(memberships.organizationId, organizationId),
        ),
      )
      .where(eq(people.id, input.personId))
      .limit(1);
    if (!target) {
      return { kind: "not_found" };
    }

    const resultingRoll = ROLL_ACTION_KIND_TO_ROLL[input.kind];
    const ageAtAction = target.dateOfBirth
      ? ageAsOf(target.dateOfBirth, input.effectiveDate)
      : null;

    const [row] = await tx
      .insert(rollActions)
      .values({
        organizationId,
        personId: input.personId,
        kind: input.kind,
        effectiveDate: input.effectiveDate,
        resultingRoll,
        ageAtAction,
        approvalStatus: "pending",
        minuteReference: input.minuteReference ?? null,
        proposedBy: actingUserId,
      })
      .returning({ id: rollActions.id });

    return { kind: "ok", rollActionId: row!.id };
  });
}

// ---------------------------------------------------------------------------
// getPendingRollActionsForPerson — the edit screen's own "already pending"
// warning (Phase 3 Edge Cases: "warn, don't block")
// ---------------------------------------------------------------------------

export interface PendingRollActionForPerson {
  id: string;
  kind: RollActionKind;
  /** 'YYYY-MM-DD'. */
  effectiveDate: string;
}

export type PendingRollActionsForPersonResult =
  | { kind: "ok"; actions: PendingRollActionForPerson[] }
  | { kind: "forbidden" };

/**
 * A small, org-scoped, person-scoped read for `/o/<slug>/admin/members/<id>/
 * edit`'s own non-blocking notice — deliberately NOT `listPendingRollActions`
 * (gated on `roll.approve`, the approve worklist's own permission): a clerk
 * who holds `roll.propose` but not `roll.approve` must still see this
 * warning on the form they are about to submit, so this is gated on
 * `roll.propose` instead, matching `recordRollAction()`'s own gate.
 */
export async function getPendingRollActionsForPerson(
  viewerPersonId: string,
  organizationId: string,
  personId: string,
): Promise<PendingRollActionsForPersonResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasRollPropose(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const rows = await tx
      .select({
        id: rollActions.id,
        kind: rollActions.kind,
        effectiveDate: rollActions.effectiveDate,
      })
      .from(rollActions)
      .where(
        and(
          eq(rollActions.organizationId, organizationId),
          eq(rollActions.personId, personId),
          eq(rollActions.approvalStatus, "pending"),
        ),
      )
      .orderBy(rollActions.effectiveDate);

    return { kind: "ok", actions: rows };
  });
}
