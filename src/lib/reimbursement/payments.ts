import "server-only";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit-tx";
import { withOrgContext } from "@/lib/authz";
import { auditReimbursement } from "./audit";
import { isNotPermitted, rowsOf } from "./db-util";
import { queueNotices, sendQueuedNotices, type NoticeBatch } from "./notify";
import type { OutcomeOf } from "./outcomes";
import type { RequestActor } from "./requests";
import type { PaymentMethod } from "./treasury-input";

/**
 * The treasurer's write path: record a payment, reverse it, waive the receipt,
 * void a request, add a note - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * file plan (`payments.ts`), P3-7, P3-20, EC8, EC9, EC32. The treasurer-tree
 * actions (`admin/reimbursements/actions.ts`) are the callers.
 *
 * WHO MAY is never decided here. The definers check it live, in the same
 * locked read as the state: an IDENTITY refusal (no live person here, or a
 * missing `reimbursement.pay` / `.view`) is SQLSTATE 42501 and comes back as
 * `{ kind: "denied" }` (the transaction is aborted by the raise, so it is caught
 * OUTSIDE `withOrgContext`); a STATE refusal is an `outcome` from a closed list
 * (`outcomes.ts`, pinned to drizzle/0073) and comes back as `{ kind: "refused" }`.
 * The ORDER of the definer's checks is part of its contract and is unchanged by
 * this file: who may pay (`payer_is_approver`, `needs_another_payer`) precedes
 * what is missing (`receipt_missing`), so a person who can never pay this
 * request is told so rather than asked for a receipt.
 *
 * Each function runs inside ONE `withOrgContext`:
 *   1. the definer (locks the request row `FOR UPDATE` first);
 *   2. on `ok`, the audit row (`auditReimbursement`, the SAME transaction, so a
 *      failed audit insert rolls the whole act back - P3-20, EC43);
 *   3. on `ok`, the requester's notice as an `email_queue` row (`paid` or
 *      `closed`), in the same transaction.
 * After the commit, `sendQueuedNotices` attempts the inline send and never
 * throws. A refusal writes no audit row and no notice. Audit metadata is ids and
 * tags only: never an amount, a reference, a reason, a note or a name.
 *
 * NOTICES go to the creator (`notify_requester_person_id`) and to nobody else,
 * and not to the creator when the creator IS the person who just acted (a sole
 * pay holder paying or voiding their own request needs no email about their own
 * click). The notice carries nothing about the request (`notices.ts`).
 *
 * `add_note` writes no audit row: the events table is its record (Phase 3 "Not
 * audited"; `audit-coverage.test.ts` lists it as such).
 */

type Actor = Pick<RequestActor, "userId" | "email" | "personId" | "organizationId">;

export type PaymentRefusal = Exclude<OutcomeOf<"recordPayment">, "ok">;
export type ReversalRefusal = Exclude<OutcomeOf<"reversePayment">, "ok">;
export type VoidRefusal = Exclude<OutcomeOf<"void">, "ok">;
export type WaiveRefusal = Exclude<OutcomeOf<"waiveReceipt">, "ok">;
export type NoteRefusal = Exclude<OutcomeOf<"addNote">, "ok">;

export type RecordPaymentResult =
  | { kind: "ok"; paymentId: string; selfPaid: boolean }
  | { kind: "refused"; outcome: PaymentRefusal }
  | { kind: "denied" };

export type ReversePaymentResult =
  | { kind: "ok"; paymentId: string }
  | { kind: "refused"; outcome: ReversalRefusal }
  | { kind: "denied" };

export type VoidRequestResult =
  | { kind: "ok" }
  | { kind: "refused"; outcome: VoidRefusal }
  | { kind: "denied" };

export type WaiveReceiptResult =
  | { kind: "ok" }
  | { kind: "refused"; outcome: WaiveRefusal }
  | { kind: "denied" };

export type AddNoteResult =
  | { kind: "ok" }
  | { kind: "refused"; outcome: NoteRefusal }
  | { kind: "denied" };

const text = (value: string | null | undefined) => sql`${value ?? null}::text`;

/** The creator, unless the creator is the person acting. */
function requesterBatch(
  actor: Actor,
  creatorPersonId: unknown,
  variant: "paid" | "closed",
): NoticeBatch[] {
  const creator = typeof creatorPersonId === "string" && creatorPersonId !== "" ? creatorPersonId : null;
  if (creator === null || creator === actor.personId) return [];
  return [{ spec: { kind: "requester_update", variant }, personIds: [creator] }];
}

/**
 * Record the payment: the payment row and the `approved` -> `paid` flip, one
 * transaction (P3-7). The payer is never the approver in force (`payer_is_approver`,
 * and the trigger refuses it too, EC8); the creator or beneficiary may record it
 * only when no other pay holder could (`needs_another_payer`, EC9) - the trigger
 * stamps `self_paid` and this result reports it. Notice on `ok`: the creator is
 * told a payment has been recorded (`requester_update` / `paid`).
 */
export async function recordPayment(
  actor: Actor,
  input: { requestId: string; method: PaymentMethod; reference: string | null; paidOn: string; note: string | null },
): Promise<RecordPaymentResult> {
  let queued: string[] = [];
  let result: RecordPaymentResult;
  try {
    result = await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<RecordPaymentResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select outcome, payment_id, self_paid, notify_requester_person_id
            from presby_reimbursement_record_payment(
              ${input.requestId}::uuid, ${input.method}::text, ${text(input.reference)}, ${input.paidOn}::date,
              ${text(input.note)}, ${actor.userId}::uuid)`),
      )[0]!;
      const outcome = String(out.outcome) as OutcomeOf<"recordPayment">;
      if (outcome !== "ok") return { kind: "refused", outcome };

      const selfPaid = out.self_paid === true;
      await auditReimbursement(tx, {
        action: AUDIT_ACTIONS.REIMBURSEMENT_PAYMENT_RECORDED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_request",
        resourceId: input.requestId,
        metadata: { requestId: input.requestId, method: input.method, selfPaid },
      });
      queued = await queueNotices(tx, {
        organizationId: actor.organizationId,
        requestId: input.requestId,
        batches: requesterBatch(actor, out.notify_requester_person_id, "paid"),
      });
      return { kind: "ok", paymentId: String(out.payment_id), selfPaid };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
  if (result.kind === "ok") await sendQueuedNotices(queued);
  return result;
}

/**
 * Reverse the live payment: a reversal row of its own (one per payment) and the
 * `paid` -> `approved` flip, one transaction (EC32). Both entries stay on record.
 * A reason is required. No notice (Copy C10 has none for a correction).
 */
export async function reversePayment(
  actor: Actor,
  input: { requestId: string; reason: string },
): Promise<ReversePaymentResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<ReversePaymentResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select outcome, payment_id
            from presby_reimbursement_reverse_payment(${input.requestId}::uuid, ${input.reason}::text, ${actor.userId}::uuid)`),
      )[0]!;
      const outcome = String(out.outcome) as OutcomeOf<"reversePayment">;
      if (outcome !== "ok") return { kind: "refused", outcome };

      const paymentId = String(out.payment_id);
      await auditReimbursement(tx, {
        action: AUDIT_ACTIONS.REIMBURSEMENT_PAYMENT_REVERSED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_request",
        resourceId: input.requestId,
        metadata: { requestId: input.requestId, paymentId },
      });
      return { kind: "ok", paymentId };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

/**
 * Waive the receipt, once, while the request is submitted or approved and has no
 * live receipt - never on the actor's own request (D5). Audited; no notice.
 */
export async function waiveReceipt(
  actor: Actor,
  input: { requestId: string; note: string | null },
): Promise<WaiveReceiptResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<WaiveReceiptResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select outcome from presby_reimbursement_waive_receipt(${input.requestId}::uuid, ${text(input.note)}, ${actor.userId}::uuid)`),
      )[0]!;
      const outcome = String(out.outcome) as OutcomeOf<"waiveReceipt">;
      if (outcome !== "ok") return { kind: "refused", outcome };

      await auditReimbursement(tx, {
        action: AUDIT_ACTIONS.REIMBURSEMENT_RECEIPT_WAIVED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_request",
        resourceId: input.requestId,
        metadata: { requestId: input.requestId },
      });
      return { kind: "ok" };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}

/**
 * Void a request: closes it from submitted, returned or approved (never from
 * paid - the only way back from paid is a reversal). Nothing is deleted. A reason
 * is required. Notice on `ok`: the creator is told it was closed
 * (`requester_update` / `closed`); the reason is NEVER in the notice.
 */
export async function voidRequest(
  actor: Actor,
  input: { requestId: string; reason: string },
): Promise<VoidRequestResult> {
  let queued: string[] = [];
  let result: VoidRequestResult;
  try {
    result = await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<VoidRequestResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select outcome, notify_requester_person_id
            from presby_reimbursement_void(${input.requestId}::uuid, ${input.reason}::text, ${actor.userId}::uuid)`),
      )[0]!;
      const outcome = String(out.outcome) as OutcomeOf<"void">;
      if (outcome !== "ok") return { kind: "refused", outcome };

      await auditReimbursement(tx, {
        action: AUDIT_ACTIONS.REIMBURSEMENT_VOIDED,
        actor,
        organizationId: actor.organizationId,
        resourceType: "reimbursement_request",
        resourceId: input.requestId,
        metadata: { requestId: input.requestId },
      });
      queued = await queueNotices(tx, {
        organizationId: actor.organizationId,
        requestId: input.requestId,
        batches: requesterBatch(actor, out.notify_requester_person_id, "closed"),
      });
      return { kind: "ok" };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
  if (result.kind === "ok") await sendQueuedNotices(queued);
  return result;
}

/**
 * An internal note for the treasury team (`reimbursement.view`): the history
 * event is its record, so it is not an audit event. The requester never reads
 * it (P3-23).
 */
export async function addNote(actor: Actor, input: { requestId: string; note: string }): Promise<AddNoteResult> {
  try {
    return await withOrgContext(actor.personId, actor.organizationId, async (tx): Promise<AddNoteResult> => {
      const out = rowsOf(
        await tx.execute(sql`
          select outcome from presby_reimbursement_add_note(${input.requestId}::uuid, ${input.note}::text, ${actor.userId}::uuid)`),
      )[0]!;
      const outcome = String(out.outcome) as OutcomeOf<"addNote">;
      if (outcome !== "ok") return { kind: "refused", outcome };
      return { kind: "ok" };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "denied" };
    throw err;
  }
}
