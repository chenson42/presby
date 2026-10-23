import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { rollActions } from "@/lib/db/domain/roll";
import { groups } from "@/lib/db/domain/groups";
import { people, memberships } from "@/lib/db/domain/people";
import { isPgError } from "@/lib/db/errors";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import {
  APPROVABLE_ROLL_ACTION_KINDS,
  BULK_APPROVE_MAX,
  EDIT_TIME_ROLL_ACTION_KINDS,
  PARTICIPANT_RECORD_REFUSALS,
  PARTICIPANT_VOID_REFUSALS,
  ROLL_ACTION_KIND_LABELS,
  ROLL_DECISION_REFUSALS,
  ROLL_WITHDRAW_REFUSALS,
  deriveRollFields,
  isOnRecordKind,
  type EditTimeRollActionKind,
  type OnRecordRollActionKind,
  type ParticipantRecordRefusal,
  type ParticipantVoidRefusal,
  type ProposalRefusal,
  type RollActionKind,
  type RollDecisionRefusal,
  type RollWithdrawRefusal,
} from "@/lib/roll-action-kinds";
import { isRealYmd } from "@/lib/ymd";
import { isUuid } from "@/lib/is-uuid";
import {
  deriveSessionApprovalKind,
  type SessionApprovalStateKind,
} from "@/lib/session-approval-state";

/**
 * The roll-action approve / deny / withdraw worklist and the queue reads
 * (docs/work-log/2026-08-25-member-management.md Deliverable B; rebuilt by
 * docs/work-log/2026-10-22-founding-admin-directory.md, Increment 2,
 * DECISION-202 to 206, F179 to F185).
 *
 * APPROVE, DENY AND WITHDRAW ARE THIN CALLERS OF TWO SECURITY DEFINER
 * FUNCTIONS (`drizzle/0062`): `approveRollAction()`, `denyRollAction()` and
 * `approveRollActions()` call `presby_decide_roll_action()`;
 * `withdrawRollAction()` calls `presby_withdraw_roll_action()`. THIS FILE IS
 * THE ONLY CODE THAT NAMES THEM (a source scan, `roll-decide.source.test.ts`,
 * pins it, and pins that no non-test file under `src/` updates or deletes
 * `roll_actions` directly, which is what makes 0063's REVOKE safe). After
 * 0063 `presby_app` holds neither UPDATE nor DELETE on `roll_actions`, so a
 * decision exists only if a definer checked the key in the caller's own
 * transaction. "Who may approve" is a database property, no longer a paper one
 * (F180).
 *
 * The functions return exactly ONE row with a closed `outcome` vocabulary
 * (`ROLL_DECISION_REFUSALS`, `ROLL_WITHDRAW_REFUSALS`, pinned equal to the SQL
 * by a test), so no message is ever parsed. An identity refusal (no
 * organization, a null actor, an actor who is not an active member holding the
 * key) RAISES one literal with SQLSTATE 42501, which maps to `forbidden`.
 *
 * EVERY NON-OK RESULT MUST ROLL THE TRANSACTION BACK. A refusal writes nothing
 * inside the function, but a 42501 leaves the Postgres transaction aborted, and
 * an early `return` from `db.transaction()` COMMITS: the callers below throw an
 * internal abort (the `ParticipantAbort` lesson) and translate it back.
 *
 * THE AUDIT ROW IS WRITTEN HERE, IN THE SAME TRANSACTION, with
 * `insertAuditRow()` (R13, F180): the old after-commit `recordAudit()` opened
 * its own connection and swallowed failures, so a constitutional act could
 * commit with no audit row. A throw from the audit insert now rolls the whole
 * decision back (a test forces it). This file no longer imports `recordAudit`.
 * Ids only in the metadata, no names; the denial and withdrawal reasons are
 * free text, as Increment 1's void reason is.
 *
 * `recordRollAction()`/`getPendingRollActionsForPerson()` below are a second
 * pipeline's addition (docs/work-log/2026-08-26-member-roll-on-edit.md): the
 * edit screen's own entry point for PROPOSING a roll action against an
 * already-existing person, gated on `roll.propose`, not `roll.approve` - two
 * different permissions in this one module, matched to the verbs (propose,
 * decide, withdraw) it performs.
 */

const ROLL_APPROVE = "roll.approve";
const ROLL_PROPOSE = "roll.propose";
const PEOPLE_MANAGE = "people.manage";
const OFFICERS_MANAGE = "officers.manage";

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

export { BULK_APPROVE_MAX };
export { deriveSessionApprovalKind };
export type { SessionApprovalStateKind };

export interface ActingOptions {
  /** Stamped on the audit row only. Never an authority claim. */
  actingUserEmail?: string | null;
}

const ROLL_DECISION_IDENTITY_LITERAL =
  "roll_actions: this roll decision is not permitted";
const ROLL_RECORDED_IDENTITY_LITERAL = "roll_actions: this participant action is not permitted";

const MAX_MINUTE_REFERENCE = 200;
const MAX_VOID_REASON = 500;
const MAX_DECISION_REASON = 500;

/** The R7 partial unique index; a violation of it is `pending_exists`. Exported
 * for `people.ts`'s `createPerson()`, the only other proposal writer. */
export const PENDING_PER_PERSON_INDEX = "roll_actions_one_pending_per_person_idx";

/** Walks `.cause` (Drizzle wraps the driver error) for SQLSTATE 42501 and the
 * given uniform literal. The literal is a parameter so the participant family
 * and the decision family share one walker. */
function isIdentityRefusal(err: unknown, literal: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (
      e.code === "42501" &&
      typeof e.message === "string" &&
      e.message.includes(literal)
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

function isRollActionKind(value: unknown): value is RollActionKind {
  return typeof value === "string" && value in ROLL_ACTION_KIND_LABELS;
}

// ---------------------------------------------------------------------------
// Approve, deny, withdraw (DECISION-203)
// ---------------------------------------------------------------------------

export type ApproveRollActionResult =
  | {
      kind: "ok";
      rollActionId: string;
      personId: string;
      rollKind: RollActionKind;
      /** 'YYYY-MM-DD'. */
      effectiveDate: string;
      /** A live filed return covers the effective year: the filed return is
       * never changed, but the approver is told (R14). */
      affectsFiledPeriod: boolean;
      /** A warning, never a refusal: a later effective row exists, so this
       * approval does not change the person's current status (S1). */
      shadowedBy: { kind: RollActionKind; effectiveDate: string } | null;
      /** The proposer is the approver (stamped, never blocked: DECISION-205). */
      selfApproved: boolean;
      /** The approver is the subject of the roll action. */
      selfTarget: boolean;
    }
  | { kind: "forbidden" }
  | { kind: "refused"; reason: RollDecisionRefusal };

export type DenyRollActionResult =
  | { kind: "ok"; rollActionId: string; personId: string }
  | { kind: "forbidden" }
  | { kind: "refused"; reason: RollDecisionRefusal };

export type WithdrawRollActionResult =
  | { kind: "ok"; rollActionId: string; personId: string; selfProposed: boolean }
  | { kind: "forbidden" }
  | { kind: "refused"; reason: RollWithdrawRefusal };

/** Internal control flow, NOT exported: thrown inside `withOrgContext` so a
 * non-ok result rolls the transaction back, then translated by the caller. */
class RollDecisionAbort<R> extends Error {
  constructor(readonly result: R) {
    super("roll decision aborted");
    this.name = "RollDecisionAbort";
  }
}

/** One call of `presby_decide_roll_action()`; the date columns are cast to
 * text in SQL because the driver does not promise a string for a `date`. */
async function callDecideFunction(
  tx: OrgTx,
  args: {
    rollActionId: string;
    decision: "approve" | "deny";
    minuteReference: string | null;
    reason: string | null;
    actingUserId: string;
  },
): Promise<{ row: Record<string, unknown> } | { forbidden: true }> {
  try {
    const result = await tx.execute(sql`
      select outcome,
             roll_action_id,
             subject_person_id,
             action_kind,
             action_effective_date::text as action_effective_date,
             affects_filed_period,
             shadowed_by_kind,
             shadowed_by_date::text as shadowed_by_date,
             self_approved,
             self_target
        from presby_decide_roll_action(
          ${args.rollActionId}::uuid,
          ${args.decision}::text,
          ${args.minuteReference}::text,
          ${args.reason}::text,
          ${args.actingUserId}::uuid
        )
    `);
    return { row: singleRow(result, "presby_decide_roll_action") };
  } catch (err) {
    if (isIdentityRefusal(err, ROLL_DECISION_IDENTITY_LITERAL)) {
      return { forbidden: true };
    }
    throw err;
  }
}

/** Maps a non-ok decide outcome to a typed refusal, or throws on a code the
 * database should never return (the pin test makes that a failing test). */
function decideRefusal(row: Record<string, unknown>): RollDecisionRefusal {
  if ((ROLL_DECISION_REFUSALS as readonly string[]).includes(row.outcome as string)) {
    return row.outcome as RollDecisionRefusal;
  }
  throw new Error(
    `presby_decide_roll_action returned an unrecognized outcome: ${String(row.outcome)}`,
  );
}

/**
 * Approves `rollActionId` through `presby_decide_roll_action()`. The database
 * function re-checks `roll.approve` by the actor's `users.id`, refuses a
 * non-approvable kind, a deceased or merged person, an ended membership, a
 * pastor-office holder and a gain that would put the person on a roll they are
 * already on (R3, R6), and projects `memberships.current_roll` through the
 * existing `presby_sync_current_roll` trigger.
 *
 * `minuteReference`, when supplied (1 to 200 characters after trimming),
 * overwrites the proposer's own value; when omitted the proposer's value is
 * left untouched rather than clobbered with `null`.
 *
 * Writes `tenant.roll_action.approved` in the SAME transaction, stamped
 * `selfApproved`, `selfTarget`, `affectsFiledPeriod` and `shadowedBy`.
 */
export async function approveRollAction(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  rollActionId: string,
  input: { minuteReference?: string },
  opts?: ActingOptions,
): Promise<ApproveRollActionResult> {
  const minuteReference =
    typeof input?.minuteReference === "string" ? input.minuteReference.trim() : "";

  try {
    return await withOrgContext(actingPersonId, organizationId, async (tx) => {
      if (!(await hasRollApprove(tx, actingPersonId, organizationId))) {
        throw new RollDecisionAbort<ApproveRollActionResult>({ kind: "forbidden" });
      }
      if (minuteReference.length > MAX_MINUTE_REFERENCE) {
        throw new RollDecisionAbort<ApproveRollActionResult>({
          kind: "refused",
          reason: "minute_reference_too_long",
        });
      }
      if (!isUuid(rollActionId)) {
        throw new RollDecisionAbort<ApproveRollActionResult>({
          kind: "refused",
          reason: "not_found",
        });
      }

      const called = await callDecideFunction(tx, {
        rollActionId,
        decision: "approve",
        minuteReference: minuteReference === "" ? null : minuteReference,
        reason: null,
        actingUserId,
      });
      if ("forbidden" in called) {
        throw new RollDecisionAbort<ApproveRollActionResult>({ kind: "forbidden" });
      }
      const row = called.row;
      if (row.outcome !== "ok") {
        throw new RollDecisionAbort<ApproveRollActionResult>({
          kind: "refused",
          reason: decideRefusal(row),
        });
      }

      const id = row.roll_action_id;
      const personId = row.subject_person_id;
      const rollKind = row.action_kind;
      const effectiveDate = row.action_effective_date;
      if (
        typeof id !== "string" ||
        typeof personId !== "string" ||
        !isRollActionKind(rollKind) ||
        typeof effectiveDate !== "string"
      ) {
        throw new Error("presby_decide_roll_action: ok outcome with missing ids, kind or date");
      }
      const shadowedKind = row.shadowed_by_kind;
      const shadowedDate = row.shadowed_by_date;
      const shadowedBy =
        isRollActionKind(shadowedKind) && typeof shadowedDate === "string"
          ? { kind: shadowedKind, effectiveDate: shadowedDate }
          : null;
      const selfApproved = row.self_approved === true;
      const selfTarget = row.self_target === true;
      const affectsFiledPeriod = row.affects_filed_period === true;

      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.ROLL_ACTION_APPROVED,
        actor: { userId: actingUserId, email: opts?.actingUserEmail ?? null },
        resourceType: "roll_action",
        resourceId: id,
        metadata: {
          organizationId,
          rollActionId: id,
          personId,
          kind: rollKind,
          effectiveDate,
          minuteReference: minuteReference === "" ? null : minuteReference,
          selfApproved,
          selfTarget,
          affectsFiledPeriod,
          shadowedBy,
        },
      });

      return {
        kind: "ok",
        rollActionId: id,
        personId,
        rollKind,
        effectiveDate,
        affectsFiledPeriod,
        shadowedBy,
        selfApproved,
        selfTarget,
      } satisfies ApproveRollActionResult;
    });
  } catch (err) {
    if (err instanceof RollDecisionAbort) {
      return err.result as ApproveRollActionResult;
    }
    throw err;
  }
}

/**
 * Denies `rollActionId` through `presby_decide_roll_action()`. The reason is
 * required (1 to 500 characters after trimming) and is stored on the row with
 * the deciding user and time (`decided_by`, `decided_at`): a denied row used to
 * record no actor at all. A deny never checks the person's state, so a proposal
 * for an ended or deceased person can always be denied. A denied row never
 * projects into `memberships.current_roll` and is terminal.
 */
export async function denyRollAction(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  rollActionId: string,
  input: { reason: string },
  opts?: ActingOptions,
): Promise<DenyRollActionResult> {
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";

  try {
    return await withOrgContext(actingPersonId, organizationId, async (tx) => {
      if (!(await hasRollApprove(tx, actingPersonId, organizationId))) {
        throw new RollDecisionAbort<DenyRollActionResult>({ kind: "forbidden" });
      }
      if (reason === "") {
        throw new RollDecisionAbort<DenyRollActionResult>({
          kind: "refused",
          reason: "reason_required",
        });
      }
      if (reason.length > MAX_DECISION_REASON) {
        throw new RollDecisionAbort<DenyRollActionResult>({
          kind: "refused",
          reason: "reason_too_long",
        });
      }
      if (!isUuid(rollActionId)) {
        throw new RollDecisionAbort<DenyRollActionResult>({
          kind: "refused",
          reason: "not_found",
        });
      }

      const called = await callDecideFunction(tx, {
        rollActionId,
        decision: "deny",
        minuteReference: null,
        reason,
        actingUserId,
      });
      if ("forbidden" in called) {
        throw new RollDecisionAbort<DenyRollActionResult>({ kind: "forbidden" });
      }
      const row = called.row;
      if (row.outcome !== "ok") {
        throw new RollDecisionAbort<DenyRollActionResult>({
          kind: "refused",
          reason: decideRefusal(row),
        });
      }
      const id = row.roll_action_id;
      const personId = row.subject_person_id;
      if (typeof id !== "string" || typeof personId !== "string") {
        throw new Error("presby_decide_roll_action: ok outcome with missing ids");
      }

      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.ROLL_ACTION_DENIED,
        actor: { userId: actingUserId, email: opts?.actingUserEmail ?? null },
        resourceType: "roll_action",
        resourceId: id,
        metadata: { organizationId, rollActionId: id, personId, reason },
      });

      return { kind: "ok", rollActionId: id, personId } satisfies DenyRollActionResult;
    });
  } catch (err) {
    if (err instanceof RollDecisionAbort) {
      return err.result as DenyRollActionResult;
    }
    throw err;
  }
}

/**
 * Withdraws a PENDING proposal through `presby_withdraw_roll_action()`. A
 * withdrawn row is its own terminal status, never a deletion and never `denied`
 * ("the Session said no" and "the clerk fixed a typo" are different facts);
 * the person is released from Increment 1's `pending_action` block because
 * replay and the reporting views key on `approved` only.
 *
 * Gated on `roll.propose` (any holder may withdraw: the clerk keeps the
 * register), not `roll.approve`. The reason is required (1 to 500 characters
 * after trimming). There are no state checks: a proposal for an ended or
 * deceased person can be withdrawn. Writes `tenant.roll_action.withdrawn` in
 * the same transaction, stamped `selfProposed`.
 */
export async function withdrawRollAction(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  rollActionId: string,
  input: { reason: string },
  opts?: ActingOptions,
): Promise<WithdrawRollActionResult> {
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";

  try {
    return await withOrgContext(actingPersonId, organizationId, async (tx) => {
      if (!(await hasRollPropose(tx, actingPersonId, organizationId))) {
        throw new RollDecisionAbort<WithdrawRollActionResult>({ kind: "forbidden" });
      }
      if (reason === "") {
        throw new RollDecisionAbort<WithdrawRollActionResult>({
          kind: "refused",
          reason: "reason_required",
        });
      }
      if (reason.length > MAX_DECISION_REASON) {
        throw new RollDecisionAbort<WithdrawRollActionResult>({
          kind: "refused",
          reason: "reason_too_long",
        });
      }
      if (!isUuid(rollActionId)) {
        throw new RollDecisionAbort<WithdrawRollActionResult>({
          kind: "refused",
          reason: "not_found",
        });
      }

      let row: Record<string, unknown>;
      try {
        const result = await tx.execute(sql`
          select outcome,
                 roll_action_id,
                 subject_person_id,
                 action_kind,
                 action_effective_date::text as action_effective_date,
                 self_proposed
            from presby_withdraw_roll_action(
              ${rollActionId}::uuid,
              ${reason}::text,
              ${actingUserId}::uuid
            )
        `);
        row = singleRow(result, "presby_withdraw_roll_action");
      } catch (err) {
        if (isIdentityRefusal(err, ROLL_DECISION_IDENTITY_LITERAL)) {
          throw new RollDecisionAbort<WithdrawRollActionResult>({ kind: "forbidden" });
        }
        throw err;
      }

      if (row.outcome !== "ok") {
        if ((ROLL_WITHDRAW_REFUSALS as readonly string[]).includes(row.outcome as string)) {
          throw new RollDecisionAbort<WithdrawRollActionResult>({
            kind: "refused",
            reason: row.outcome as RollWithdrawRefusal,
          });
        }
        throw new Error(
          `presby_withdraw_roll_action returned an unrecognized outcome: ${String(row.outcome)}`,
        );
      }
      const id = row.roll_action_id;
      const personId = row.subject_person_id;
      if (typeof id !== "string" || typeof personId !== "string") {
        throw new Error("presby_withdraw_roll_action: ok outcome with missing ids");
      }
      const selfProposed = row.self_proposed === true;

      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.ROLL_ACTION_WITHDRAWN,
        actor: { userId: actingUserId, email: opts?.actingUserEmail ?? null },
        resourceType: "roll_action",
        resourceId: id,
        metadata: { organizationId, rollActionId: id, personId, reason, selfProposed },
      });

      return {
        kind: "ok",
        rollActionId: id,
        personId,
        selfProposed,
      } satisfies WithdrawRollActionResult;
    });
  } catch (err) {
    if (err instanceof RollDecisionAbort) {
      return err.result as WithdrawRollActionResult;
    }
    throw err;
  }
}

export type ApproveRollActionsResult =
  | {
      kind: "ok";
      results: Array<{ rollActionId: string; result: ApproveRollActionResult }>;
      approved: number;
      needAttention: number;
    }
  | { kind: "forbidden" }
  | { kind: "too_many" }
  | { kind: "empty" };

/**
 * Bulk approve (R18): at most `BULK_APPROVE_MAX` UNIQUE ids, one optional
 * minute reference applied to all, SEQUENTIAL, and ONE TRANSACTION PER ROW:
 * each row is a full `approveRollAction()` with its own definer call and its
 * own audit row. No cross-row atomicity is claimed, and one long transaction
 * must not hold fifty membership locks. A row another approver decided mid-run
 * is reported `already_decided` without disturbing the rest. Ordering cannot
 * matter between rows: R7 allows one pending row per person, so two rows never
 * share a membership lock.
 *
 * A `forbidden` ends the loop: on the first row it is the whole result; later
 * (a key revoked mid-run) the remaining rows are reported `forbidden` so the
 * caller sees what did not happen.
 */
export async function approveRollActions(
  actingPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: { rollActionIds: string[]; minuteReference?: string },
  opts?: ActingOptions,
): Promise<ApproveRollActionsResult> {
  const rawIds = Array.isArray(input?.rollActionIds) ? input.rollActionIds : [];
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string"))];
  if (ids.length === 0) return { kind: "empty" };
  if (ids.length > BULK_APPROVE_MAX) return { kind: "too_many" };

  const results: Array<{ rollActionId: string; result: ApproveRollActionResult }> = [];
  let stopped = false;
  for (const rollActionId of ids) {
    if (stopped) {
      results.push({ rollActionId, result: { kind: "forbidden" } });
      continue;
    }
    const result = await approveRollAction(
      actingPersonId,
      organizationId,
      actingUserId,
      rollActionId,
      { minuteReference: input.minuteReference },
      opts,
    );
    if (result.kind === "forbidden") {
      if (results.length === 0) return { kind: "forbidden" };
      stopped = true;
    }
    results.push({ rollActionId, result });
  }

  const approved = results.filter((r) => r.result.kind === "ok").length;
  return { kind: "ok", results, approved, needAttention: results.length - approved };
}

// ---------------------------------------------------------------------------
// The queue reads (F179, R17, DECISION-204)
// ---------------------------------------------------------------------------

export interface PendingRollAction {
  id: string;
  personId: string;
  personDisplayName: string;
  kind: RollActionKind;
  /** 'YYYY-MM-DD'. */
  effectiveDate: string;
  minuteReference: string | null;
  /** 'YYYY-MM-DD' (UTC). */
  proposedOn: string;
  /** True when `proposed_by` (a `users.id`) matches the viewer's own
   * `users.id` — Phase 2's resolution: same-actor propose/approve is
   * permitted by design, surfaced (not blocked) so the approver can see
   * they are reviewing their own proposal. */
  proposedByIsViewer: boolean;
  /** The person's connection to this organization has ended: approval would be
   * refused (`membership_ended`); the row can only be denied or withdrawn. */
  membershipEnded: boolean;
  /** The person is recorded as deceased (`person_deceased`). */
  personDeceased: boolean;
}

export interface PendingQueueViewer {
  canApprove: boolean;
  canPropose: boolean;
  canManagePeople: boolean;
}

export type ListPendingRollActionsResult =
  | {
      kind: "ok";
      /** `decide` for a `roll.approve` holder; `read` for a propose-only holder. */
      mode: "decide" | "read";
      actions: PendingRollAction[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
      viewer: PendingQueueViewer;
    }
  | { kind: "forbidden" };

interface PendingRollActionRow {
  id: string;
  person_id: string;
  kind: RollActionKind;
  effective_date: string;
  minute_reference: string | null;
  proposed_on: string;
  proposed_by: string | null;
  membership_ended: boolean;
  person_deceased: boolean;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}

function displayName(row: {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}): string {
  return `${row.preferred_name ?? row.first_name} ${row.last_name}`;
}

/** The queue's page size is the bulk cap, so "select all on this page" can
 * never exceed what one bulk submit accepts. */
const PENDING_PAGE_SIZE = BULK_APPROVE_MAX;

/**
 * The pending queue (`/admin/community/pending`'s data). Gated on `roll.approve`
 * OR `roll.propose` (F179), checked inside the same transaction as the read:
 * an approver gets `mode: 'decide'`, a proposer a read-only `mode: 'read'`.
 * Names of `directory_hidden` people are returned to these holders by design
 * (DECISION-204): approvers need identity to decide and proposers typed the
 * person in. The queue shows every pending row of any kind, so a legacy pending
 * participant row stays visible and can be denied or withdrawn.
 */
export async function listPendingRollActions(
  viewerPersonId: string,
  organizationId: string,
  opts?: { page?: number; pageSize?: number },
): Promise<ListPendingRollActionsResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const [canApprove, canPropose] = await Promise.all([
      hasRollApprove(tx, viewerPersonId, organizationId),
      hasRollPropose(tx, viewerPersonId, organizationId),
    ]);
    if (!canApprove && !canPropose) {
      return { kind: "forbidden" };
    }
    const canManagePeople = await hasPermission(
      tx,
      viewerPersonId,
      organizationId,
      PEOPLE_MANAGE,
    );

    // proposed_by is a users.id (see roll_actions.proposedBy's own FK) — the
    // viewer's own users.id is read via THEIR people row, same personId-vs-
    // users.id discipline role-grants.ts's header documents.
    const [viewer] = await tx
      .select({ userId: people.userId })
      .from(people)
      .where(eq(people.id, viewerPersonId))
      .limit(1);
    const viewerUserId = viewer?.userId ?? null;

    const pageSize = Math.min(
      Math.max(Math.trunc(opts?.pageSize ?? PENDING_PAGE_SIZE) || PENDING_PAGE_SIZE, 1),
      PENDING_PAGE_SIZE,
    );
    const countResult = await tx.execute(sql`
      select count(*)::int as total
        from roll_actions ra
       where ra.organization_id = ${organizationId}::uuid
         and ra.approval_status = 'pending'
    `);
    const total =
      (countResult as unknown as { rows?: Array<{ total?: number }> }).rows?.[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(Math.trunc(opts?.page ?? 1) || 1, 1), totalPages);

    const result = await tx.execute(sql`
      select ra.id as id,
             ra.person_id as person_id,
             ra.kind as kind,
             ra.effective_date::text as effective_date,
             ra.minute_reference as minute_reference,
             (ra.recorded_at at time zone 'UTC')::date::text as proposed_on,
             ra.proposed_by as proposed_by,
             (m.ended_on is not null) as membership_ended,
             (p.date_of_death is not null) as person_deceased,
             p.first_name as first_name,
             p.last_name as last_name,
             p.preferred_name as preferred_name
        from roll_actions ra
        join people p on p.id = ra.person_id
        join memberships m
          on m.person_id = ra.person_id and m.organization_id = ra.organization_id
       where ra.organization_id = ${organizationId}::uuid
         and ra.approval_status = 'pending'
       order by ra.effective_date, ra.id
       limit ${pageSize} offset ${(page - 1) * pageSize}
    `);
    const rows =
      (result as unknown as { rows?: PendingRollActionRow[] }).rows ?? [];

    return {
      kind: "ok",
      mode: canApprove ? "decide" : "read",
      actions: rows.map((row) => ({
        id: row.id,
        personId: row.person_id,
        kind: row.kind,
        effectiveDate: row.effective_date,
        minuteReference: row.minute_reference,
        proposedOn: row.proposed_on,
        personDisplayName: displayName(row),
        proposedByIsViewer:
          viewerUserId !== null && row.proposed_by === viewerUserId,
        membershipEnded: row.membership_ended === true,
        personDeceased: row.person_deceased === true,
      })),
      pagination: { page, pageSize, total, totalPages },
      viewer: { canApprove, canPropose, canManagePeople },
    } as const;
  });
}

export interface DecidedRollAction {
  id: string;
  personId: string;
  personDisplayName: string;
  kind: RollActionKind;
  /** 'YYYY-MM-DD'. */
  effectiveDate: string;
  status: "approved" | "denied" | "withdrawn";
  /** 'YYYY-MM-DD' (UTC). */
  decidedOn: string;
  /** The denial or withdrawal reason; always null for an approval. */
  reason: string | null;
  minuteReference: string | null;
  /** The proposer decided their own row (S2): "Self-approved" in the history. */
  selfDecided: boolean;
}

export type ListRecentlyDecidedRollActionsResult =
  | { kind: "ok"; actions: DecidedRollAction[] }
  | { kind: "forbidden" };

interface DecidedRollActionRow {
  id: string;
  person_id: string;
  kind: RollActionKind;
  effective_date: string;
  status: "approved" | "denied" | "withdrawn";
  decided_on: string;
  reason: string | null;
  minute_reference: string | null;
  self_decided: boolean;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}

/**
 * "Recently decided": approved rows of the approvable kinds, plus every denied
 * and withdrawn row, newest decision first (a denied proposal used to vanish
 * from every screen: F179). On-record participant rows, opening balances and
 * voids never appear. Denial and withdrawal reasons are free text about a
 * person, so this whole function is gated on the two roll keys and the library
 * is what filters them (RLS cannot do it per column). Rows approved before
 * 0062 carry no `decided_*` stamps, so readers coalesce `decided_at`,
 * `approved_on` and `recorded_at` (Phase 3 refinement 1).
 */
export async function listRecentlyDecidedRollActions(
  viewerPersonId: string,
  organizationId: string,
  opts?: { limit?: number },
): Promise<ListRecentlyDecidedRollActionsResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const [canApprove, canPropose] = await Promise.all([
      hasRollApprove(tx, viewerPersonId, organizationId),
      hasRollPropose(tx, viewerPersonId, organizationId),
    ]);
    if (!canApprove && !canPropose) {
      return { kind: "forbidden" };
    }

    const limit = Math.min(Math.max(Math.trunc(opts?.limit ?? 25) || 25, 1), 100);
    const approvable = sql.join(
      APPROVABLE_ROLL_ACTION_KINDS.map((k) => sql`${k}`),
      sql`, `,
    );
    const result = await tx.execute(sql`
      select ra.id as id,
             ra.person_id as person_id,
             ra.kind as kind,
             ra.effective_date::text as effective_date,
             ra.approval_status as status,
             (coalesce(ra.decided_at, ra.approved_on::timestamptz, ra.recorded_at)
                at time zone 'UTC')::date::text as decided_on,
             case ra.approval_status
               when 'denied' then ra.denial_reason
               when 'withdrawn' then ra.withdrawal_reason
               else null
             end as reason,
             ra.minute_reference as minute_reference,
             (ra.proposed_by is not null
                and ra.proposed_by = coalesce(ra.decided_by, ra.approved_by)) as self_decided,
             p.first_name as first_name,
             p.last_name as last_name,
             p.preferred_name as preferred_name
        from roll_actions ra
        join people p on p.id = ra.person_id
       where ra.organization_id = ${organizationId}::uuid
         and (ra.approval_status in ('denied', 'withdrawn')
              or (ra.approval_status = 'approved' and ra.kind::text in (${approvable})))
       order by coalesce(ra.decided_at, ra.approved_on::timestamptz, ra.recorded_at) desc,
                ra.id
       limit ${limit}
    `);
    const rows =
      (result as unknown as { rows?: DecidedRollActionRow[] }).rows ?? [];

    return {
      kind: "ok",
      actions: rows.map((row) => ({
        id: row.id,
        personId: row.person_id,
        personDisplayName: displayName(row),
        kind: row.kind,
        effectiveDate: row.effective_date,
        status: row.status,
        decidedOn: row.decided_on,
        reason: row.reason,
        minuteReference: row.minute_reference,
        selfDecided: row.self_decided === true,
      })),
    } as const;
  });
}

/** The "N waiting" count for the Community header link. Gated on either roll
 * key, like the queue. */
export async function countPendingRollActions(
  viewerPersonId: string,
  organizationId: string,
): Promise<{ kind: "ok"; count: number } | { kind: "forbidden" }> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const [canApprove, canPropose] = await Promise.all([
      hasRollApprove(tx, viewerPersonId, organizationId),
      hasRollPropose(tx, viewerPersonId, organizationId),
    ]);
    if (!canApprove && !canPropose) {
      return { kind: "forbidden" } as const;
    }
    const result = await tx.execute(sql`
      select count(*)::int as n
        from roll_actions ra
       where ra.organization_id = ${organizationId}::uuid
         and ra.approval_status = 'pending'
    `);
    const count =
      (result as unknown as { rows?: Array<{ n?: number }> }).rows?.[0]?.n ?? 0;
    return { kind: "ok", count } as const;
  });
}

// ---------------------------------------------------------------------------
// getSessionApprovalState (Flow 7, S4, DECISION-205)
// ---------------------------------------------------------------------------

export interface SessionApprovalState {
  kind: SessionApprovalStateKind;
  /** Live Session seats: distinct persons with an active membership and an open
   * term in effect today (starts on or before today). */
  recorded: number;
  /** Seats that start after today (and whose holder has no seat in effect). */
  startingLater: number;
  /** The earliest future seat start, 'YYYY-MM-DD', or null. */
  nextStart: string | null;
  /** Of `recorded`: `people.user_id` is not null. Never reads `users`. */
  withAccount: number;
  /** Of `recorded` with an account: holds `roll.approve` today. */
  canApprove: number;
  viewer: { canApprove: boolean; canManageOfficers: boolean };
}

/** True when the organization has a derived `session` group: only
 * congregations do, and a member roll action needs a Session to approve it
 * (R15, F185). */
export async function organizationHasSession(
  tx: OrgTx,
  organizationId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.organizationId, organizationId), eq(groups.derivedFrom, "session")))
    .limit(1);
  return row !== undefined;
}

interface SessionStateRow {
  has_group: boolean;
  recorded: number;
  starting_later: number;
  next_start: string | null;
  with_account: number;
  can_approve: number;
}

/**
 * Why the Session cannot act yet, as counts only (no names). ONE SQL statement
 * (S4) counts the seats, the linked accounts and the seats whose holder holds
 * `roll.approve`, plus the viewer's two `presby_has_permission` calls in the
 * same transaction. It counts Session seats only: a viewer who can approve
 * through some other role sees no banner (the UI shows none in decide mode
 * except `no_session`). Gated on either roll key.
 */
export async function getSessionApprovalState(
  viewerPersonId: string,
  organizationId: string,
): Promise<{ kind: "ok"; state: SessionApprovalState } | { kind: "forbidden" }> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const [canApprove, canPropose] = await Promise.all([
      hasRollApprove(tx, viewerPersonId, organizationId),
      hasRollPropose(tx, viewerPersonId, organizationId),
    ]);
    if (!canApprove && !canPropose) {
      return { kind: "forbidden" } as const;
    }
    const canManageOfficers = await hasPermission(
      tx,
      viewerPersonId,
      organizationId,
      OFFICERS_MANAGE,
    );

    const result = await tx.execute(sql`
      with session_group as (
        select g.id
          from groups g
         where g.organization_id = ${organizationId}::uuid
           and g.derived_from = 'session'
      ), seats as (
        select gm.person_id,
               gm.starts_on,
               (gm.starts_on <= current_date) as in_effect
          from group_memberships gm
          join session_group sg on sg.id = gm.group_id
         where gm.organization_id = ${organizationId}::uuid
           and (gm.ends_on is null or gm.ends_on > current_date)
           and presby_membership_is_active(gm.person_id, ${organizationId}::uuid)
      ), live as (
        select distinct person_id from seats where in_effect
      )
      select
        exists (select 1 from session_group) as has_group,
        (select count(*) from live)::int as recorded,
        (select count(distinct s.person_id)
           from seats s
          where not s.in_effect
            and s.person_id not in (select person_id from live))::int as starting_later,
        (select min(s.starts_on)::text from seats s where not s.in_effect) as next_start,
        (select count(*)
           from live l join people p on p.id = l.person_id
          where p.user_id is not null)::int as with_account,
        (select count(*)
           from live l join people p on p.id = l.person_id
          where p.user_id is not null
            and presby_has_permission(l.person_id, ${organizationId}::uuid, ${ROLL_APPROVE}))::int as can_approve
    `);
    const row = (result as unknown as { rows?: SessionStateRow[] }).rows?.[0];
    const counts = {
      hasSessionGroup: row?.has_group === true,
      recorded: row?.recorded ?? 0,
      startingLater: row?.starting_later ?? 0,
      withAccount: row?.with_account ?? 0,
      canApprove: row?.can_approve ?? 0,
    };

    return {
      kind: "ok",
      state: {
        kind: deriveSessionApprovalKind(counts),
        recorded: counts.recorded,
        startingLater: counts.startingLater,
        nextStart: row?.next_start ?? null,
        withAccount: counts.withAccount,
        canApprove: counts.canApprove,
        viewer: { canApprove, canManageOfficers },
      },
    } as const;
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
    if (isIdentityRefusal(err, ROLL_RECORDED_IDENTITY_LITERAL)) {
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
        if (isIdentityRefusal(err, ROLL_RECORDED_IDENTITY_LITERAL)) {
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
  | { kind: "refused"; reason: ParticipantRecordRefusal }
  /** A PROPOSAL was refused (R7, R15): the organization has no Session to
   * approve it (`no_session`), or the person already has a roll action waiting
   * (`pending_exists`). Nothing was written. */
  | { kind: "proposal_refused"; reason: ProposalRefusal };

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
 * A pending proposal is NOT audited (only the decisions are: approve, deny
 * and withdraw); an on-record enrolment IS (`tenant.roll_action.recorded`),
 * because it is a constitutional record written without approval.
 *
 * A membership PROPOSAL is refused with `proposal_refused` when the
 * organization has no Session group (`no_session`, R15: nobody could ever
 * approve it) or the person already has a pending proposal (`pending_exists`,
 * R7: withdraw it first). The participant-on-record path is unaffected.
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

      // R15 (F185): a member roll action needs a Session to approve it. Only
      // congregations have a derived Session group; a proposal anywhere else
      // would wait forever and, with R7, block the person. Refused before any
      // write.
      if (!(await organizationHasSession(tx, organizationId))) {
        throw new ParticipantAbort<RecordRollActionResult>({
          kind: "proposal_refused",
          reason: "no_session",
        });
      }
      // R7: one pending proposal per person. A friendly pre-check; the partial
      // unique index is the backstop for the race (caught below).
      const [alreadyPending] = await tx
        .select({ id: rollActions.id })
        .from(rollActions)
        .where(
          and(
            eq(rollActions.organizationId, organizationId),
            eq(rollActions.personId, input.personId),
            eq(rollActions.approvalStatus, "pending"),
          ),
        )
        .limit(1);
      if (alreadyPending) {
        throw new ParticipantAbort<RecordRollActionResult>({
          kind: "proposal_refused",
          reason: "pending_exists",
        });
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

      let row: { id: string } | undefined;
      try {
        [row] = await tx
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
      } catch (err) {
        // The race a second proposal arriving between the pre-check and the
        // insert would hit (R7). The abort rolls back the aborted transaction.
        if (isPgError(err, "23505", PENDING_PER_PERSON_INDEX)) {
          throw new ParticipantAbort<RecordRollActionResult>({
            kind: "proposal_refused",
            reason: "pending_exists",
          });
        }
        throw err;
      }

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
      const aborted = err.result as RecordRollActionResult;
      if (aborted.kind === "forbidden") return { kind: "forbidden" };
      if (aborted.kind === "refused") {
        return { kind: "refused", reason: aborted.reason };
      }
      if (aborted.kind === "proposal_refused") {
        return { kind: "proposal_refused", reason: aborted.reason };
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
