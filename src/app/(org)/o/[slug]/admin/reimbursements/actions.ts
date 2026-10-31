"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import {
  zodFieldErrors,
  type ReimbursementActionFailure,
  type ReimbursementActionResult,
} from "@/lib/reimbursement/action-result";
import { COPY } from "@/lib/reimbursement/copy";
import { endCategory, saveCategory, setChargeable } from "@/lib/reimbursement/config";
import { approveRequest, returnRequest } from "@/lib/reimbursement/decisions";
import { gateReimbursementAction } from "@/lib/reimbursement/gate";
import { alreadyDecidedFailure } from "@/lib/reimbursement/messages";
import { addNote, recordPayment, reversePayment, voidRequest, waiveReceipt } from "@/lib/reimbursement/payments";
import { getRequestDetail } from "@/lib/reimbursement/reads";
import {
  addNoteRefusal,
  categoryRefusal,
  chargeableRefusal,
  overrideRefusal,
  paymentRefusal,
  reasonVerbRefusal,
  treasuryReturnRefusal,
  waiveRefusal,
} from "@/lib/reimbursement/treasury-messages";
import {
  addNoteSchema,
  endCategorySchema,
  overrideApproveSchema,
  recordPaymentSchema,
  reversePaymentSchema,
  saveCategorySchema,
  setChargeableSchema,
  treasuryReturnSchema,
  voidRequestSchema,
  waiveReceiptSchema,
} from "@/lib/reimbursement/treasury-input";

/**
 * Server Actions for the treasurer tree `/o/<slug>/admin/reimbursements/**` -
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 API Contract Layer 3
 * ("Treasurer tree"), Batch 4. The team page's actions are in `team/actions.ts`.
 *
 * Every action takes the URL SLUG (never an organization id, never a person id,
 * never a payer or a self-paid flag), begins with `gateReimbursementAction`
 * (sign-in, the Node-side 2FA check, the four-way org miss, applicability, the
 * toggle, and the KEY the verb needs, read live) and then calls ONE library
 * function that runs in a single `withOrgContext`. The key here is the first
 * line of defence; the definers re-check it, and the state rules (not the
 * approver, not your own request, a second payer exists), in the same locked
 * read as the change - this file has no database access and decides nothing.
 *
 *   pay     recordPaymentAction, reversePaymentAction, waiveReceiptAction,
 *           treasuryReturnAction, voidAction, overrideApproveAction
 *   view    addNoteAction
 *   manage  setChargeableAction, saveCategoryAction, endCategoryAction
 *
 * Audited (in the library, in the same transaction as the change): payment
 * recorded and reversed, receipt waived, void, override approval, send back,
 * chargeable and category changes. Not audited: a note (the events table is its
 * record). A failed audit insert rolls the act back.
 *
 * Results are the house `ReimbursementActionResult`. A database failure throws
 * and is never reported as "not allowed".
 */

function invalid(error: ZodError): ReimbursementActionFailure {
  const fieldErrors = zodFieldErrors(error);
  return { ok: false, error: Object.values(fieldErrors)[0] ?? COPY.form.saveFailed, fieldErrors };
}

/** A treasurer act moves the queue, the treasury page, and the requester's own list and page. */
function revalidateRequest(slug: string, requestId: string) {
  revalidatePath(`/o/${slug}/admin/reimbursements`);
  revalidatePath(`/o/${slug}/admin/reimbursements/${requestId}`);
  revalidatePath(`/o/${slug}/reimbursements`);
  revalidatePath(`/o/${slug}/reimbursements/${requestId}`);
}

const PAY = { anyOf: ["pay"] } as const;
const VIEW = { anyOf: ["view"] } as const;
const MANAGE = { anyOf: ["manage"] } as const;

// ---------------------------------------------------------------------------
// reimbursement.pay
// ---------------------------------------------------------------------------

/**
 * `recordPaymentAction(slug, input)` - record that a request was paid: method,
 * check number (required for a check), the date paid, an optional note. The
 * payer is the signed-in user, never an input. The approver cannot pay
 * (`payer_is_approver`), and the requester or payee can only when no other pay
 * holder could (`needs_another_payer`); the row is stamped `self_paid` by a
 * trigger and the result reports it.
 */
export async function recordPaymentAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ message: string; selfPaid: boolean }>> {
  const gate = await gateReimbursementAction(slug, PAY);
  if (!gate.ok) return gate;
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await recordPayment(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "refused":
      return paymentRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateRequest(slug, parsed.data.requestId);
  return { ok: true, data: { message: COPY.treasury.results.paymentRecorded, selfPaid: result.selfPaid } };
}

/** `reversePaymentAction(slug, input)` - the request returns to approved; both entries stay on record. */
export async function reversePaymentAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ message: string }>> {
  const gate = await gateReimbursementAction(slug, PAY);
  if (!gate.ok) return gate;
  const parsed = reversePaymentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await reversePayment(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "refused":
      return reasonVerbRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateRequest(slug, parsed.data.requestId);
  return { ok: true, data: { message: COPY.treasury.results.paymentReversed } };
}

/** `waiveReceiptAction(slug, input)` - the request can be paid without a receipt; never on the actor's own request. */
export async function waiveReceiptAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ message: string }>> {
  const gate = await gateReimbursementAction(slug, PAY);
  if (!gate.ok) return gate;
  const parsed = waiveReceiptSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await waiveReceipt(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "refused":
      return waiveRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateRequest(slug, parsed.data.requestId);
  return { ok: true, data: { message: COPY.treasury.results.receiptWaived } };
}

/**
 * `treasuryReturnAction(slug, input)` - send back for changes, from submitted
 * (when no approver exists) or from approved. The kind is fixed to "needs
 * changes"; the reason is required and the requester reads it.
 */
export async function treasuryReturnAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ message: string }>> {
  const gate = await gateReimbursementAction(slug, PAY);
  if (!gate.ok) return gate;
  const parsed = treasuryReturnSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await returnRequest(gate, { ...parsed.data, kind: "needs_info" });
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "already_decided":
      return alreadyDecidedFailure(result.status, result.decidedOn);
    case "refused":
      return treasuryReturnRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateRequest(slug, parsed.data.requestId);
  return { ok: true, data: { message: COPY.treasury.results.sentBack } };
}

/** `voidAction(slug, input)` - close an unpaid request; nothing is deleted; a reason is required. */
export async function voidAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ message: string }>> {
  const gate = await gateReimbursementAction(slug, PAY);
  if (!gate.ok) return gate;
  const parsed = voidRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await voidRequest(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "refused":
      return reasonVerbRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateRequest(slug, parsed.data.requestId);
  return { ok: true, data: { message: COPY.treasury.results.voided } };
}

/**
 * `overrideApproveAction(slug, input)` - the treasurer approves when no eligible
 * approver exists. ALWAYS the override path (a posted `path` is dropped); the
 * definer refuses while someone in the group can approve (`seat_holder_exists`)
 * and until a second pay holder exists (`needs_second_payer`: whoever approves
 * cannot also pay). The two refusals are the C8 sentences; the second carries
 * `suggestTeam` for a viewer who holds `manage`.
 */
export async function overrideApproveAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ message: string }>> {
  const gate = await gateReimbursementAction(slug, PAY);
  if (!gate.ok) return gate;
  const parsed = overrideApproveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await approveRequest(gate, { ...parsed.data, path: "override" });
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "already_decided":
      return alreadyDecidedFailure(result.status, result.decidedOn);
    case "refused": {
      let groupName: string | null = null;
      if (result.outcome === "seat_holder_exists") {
        // The group's name for the sentence. A viewer who cannot read the request (a `pay` holder
        // without `view`) gets "the group", exactly as the member form does.
        const detail = await getRequestDetail(gate, parsed.data.requestId, "member");
        groupName = detail.kind === "ok" ? (detail.detail.group?.name ?? null) : null;
      }
      return overrideRefusal(result.outcome, { groupName, holdsManage: gate.has.manage });
    }
    case "ok":
      break;
  }
  revalidateRequest(slug, parsed.data.requestId);
  return { ok: true, data: { message: COPY.treasury.results.approved } };
}

// ---------------------------------------------------------------------------
// reimbursement.view
// ---------------------------------------------------------------------------

/** `addNoteAction(slug, input)` - an internal note; only the treasury team reads it. */
export async function addNoteAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ message: string }>> {
  const gate = await gateReimbursementAction(slug, VIEW);
  if (!gate.ok) return gate;
  const parsed = addNoteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await addNote(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "refused":
      return addNoteRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidatePath(`/o/${slug}/admin/reimbursements/${parsed.data.requestId}`);
  return { ok: true, data: { message: COPY.treasury.results.noteAdded } };
}

// ---------------------------------------------------------------------------
// reimbursement.manage
// ---------------------------------------------------------------------------

function revalidateSettings(slug: string) {
  revalidatePath(`/o/${slug}/admin/reimbursements/settings`);
  revalidatePath(`/o/${slug}/admin/reimbursements`);
  // The request form reads the chargeable groups and the categories.
  revalidatePath(`/o/${slug}/reimbursements/new`);
}

/** `setChargeableAction(slug, input)` - which groups can receive requests. Un-listing ends the row; requests already in it keep going. */
export async function setChargeableAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ changed: boolean }>> {
  const gate = await gateReimbursementAction(slug, MANAGE);
  if (!gate.ok) return gate;
  const parsed = setChargeableSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await setChargeable(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "refused":
      return chargeableRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateSettings(slug);
  return { ok: true, data: { changed: result.changed } };
}

/** `saveCategoryAction(slug, input)` - create (no id) or rename/reorder. One list per organization. */
export async function saveCategoryAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ categoryId: string; created: boolean }>> {
  const gate = await gateReimbursementAction(slug, MANAGE);
  if (!gate.ok) return gate;
  const parsed = saveCategorySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await saveCategory(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "refused":
      return categoryRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateSettings(slug);
  return { ok: true, data: { categoryId: result.categoryId, created: result.created } };
}

/** `endCategoryAction(slug, input)` - retire a category; it stays on old requests. */
export async function endCategoryAction(slug: string, input: unknown): Promise<ReimbursementActionResult> {
  const gate = await gateReimbursementAction(slug, MANAGE);
  if (!gate.ok) return gate;
  const parsed = endCategorySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await endCategory(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "refused":
      return categoryRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateSettings(slug);
  return { ok: true, data: undefined };
}
