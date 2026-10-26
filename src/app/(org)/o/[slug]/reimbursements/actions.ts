"use server";

import { revalidatePath } from "next/cache";
import { COPY } from "@/lib/reimbursement/copy";
import { approveRequest, returnRequest } from "@/lib/reimbursement/decisions";
import { gateReimbursementAction } from "@/lib/reimbursement/gate";
import {
  approveRequestSchema,
  returnRequestSchema,
  searchBeneficiariesSchema,
  saveRequestSchema,
  submitRequestSchema,
  withdrawRequestSchema,
} from "@/lib/reimbursement/input";
import {
  alreadyDecidedFailure,
  decisionRefusal,
  incompleteRefusal,
  returnedMessage,
  saveRefusal,
  sentMessage,
  submitRefusal,
} from "@/lib/reimbursement/messages";
import { searchBeneficiaries, type BeneficiaryCandidate } from "@/lib/reimbursement/pickers";
import { saveRequest, submitRequest, withdrawRequest } from "@/lib/reimbursement/requests";
import {
  zodFieldErrors,
  type ReimbursementActionFailure,
  type ReimbursementActionResult,
} from "@/lib/reimbursement/action-result";
import { MAX_LENGTH } from "@/lib/reimbursement/limits";
import type { SubmitRoute } from "@/lib/reimbursement/outcomes";

/**
 * Server Actions for the member reimbursement pages `/o/<slug>/reimbursements/**`
 * - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 API Contract Layer 3
 * (Batch 2a: the actions that need no receipt; Batch 3: approve and send back;
 * the receipt upload and detach are Batch 2b, the treasurer tree Batch 4).
 *
 * Every action takes the URL SLUG (never an organization id, never a person id),
 * begins with `gateReimbursementAction` (sign-in, the Node-side 2FA check, the
 * four-way org miss, applicability, the toggle) and then calls ONE library
 * function that runs in a single `withOrgContext`. Who may FILE is the
 * database's `may_file`; the actor is always the signed-in user.
 *
 * Not audited: save, submit, withdraw - `reimbursement_events` is their record
 * (Phase 3 "Not audited", accepted by design). The library functions write no
 * audit row for them, and this file has no direct database access.
 */

function invalid(error: import("zod").ZodError): ReimbursementActionFailure {
  const fieldErrors = zodFieldErrors(error);
  return { ok: false, error: Object.values(fieldErrors)[0] ?? COPY.form.saveFailed, fieldErrors };
}

function revalidate(slug: string, requestId?: string) {
  revalidatePath(`/o/${slug}/reimbursements`);
  if (requestId) revalidatePath(`/o/${slug}/reimbursements/${requestId}`);
}

/** A decision also moves the treasurer's queue and the request's treasury page. */
function revalidateDecision(slug: string, requestId: string) {
  revalidate(slug, requestId);
  revalidatePath(`/o/${slug}/admin/reimbursements`);
  revalidatePath(`/o/${slug}/admin/reimbursements/${requestId}`);
}

/** `saveRequestAction(slug, input)` - create-or-find by the form's `clientKey`, or edit by `requestId`. */
export async function saveRequestAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ requestId: string; revision: number }>> {
  const gate = await gateReimbursementAction(slug);
  if (!gate.ok) return gate;
  const parsed = saveRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await saveRequest(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "refused":
      return saveRefusal(result.outcome, { organizationName: gate.organizationName });
    case "ok":
      break;
  }
  revalidate(slug, result.requestId);
  return { ok: true, data: { requestId: result.requestId, revision: result.revision } };
}

/** `submitRequestAction(slug, input)` - send a draft or returned request on the revision the requester saw. */
export async function submitRequestAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ route: SubmitRoute | null; groupName: string | null; message: string; revision: number }>> {
  const gate = await gateReimbursementAction(slug);
  if (!gate.ok) return gate;
  const parsed = submitRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await submitRequest(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "incomplete":
      return incompleteRefusal(result.missing);
    case "refused":
      return submitRefusal(result.outcome, { organizationName: gate.organizationName });
    case "ok":
      break;
  }
  revalidate(slug, parsed.data.requestId);
  return {
    ok: true,
    data: {
      route: result.route,
      groupName: result.groupName,
      message: sentMessage(result.route, result.groupName),
      revision: result.revision,
    },
  };
}

/** `withdrawRequestAction(slug, input)` - the creator, or the beneficiary who has an account. Never from paid. */
export async function withdrawRequestAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult> {
  const gate = await gateReimbursementAction(slug);
  if (!gate.ok) return gate;
  const parsed = withdrawRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await withdrawRequest(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "not_withdrawable":
      return {
        ok: false,
        error: result.status === "paid" ? COPY.decision.withdrawAlreadyPaid : COPY.detail.unavailable,
        ...(result.status === "paid" ? {} : { kind: "not_found" as const }),
      };
    case "refused":
      return result.outcome === "reason_too_long"
        ? { ok: false, error: COPY.fieldErrors.tooLong(MAX_LENGTH.reason), fieldErrors: { reason: COPY.fieldErrors.tooLong(MAX_LENGTH.reason) } }
        : { ok: false, error: COPY.detail.unavailable, kind: "not_found" };
    case "ok":
      break;
  }
  revalidate(slug, parsed.data.requestId);
  return { ok: true, data: undefined };
}

/**
 * `searchBeneficiariesAction(slug, input)` - names only, at most eight. Gated on
 * `request_for_others`: a caller without it gets the same empty list as a query
 * that matches no one.
 */
export async function searchBeneficiariesAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ candidates: BeneficiaryCandidate[] }>> {
  const gate = await gateReimbursementAction(slug);
  if (!gate.ok) return gate;
  const parsed = searchBeneficiariesSchema.safeParse(input);
  // Too short, too long, or not a string: nothing to search, nothing learned.
  if (!parsed.success) return { ok: true, data: { candidates: [] } };

  const candidates = await searchBeneficiaries(gate, parsed.data.query);
  return { ok: true, data: { candidates } };
}

/**
 * `approveRequestAction(slug, input)` - an eligible approver of the request's group
 * approves it on the revision they were looking at. `already_decided` carries the
 * date (org-local) and the status, never who decided it.
 */
export async function approveRequestAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ message: string }>> {
  const gate = await gateReimbursementAction(slug);
  if (!gate.ok) return gate;
  const parsed = approveRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await approveRequest(gate, { ...parsed.data, path: "seat" });
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "already_decided":
      return alreadyDecidedFailure(result.status, result.decidedOn);
    case "refused":
      return decisionRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateDecision(slug, parsed.data.requestId);
  return { ok: true, data: { message: COPY.decision.approved } };
}

/**
 * `returnRequestAction(slug, input)` - send back for changes, or mark not approved,
 * with the reason the requester will read. The reason is required.
 */
export async function returnRequestAction(
  slug: string,
  input: unknown,
): Promise<ReimbursementActionResult<{ message: string }>> {
  const gate = await gateReimbursementAction(slug);
  if (!gate.ok) return gate;
  const parsed = returnRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const result = await returnRequest(gate, parsed.data);
  switch (result.kind) {
    case "denied":
      return { ok: false, error: COPY.gate.notPermitted };
    case "already_decided":
      return alreadyDecidedFailure(result.status, result.decidedOn);
    case "refused":
      return decisionRefusal(result.outcome);
    case "ok":
      break;
  }
  revalidateDecision(slug, parsed.data.requestId);
  return { ok: true, data: { message: returnedMessage(result.returnedKind) } };
}
