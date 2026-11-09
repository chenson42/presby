"use server";

import { revalidatePath } from "next/cache";
import { ACTION_COPY } from "@/lib/worship/copy";
import { guardedCall, resolveActionIdentity, toActionResult } from "@/lib/worship/action-gate";
import {
  addBlockoutSchema,
  endBlockoutSchema,
  pickerCandidatesSchema,
  placeGuestSchema,
  placePersonSchema,
  recordResponseSchema,
  removeAssignmentSchema,
  respondToRequestSchema,
  sendPreviewSchema,
  sendRequestsSchema,
} from "@/lib/worship/input";
import { sendQueued } from "@/lib/worship/notify";
import { getPickerCandidates, getSendPreview, type PickerCandidate, type SendPreview } from "@/lib/worship/reads";
import {
  addBlockout,
  endBlockout,
  placeGuest,
  placePerson,
  recordResponse,
  removeAssignment,
  respondToAssignment,
  sendRequests,
  type BlockoutConflict,
} from "@/lib/worship/store";
import type { ActionResult } from "@/types/actions";

/**
 * Server actions for the member tree `/o/<slug>/worship/**` - docs/work-log/
 * 2026-11-04-worship-inc1.md, Phase 3 "Server actions": the volunteer's own
 * answers and dates (`respondToRequestAction`, `addBlockoutAction`,
 * `endBlockoutAction`) and the SCHEDULING actions (`placePersonAction`,
 * `placeGuestAction`, `removeAssignmentAction`, `recordResponseAction`,
 * `sendRequestsAction`), which the admin board imports from here so the board has
 * one set of actions.
 *
 * Each action: authenticate and resolve the organization from the URL SLUG
 * (`resolveActionIdentity`, inside THIS user's own memberships), parse the input
 * (`input.ts`), call ONE store export with a viewer derived from the session and
 * the slug, and map the result to the `{ ok, data } | { ok: false, error }` shape
 * the client toasts. NO action takes an organization id or the acting person from
 * its input: the store derives the answering person and the placing person from
 * the viewer, so a request id belonging to someone else is the store's `not_found`
 * (the same sentence as an unknown id).
 *
 * Two actions attempt an inline email send AFTER the store's transaction has
 * committed (`sendQueued`, which never throws): the Send and a decline. A failed
 * attempt leaves the row queued for the five-minute worker. All correctness - the
 * gate (applicability, toggle, key or seat or own row), the validation, the
 * sole-writer rule and the audit rows - is in and proven by
 * `src/lib/worship/store.ts`; this file has no table access. `check:audit` scans
 * only these bodies for literal database writes and the actions call the store, so
 * the audit rows are pinned by `store.audit.db.test.ts` (the groups precedent).
 *
 * Uses `auth()` directly: each action is its own invocation.
 */

const HOME = (slug: string) => `/o/${slug}/worship`;

function revalidateSchedule(slug: string, parts: { groupId?: string; eventId?: string; assignmentId?: string } = {}) {
  revalidatePath(HOME(slug));
  if (parts.assignmentId) revalidatePath(`${HOME(slug)}/requests/${parts.assignmentId}`);
  if (parts.groupId && parts.eventId) revalidatePath(`${HOME(slug)}/teams/${parts.groupId}/services/${parts.eventId}`);
  if (parts.groupId) revalidatePath(`${HOME(slug)}/teams/${parts.groupId}`);
  revalidatePath(`/o/${slug}/admin/worship/services`);
  if (parts.eventId) revalidatePath(`/o/${slug}/admin/worship/services/${parts.eventId}`);
}

// ---------------------------------------------------------------------------
// The volunteer's own answers and dates
// ---------------------------------------------------------------------------

/** Accept or decline MY request. The store derives the person from the session; there is no person parameter. */
export async function respondToRequestAction(slug: string, input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = respondToRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => respondToAssignment(who.identity.viewer, parsed.data));
  if (result.kind === "ok") await sendQueued(result.data.queueIds);
  revalidateSchedule(who.identity.slug, { assignmentId: parsed.data.assignmentId });
  return toActionResult(result, who.identity.organizationName, (d) => ({ changed: d.changed }));
}

export interface AddBlockoutData {
  blockoutId: string;
  merged: boolean;
  conflicts: BlockoutConflict[];
}

export async function addBlockoutAction(slug: string, input: unknown): Promise<ActionResult<AddBlockoutData>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = addBlockoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => addBlockout(who.identity.viewer, parsed.data));
  revalidatePath(`${HOME(who.identity.slug)}/blockouts`);
  return toActionResult(result, who.identity.organizationName);
}

export async function endBlockoutAction(slug: string, input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = endBlockoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => endBlockout(who.identity.viewer, parsed.data));
  revalidatePath(`${HOME(who.identity.slug)}/blockouts`);
  return toActionResult(result, who.identity.organizationName);
}

// ---------------------------------------------------------------------------
// Scheduling: a key holder or a leader of the team
// ---------------------------------------------------------------------------

export async function placePersonAction(slug: string, input: unknown): Promise<ActionResult<{ assignmentId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = placePersonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => placePerson(who.identity.viewer, parsed.data));
  revalidateSchedule(who.identity.slug, { groupId: parsed.data.groupId, eventId: parsed.data.eventId });
  return toActionResult(result, who.identity.organizationName);
}

export async function placeGuestAction(slug: string, input: unknown): Promise<ActionResult<{ assignmentId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = placeGuestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => placeGuest(who.identity.viewer, parsed.data));
  revalidateSchedule(who.identity.slug, { groupId: parsed.data.groupId, eventId: parsed.data.eventId });
  return toActionResult(result, who.identity.organizationName);
}

/** Take someone off a position. No message is sent (F430). */
export async function removeAssignmentAction(slug: string, input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = removeAssignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => removeAssignment(who.identity.viewer, parsed.data));
  revalidateSchedule(who.identity.slug, { assignmentId: parsed.data.assignmentId });
  return toActionResult(result, who.identity.organizationName);
}

/** Record an answer on someone's behalf. Saved attributed to the recorder. */
export async function recordResponseAction(slug: string, input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = recordResponseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => recordResponse(who.identity.viewer, parsed.data));
  revalidateSchedule(who.identity.slug, { assignmentId: parsed.data.assignmentId });
  return toActionResult(result, who.identity.organizationName);
}

export interface SendRequestsData {
  sent: number;
  emailed: number;
  /** People who could not be emailed: may be under 18, no address, or marked do not contact. */
  notEmailed: number;
  notOnTeam: number;
  services: number;
}

/** Send the drafts in scope: one email per person. The inline send is attempted AFTER the commit and never throws. */
export async function sendRequestsAction(slug: string, input: unknown): Promise<ActionResult<SendRequestsData>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = sendRequestsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => sendRequests(who.identity.viewer, parsed.data));
  if (result.kind === "ok") await sendQueued(result.data.queueIds);
  revalidateSchedule(who.identity.slug, { groupId: parsed.data.groupId });
  return toActionResult(result, who.identity.organizationName, (d) => ({
    sent: d.sent,
    emailed: d.emailed,
    notEmailed: d.guardian + d.noAddress + d.doNotContact,
    notOnTeam: d.notOnTeam,
    services: d.services,
  }));
}

// ---------------------------------------------------------------------------
// Reads the scheduling dialogs call (Batch 4). They write nothing; the store read
// repeats the gate (`schedule` or a live seat on the team) inside its own
// transaction, so a forged call is refused exactly as a forged write is.
// ---------------------------------------------------------------------------

/** The roster of one team, for one position on one service, with the picker's warnings. */
export async function getPickerCandidatesAction(slug: string, input: unknown): Promise<ActionResult<PickerCandidate[]>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = pickerCandidatesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => getPickerCandidates(who.identity.viewer, parsed.data));
  return toActionResult(result, who.identity.organizationName);
}

/** What a Send with this scope WOULD do, without writing: the counts the Send dialog prints. */
export async function getSendPreviewAction(slug: string, input: unknown): Promise<ActionResult<SendPreview>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = sendPreviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => getSendPreview(who.identity.viewer, parsed.data));
  return toActionResult(result, who.identity.organizationName);
}
