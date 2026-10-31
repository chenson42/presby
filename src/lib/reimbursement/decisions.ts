import "server-only";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit-tx";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { auditReimbursement } from "./audit";
import { isNotPermitted, rowsOf } from "./db-util";
import { memberDetailSchema } from "./detail-shape";
import type { ReturnKind } from "./input";
import { queueNotices, sendQueuedNotices, type NoticeBatch } from "./notify";
import type { OutcomeOf } from "./outcomes";
import type { RequestActor } from "./requests";
import type { RequestStatus } from "./states";

/**
 * The deciders' write path: approve, send back, mark not approved -
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 file plan (`decisions.ts`),
 * DECISION-268, EC5, EC7, EC10, EC11, EC40, P3-20. One module serves both trees:
 * the member tree's `approveRequestAction` / `returnRequestAction` (an approver's
 * SEAT) and the treasurer tree's `overrideApproveAction` / `treasuryReturnAction`
 * (a `pay` holder, Batch 4). WHO MAY is never decided here: the definers check
 * it live, in the same locked read as the state, and answer an IDENTITY refusal
 * (a missing key) as SQLSTATE 42501 and a STATE refusal as an `outcome`.
 *
 * Each function runs inside ONE `withOrgContext`:
 *   1. the definer (locks the request row `FOR UPDATE` first; the revision the
 *      decider saw must still be the revision on the row);
 *   2. on `ok`, the audit row (`auditReimbursement`, the same transaction, so a
 *      failed audit insert rolls the decision back);
 *   3. on `ok`, the notices as `email_queue` rows (`queueNotices`, the same
 *      transaction).
 * After the commit, `sendQueuedNotices` attempts the inline sends and never
 * throws. A refusal writes no audit row and no notice.
 *
 * `already_decided` carries the org-local date of the deciding event and the
 * status the request is in now - never who decided it (the history, for the
 * treasury team, says who).
 */

type DeciderActor = Pick<RequestActor, "userId" | "email" | "personId" | "organizationId">;

export type ApprovePath = "seat" | "override";

export type ApproveRefusal = Exclude<OutcomeOf<"approve">, "ok" | "already_decided">;
export type ReturnRefusal = Exclude<OutcomeOf<"return">, "ok" | "already_decided">;

export interface AlreadyDecided {
  kind: "already_decided";
  /** `YYYY-MM-DD`, organization-local. */
  decidedOn: string | null;
  status: RequestStatus | null;
}

export type ApproveRequestResult =
  | { kind: "ok"; path: ApprovePath; decidedOn: string | null }
  | AlreadyDecided
  | { kind: "refused"; outcome: ApproveRefusal }
  | { kind: "denied" };

export type ReturnRequestResult =
  | { kind: "ok"; returnedKind: ReturnKind; decidedOn: string | null }
  | AlreadyDecided
  | { kind: "refused"; outcome: ReturnRefusal }
  | { kind: "denied" };

const uuidList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];

function alreadyDecided(out: Record<string, unknown>): AlreadyDecided {
  return {
    kind: "already_decided",
    decidedOn: out.decided_on === null || out.decided_on === undefined ? null : String(out.decided_on),
    status: (out.current_status as RequestStatus | null) ?? null,
  };
}

/**
 * Approve, on the revision the approver saw.
 *   path "seat":     the actor is an eligible approver of the request's group,
 *                    now (a chair or leader of a managed group, in date, not the
 *                    creator or beneficiary, however merged).
 *   path "override": the actor holds `reimbursement.pay`, no eligible approver
 *                    exists, and another `pay` holder exists (otherwise
 *                    `needs_second_payer`: whoever approves cannot also pay).
 *
 * Notices on `ok`: the creator is told it was approved (`requester_update`); every
 * effective `pay` holder except the approver is told it is ready to pay.
 */
export async function approveRequest(
  actor: DeciderActor,
  input: { requestId: string; expectedRevision: number; path: ApprovePath },
): Promise<ApproveRequestResult> {
  let queued: string[] = [];
  let result: ApproveRequestResult;
  try {
    result = await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<ApproveRequestResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select outcome, decided_on::text as decided_on, current_status,
                 notify_requester_person_id, notify_pay_person_ids
            from presby_reimbursement_approve(
              ${input.requestId}::uuid, ${input.expectedRevision}::integer, ${input.path}::text, ${actor.userId}::uuid)`),
      )[0]!;
      const outcome = String(out.outcome) as OutcomeOf<"approve">;
      if (outcome === "already_decided") return alreadyDecided(out);
      if (outcome !== "ok") return { kind: "refused", outcome: outcome as ApproveRefusal };

      await auditReimbursement(tx, {
        action: input.path === "override" ? AUDIT_ACTIONS.REIMBURSEMENT_OVERRIDE_APPROVED : AUDIT_ACTIONS.REIMBURSEMENT_APPROVED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_request",
        resourceId: input.requestId,
        metadata: { requestId: input.requestId, path: input.path },
      });
      const batches: NoticeBatch[] = [
        { spec: { kind: "requester_update", variant: "approved" }, personIds: [out.notify_requester_person_id as string | null] },
        { spec: { kind: "ready_to_pay" }, personIds: uuidList(out.notify_pay_person_ids) },
      ];
      queued = await queueNotices(tx, { organizationId: actor.organizationId, requestId: input.requestId, batches });
      return { kind: "ok", path: input.path, decidedOn: out.decided_on === null ? null : String(out.decided_on) };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
  if (result.kind === "ok") await sendQueuedNotices(queued);
  return result;
}

/**
 * Whether this decider acts as the group's approver or as the treasury, for the
 * audit tag. Read BEFORE the definer moves the request: after it, the request is
 * no longer `submitted` and "were you its approver" has no answer. `canDecide` is
 * the member detail's live eligible-approver test; a request the actor cannot
 * see at member level (a `pay` holder without `view`) is the treasurer's.
 */
async function deciderRole(tx: OrgTx, requestId: string, userId: string): Promise<"seat" | "treasurer"> {
  const rows = rowsOf(
    await tx.execute(sql`select presby_reimbursement_detail(${requestId}::uuid, ${userId}::uuid, 'member') as detail`),
  );
  const raw = rows[0]?.detail;
  if (raw === null || raw === undefined) return "treasurer";
  return memberDetailSchema.parse(raw).viewer.canDecide ? "seat" : "treasurer";
}

/**
 * Send back for changes (`needs_info`, the requester can fix it and send it
 * again) or mark not approved (the request ends unless the requester withdraws
 * it). A reason is required, at most 300 characters, and the requester reads it.
 * From `approved` only a `pay` holder may act, and only `needs_info`.
 *
 * Notice on `ok`: the creator is told it was sent back / not approved
 * (`requester_update`). The reason is NEVER in the notice.
 */
export async function returnRequest(
  actor: DeciderActor,
  input: { requestId: string; expectedRevision: number; kind: ReturnKind; reason: string },
): Promise<ReturnRequestResult> {
  let queued: string[] = [];
  let result: ReturnRequestResult;
  try {
    result = await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<ReturnRequestResult> => {
      const byRole = await deciderRole(tx, input.requestId, actor.userId);
      const out = rowsOf(
        await tx.execute(sql`
          select outcome, decided_on::text as decided_on, current_status, notify_requester_person_id
            from presby_reimbursement_return(
              ${input.requestId}::uuid, ${input.expectedRevision}::integer, ${input.kind}::text,
              ${input.reason}::text, ${actor.userId}::uuid)`),
      )[0]!;
      const outcome = String(out.outcome) as OutcomeOf<"return">;
      if (outcome === "already_decided") return alreadyDecided(out);
      if (outcome !== "ok") return { kind: "refused", outcome: outcome as ReturnRefusal };

      await auditReimbursement(tx, {
        action: input.kind === "not_approved" ? AUDIT_ACTIONS.REIMBURSEMENT_NOT_APPROVED : AUDIT_ACTIONS.REIMBURSEMENT_RETURNED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_request",
        resourceId: input.requestId,
        metadata: { requestId: input.requestId, kind: input.kind, byRole },
      });
      const batches: NoticeBatch[] = [
        {
          spec: { kind: "requester_update", variant: input.kind === "not_approved" ? "not_approved" : "sent_back" },
          personIds: [out.notify_requester_person_id as string | null],
        },
      ];
      queued = await queueNotices(tx, { organizationId: actor.organizationId, requestId: input.requestId, batches });
      return { kind: "ok", returnedKind: input.kind, decidedOn: out.decided_on === null ? null : String(out.decided_on) };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
  if (result.kind === "ok") await sendQueuedNotices(queued);
  return result;
}
