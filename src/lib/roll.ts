import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { rollActions } from "@/lib/db/domain/roll";
import { people, memberships } from "@/lib/db/domain/people";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import {
  EDIT_TIME_ROLL_ACTION_KINDS,
  PARTICIPANT_RECORD_REFUSALS,
  PARTICIPANT_VOID_REFUSALS,
  deriveRollFields,
  isOnRecordKind,
  type EditTimeRollActionKind,
  type OnRecordRollActionKind,
  type ParticipantRecordRefusal,
  type ParticipantVoidRefusal,
  type RollActionKind,
} from "@/lib/roll-action-kinds";
import { isRealYmd } from "@/lib/ymd";
import { isUuid } from "@/lib/is-uuid";

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

/** The clerk's session-agenda worklist — future `/admin/community/pending`
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
// Participant actions that take effect ON RECORD (docs/work-log/2026-10-22-
// founding-admin-directory.md, Phase 2 R1-R12, Phase 3 "Library"; DECISION-198)
// ---------------------------------------------------------------------------

/**
 * `recordParticipantAction()`, `recordParticipantActionInTx()` and
 * `voidParticipantAction()` are the ONLY code that names
 * `presby_record_participant_action()` and `presby_void_participant_action()`
 * (a source-scan test, `roll-participant.source.test.ts`, pins it): the two
 * `SECURITY DEFINER` functions are the only path that can insert an approved
 * roll row under `presby_app` (the restrictive insert policy, `drizzle/0061`),
 * and the audit row is written HERE, in the same transaction (R8). A direct
 * SQL caller would skip the audit row, which is why nothing else may call
 * them.
 *
 * Both functions return exactly one row with a closed `outcome` vocabulary
 * (`PARTICIPANT_RECORD_REFUSALS` / `PARTICIPANT_VOID_REFUSALS`, pinned equal
 * to the SQL by a test), so no message is ever parsed. Identity refusals (no
 * org, null actor, an actor who is not an active member holding `roll.propose`)
 * RAISE one literal with SQLSTATE 42501, which maps to `{ kind: "forbidden" }`.
 *
 * EVERY NON-OK RESULT MUST ROLL THE CALLER'S TRANSACTION BACK. A refusal
 * writes nothing inside the function, but the caller may already have written
 * a person, a membership or a contact row (`createPerson()`), and a 42501
 * leaves the Postgres transaction aborted. An early `return` from
 * `db.transaction()` COMMITS (the `CreatePersonAbort` lesson), so the callers
 * below throw an internal abort and translate it back to the typed result.
 */

const ROLL_RECORDED_IDENTITY_LITERAL = "roll_actions: this participant action is not permitted";

const MAX_MINUTE_REFERENCE = 200;
const MAX_VOID_REASON = 500;

export interface ActingOptions {
  /** Stamped on the audit row only. Never an authority claim. */
  actingUserEmail?: string | null;
}

export interface ParticipantActionContext {
  organizationId: string;
  actingPersonId: string;
  /** A `users.id`, bound server-side from the session, never from client input. */
  actingUserId: string;
  actingUserEmail?: string | null;
}

export interface RecordParticipantActionInput {
  personId: string;
  kind: OnRecordRollActionKind;
  /** 'YYYY-MM-DD'. */
  effectiveDate: string;
  minuteReference?: string;
}

export type RecordParticipantActionResult =
  | {
      kind: "ok";
      rollActionId: string;
      membershipEnded: boolean;
      affectsFiledPeriod: boolean;
    }
  | { kind: "forbidden" }
  | { kind: "refused"; reason: ParticipantRecordRefusal };

export type VoidParticipantActionResult =
  | {
      kind: "ok";
      voidRollActionId: string;
      voidedActionId: string;
      voidedKind: OnRecordRollActionKind;
      membershipReopened: boolean;
      affectsFiledPeriod: boolean;
    }
  | { kind: "forbidden" }
  | { kind: "refused"; reason: ParticipantVoidRefusal };

/** Internal control flow, NOT exported: thrown inside `withOrgContext` so a
 * non-ok result rolls the transaction back, then translated by the caller. */
class ParticipantAbort<R> extends Error {
  constructor(readonly result: R) {
    super("participant action aborted");
    this.name = "ParticipantAbort";
  }
}

/** Walks `.cause` (Drizzle wraps the driver error) for SQLSTATE and message. */
function isIdentityRefusal(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (
      e.code === "42501" &&
      typeof e.message === "string" &&
      e.message.includes(ROLL_RECORDED_IDENTITY_LITERAL)
    ) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

function singleRow(result: unknown, fn: string): Record<string, unknown> {
  const row = (result as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  if (!row || typeof row.outcome !== "string") {
    throw new Error(`${fn}: the database function returned no outcome row`);
  }
  return row;
}

function normalizeMinuteReference(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_MINUTE_REFERENCE) {
    throw new Error(
      `recordParticipantAction: minuteReference must be at most ${MAX_MINUTE_REFERENCE} characters`,
    );
  }
  return trimmed;
}

/**
 * Inside a caller's open `withOrgContext` transaction. Pre-checks `roll.propose`
 * (`forbidden`), calls `presby_record_participant_action()` (which re-checks it
 * by the actor's `users.id`), and on `ok` writes `ROLL_ACTION_RECORDED` with
 * `insertAuditRow()` in the SAME transaction: a throw from the audit insert
 * rolls the whole act back. Ids only in the metadata, no names.
 *
 * A malformed `effectiveDate` or an over-long `minuteReference` THROWS (genuine
 * bad input; the server actions pre-validate so a user sees a message). A kind
 * outside `ON_RECORD_ROLL_ACTION_KINDS` or a non-UUID `personId` is a typed
 * refusal and never reaches the database, where the cast would be a raw error.
 *
 * The caller MUST throw on any non-`ok` result (see the header above).
 */
export async function recordParticipantActionInTx(
  tx: OrgTx,
  ctx: ParticipantActionContext,
  input: RecordParticipantActionInput,
): Promise<RecordParticipantActionResult> {
  if (!isRealYmd(input.effectiveDate)) {
    throw new Error(
      `recordParticipantAction: effectiveDate must be 'YYYY-MM-DD', got ${JSON.stringify(
        input.effectiveDate,
      )}`,
    );
  }
  const minuteReference = normalizeMinuteReference(input.minuteReference);

  if (!(await hasRollPropose(tx, ctx.actingPersonId, ctx.organizationId))) {
    return { kind: "forbidden" };
  }
  if (!isOnRecordKind(input.kind)) {
    return { kind: "refused", reason: "invalid_kind" };
  }
  if (!isUuid(input.personId)) {
    return { kind: "refused", reason: "person_not_found" };
  }

  let row: Record<string, unknown>;
  try {
    const result = await tx.execute(sql`
      select * from presby_record_participant_action(
        ${input.personId}::uuid,
        ${input.kind}::roll_action_kind,
        ${input.effectiveDate}::date,
        ${minuteReference}::text,
        ${ctx.actingUserId}::uuid
      )
    `);
    row = singleRow(result, "presby_record_participant_action");
  } catch (err) {
    if (isIdentityRefusal(err)) {
      return { kind: "forbidden" };
    }
    throw err;
  }

  if (row.outcome !== "ok") {
    if ((PARTICIPANT_RECORD_REFUSALS as readonly string[]).includes(row.outcome as string)) {
      return { kind: "refused", reason: row.outcome as ParticipantRecordRefusal };
    }
    throw new Error(
      `presby_record_participant_action returned an unrecognized outcome: ${String(row.outcome)}`,
    );
  }

  const rollActionId = row.roll_action_id;
  if (typeof rollActionId !== "string") {
    throw new Error("presby_record_participant_action: ok outcome with no roll_action_id");
  }
  const membershipEnded = row.membership_ended === true;

  await insertAuditRow(tx, {
    action: AUDIT_ACTIONS.ROLL_ACTION_RECORDED,
    actor: { userId: ctx.actingUserId, email: ctx.actingUserEmail ?? null },
    resourceType: "roll_action",
    resourceId: rollActionId,
    metadata: {
      organizationId: ctx.organizationId,
      rollActionId,
      kind: input.kind,
      effectiveDate: input.effectiveDate,
      membershipEnded,
    },
  });

  return {
    kind: "ok",
    rollActionId,
    membershipEnded,
    affectsFiledPeriod: row.affects_filed_period === true,
  };
}

/**
 * Enrols (`other_participant_enrolled`) or removes (`other_participant_removed`)
 * a participant, taking effect on record with no Session approval. One
 * `withOrgContext` transaction; the audit row commits or rolls back with the
 * roll row. `actingUserId` is the session's `users.id`.
 */
export async function recordParticipantAction(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: RecordParticipantActionInput,
  opts?: ActingOptions,
): Promise<RecordParticipantActionResult> {
  try {
    return await withOrgContext(actingPersonId, organizationId, async (tx) => {
      const result = await recordParticipantActionInTx(
        tx,
        {
          organizationId,
          actingPersonId,
          actingUserId,
          actingUserEmail: opts?.actingUserEmail ?? null,
        },
        input,
      );
      if (result.kind !== "ok") {
        throw new ParticipantAbort(result);
      }
      return result;
    });
  } catch (err) {
    if (err instanceof ParticipantAbort) {
      return err.result as RecordParticipantActionResult;
    }
    throw err;
  }
}

/**
 * Undoes the person's latest on-record entry (an enrolment or a removal) by
 * recording a `void` row, never by update or delete (R10, F175). Only the
 * latest effective action, only an on-record kind, only if not already voided;
 * voiding a removal reopens the membership only when its end date and reason
 * still match the removal's own. The reason is required (1 to 500 characters
 * after trimming) and lives in the audit row, because `roll_actions` has no
 * void-reason column.
 */
export async function voidParticipantAction(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: { rollActionId: string; reason: string },
  opts?: ActingOptions,
): Promise<VoidParticipantActionResult> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";

  try {
    return await withOrgContext(actingPersonId, organizationId, async (tx) => {
      if (!(await hasRollPropose(tx, actingPersonId, organizationId))) {
        throw new ParticipantAbort<VoidParticipantActionResult>({ kind: "forbidden" });
      }
      if (reason === "") {
        throw new ParticipantAbort<VoidParticipantActionResult>({
          kind: "refused",
          reason: "reason_required",
        });
      }
      if (reason.length > MAX_VOID_REASON) {
        throw new ParticipantAbort<VoidParticipantActionResult>({
          kind: "refused",
          reason: "reason_too_long",
        });
      }
      if (!isUuid(input.rollActionId)) {
        throw new ParticipantAbort<VoidParticipantActionResult>({
          kind: "refused",
          reason: "action_not_found",
        });
      }

      let row: Record<string, unknown>;
      try {
        const result = await tx.execute(sql`
          select * from presby_void_participant_action(
            ${input.rollActionId}::uuid,
            ${reason}::text,
            ${actingUserId}::uuid
          )
        `);
        row = singleRow(result, "presby_void_participant_action");
      } catch (err) {
        if (isIdentityRefusal(err)) {
          throw new ParticipantAbort<VoidParticipantActionResult>({ kind: "forbidden" });
        }
        throw err;
      }

      if (row.outcome !== "ok") {
        if ((PARTICIPANT_VOID_REFUSALS as readonly string[]).includes(row.outcome as string)) {
          throw new ParticipantAbort<VoidParticipantActionResult>({
            kind: "refused",
            reason: row.outcome as ParticipantVoidRefusal,
          });
        }
        throw new Error(
          `presby_void_participant_action returned an unrecognized outcome: ${String(row.outcome)}`,
        );
      }

      const voidRollActionId = row.void_roll_action_id;
      const voidedActionId = row.voided_action_id;
      const voidedKind = row.voided_kind;
      if (
        typeof voidRollActionId !== "string" ||
        typeof voidedActionId !== "string" ||
        !isOnRecordKind(voidedKind)
      ) {
        throw new Error("presby_void_participant_action: ok outcome with missing ids or kind");
      }
      const membershipReopened = row.membership_reopened === true;

      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.ROLL_ACTION_VOIDED,
        actor: { userId: actingUserId, email: opts?.actingUserEmail ?? null },
        resourceType: "roll_action",
        resourceId: voidRollActionId,
        metadata: {
          organizationId,
          voidRollActionId,
          voidsActionId: voidedActionId,
          voidedKind,
          reason,
          membershipReopened,
        },
      });

      return {
        kind: "ok",
        voidRollActionId,
        voidedActionId,
        voidedKind,
        membershipReopened,
        affectsFiledPeriod: row.affects_filed_period === true,
      } satisfies VoidParticipantActionResult;
    });
  } catch (err) {
    if (err instanceof ParticipantAbort) {
      return err.result as VoidParticipantActionResult;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// recordRollAction — edit-time entry point (docs/work-log/2026-08-26-member-
// roll-on-edit.md Phase 3; extended by 2026-10-22-founding-admin-directory)
// ---------------------------------------------------------------------------

export type RecordRollActionResult =
  | {
      kind: "ok";
      rollActionId: string;
      /** `recorded` = took effect on record (a participant enrolment);
       * `pending` = waiting for the Session. */
      effect: "pending" | "recorded";
      affectsFiledPeriod: boolean;
      /** S1: a PROPOSAL dated before the person's latest effective action. It
       * is allowed, but approving it would not change their current status. */
      shadowedBy: { kind: RollActionKind; effectiveDate: string } | null;
    }
  | { kind: "forbidden" }
  | { kind: "not_found" } // personId has no membership at this org
  | { kind: "invalid_kind" } // kind not in EDIT_TIME_ROLL_ACTION_KINDS - server-side re-check
  | { kind: "refused"; reason: ParticipantRecordRefusal };

export interface RecordRollActionInput {
  personId: string;
  kind: EditTimeRollActionKind;
  /** 'YYYY-MM-DD'. */
  effectiveDate: string;
  minuteReference?: string;
}

/**
 * Records a roll action against an ALREADY-EXISTING person - the edit-screen's
 * second, independent entry point (Phase 2's placement ruling: this is a
 * roll-action-domain mutation against an existing person, not a person-identity
 * mutation, so it lives here and not in `people.ts`/`createPerson()`).
 *
 * THE KIND ALONE DECIDES whether it takes effect on record, never a client
 * flag (R4): `other_participant_enrolled` goes through
 * `recordParticipantActionInTx()` (approved at insert, audited); every other
 * kind inserts a `pending` row for the Session. A forged membership kind
 * therefore can never take effect on record.
 *
 * Gated on `roll.propose` ONLY - deliberately NOT `people.manage`, the mirror
 * image of `updatePerson()`'s own `people.manage`-only gate (DECISION-107). A
 * session clerk who proposes roll actions but doesn't edit contact details must
 * be able to use this function.
 *
 * `input.kind` is re-validated against `EDIT_TIME_ROLL_ACTION_KINDS` here,
 * server-side, before any write (the F19 exclusion of `death`/`certificate_
 * dismissed`/etc. is application-layer, by design). `resulting_roll` and
 * `age_at_action` come from `deriveRollFields()`, the one derivation every
 * writer shares (F173).
 *
 * A pending proposal is NOT audited (this file's header: only approve/deny
 * are); an on-record enrolment IS (`tenant.roll_action.recorded`), because it
 * is a constitutional record written without approval.
 */
export async function recordRollAction(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: RecordRollActionInput,
  opts?: ActingOptions,
): Promise<RecordRollActionResult> {
  if (!isRealYmd(input.effectiveDate)) {
    // Genuine bad input, not a denial - thrown, matching createPerson's own
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

  try {
    return await withOrgContext(actingPersonId, organizationId, async (tx) => {
      if (!(await hasRollPropose(tx, actingPersonId, organizationId))) {
        return { kind: "forbidden" } as const;
      }
      if (!isUuid(input.personId)) {
        return { kind: "not_found" } as const;
      }

      // RLS-scoped by construction, same discipline as updatePerson()'s own
      // lookup: a zero-row result is already the correct "not visible to me
      // at this org" answer - this is NOT the F21 cross-org case createPerson
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
        return { kind: "not_found" } as const;
      }

      if (isOnRecordKind(input.kind)) {
        const recorded = await recordParticipantActionInTx(
          tx,
          {
            organizationId,
            actingPersonId,
            actingUserId,
            actingUserEmail: opts?.actingUserEmail ?? null,
          },
          {
            personId: input.personId,
            kind: input.kind,
            effectiveDate: input.effectiveDate,
            minuteReference: input.minuteReference,
          },
        );
        if (recorded.kind !== "ok") {
          throw new ParticipantAbort<RecordRollActionResult>(recorded);
        }
        return {
          kind: "ok",
          rollActionId: recorded.rollActionId,
          effect: "recorded",
          affectsFiledPeriod: recorded.affectsFiledPeriod,
          shadowedBy: null,
        } as const;
      }

      const { resultingRoll, ageAtAction } = deriveRollFields(
        input.kind,
        target.dateOfBirth,
        input.effectiveDate,
      );
      const minuteReference = normalizeMinuteReference(input.minuteReference);

      // S1: warn (never refuse) when the proposal is dated before the
      // person's latest effective action - replay would shadow it.
      const latestResult = await tx.execute(sql`
        select kind, effective_date::text as effective_date
          from presby_effective_roll_actions
         where person_id = ${input.personId}::uuid
           and organization_id = ${organizationId}::uuid
         order by effective_date desc, recorded_at desc
         limit 1
      `);
      const latest = (
        latestResult as unknown as {
          rows?: Array<{ kind: RollActionKind; effective_date: string }>;
        }
      ).rows?.[0];
      const shadowedBy =
        latest && latest.effective_date > input.effectiveDate
          ? { kind: latest.kind, effectiveDate: latest.effective_date }
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
          minuteReference,
          proposedBy: actingUserId,
        })
        .returning({ id: rollActions.id });

      return {
        kind: "ok",
        rollActionId: row!.id,
        effect: "pending",
        affectsFiledPeriod: false,
        shadowedBy,
      } as const;
    });
  } catch (err) {
    if (err instanceof ParticipantAbort) {
      const aborted = err.result as RecordParticipantActionResult;
      if (aborted.kind === "forbidden") return { kind: "forbidden" };
      if (aborted.kind === "refused") {
        return { kind: "refused", reason: aborted.reason };
      }
    }
    throw err;
  }
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
 * A small, org-scoped, person-scoped read for `/o/<slug>/admin/community/<id>/
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
