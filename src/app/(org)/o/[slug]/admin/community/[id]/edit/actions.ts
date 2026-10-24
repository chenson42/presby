"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { updatePerson, type UpdatePersonInput } from "@/lib/people";
import { EMAIL_COPY, emailRefusalMessage } from "@/lib/contact-methods/copy";
import { parseUpdateEmails } from "@/lib/contact-methods/email-rows-schema";
import type { PersonSaveNotes } from "@/lib/contact-methods/types";
import {
  recordParticipantAction,
  recordRollAction,
  voidParticipantAction,
  type RecordRollActionInput,
} from "@/lib/roll";
import { isUuid } from "@/lib/is-uuid";
import { isRealYmd, todayUtcYmd } from "@/lib/ymd";
import type { ActionResult } from "@/types/actions";
import {
  PARTICIPANT_COPY,
  PROPOSAL_COPY,
  VALIDATION_COPY,
} from "../../participant-copy";

/**
 * Server Action for `/o/<slug>/admin/community/[id]/edit`. Same plumbing shape
 * as `admin/community/new/actions.ts`: `auth()` not `cachedAuth()`,
 * `organizationId` never trusted from the client, `resolveOrgContext()`
 * re-run inside the action body — the permission check itself lives in
 * `updatePerson()`, not duplicated here.
 *
 * The audit actor comes from the SESSION, never from `input`. A posted list of
 * email rows is parsed and REBUILT by `parseUpdateEmails()` (a Server Action's
 * parameter type is not a runtime boundary), and a thrown database error is
 * logged by class only (a message can carry an address) and shown as the one
 * fixed "couldn't save" string, never a raw database message. The audit rows
 * (`tenant.person.updated`, `tenant.person_email.*`) are written by the
 * library in the save's own transaction, not here.
 */
export async function updatePersonAction(
  slug: string,
  input: UpdatePersonInput,
): Promise<ActionResult<{ personId: string; notes?: PersonSaveNotes }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  let contact: UpdatePersonInput["contact"] = {};
  if (typeof input.contact?.phone === "string") contact.phone = input.contact.phone;
  if (input.contact?.emails !== undefined) {
    const emails = parseUpdateEmails(input.contact.emails);
    if (!emails.ok) return { ok: false, error: emails.error };
    contact = { ...contact, emails: emails.value };
  }

  let result: Awaited<ReturnType<typeof updatePerson>>;
  try {
    result = await updatePerson(
      resolved.org.personId,
      resolved.org.organizationId,
      {
        personId: input.personId,
        identity: input.identity,
        contact,
        address: input.address,
        household: input.household,
      },
      { userId: session.user.id, email: session.user.email ?? null },
    );
  } catch (err) {
    console.error("[updatePersonAction] save failed:", errorClass(err));
    return { ok: false, error: EMAIL_COPY.saveFailed };
  }

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to edit members here.",
      };
    case "not_found":
      return {
        ok: false,
        error: "That person could not be found.",
      };
    case "invalid_household":
      return {
        ok: false,
        error: "That household no longer exists. Choose another or create a new one.",
      };
    case "email_refused":
      return { ok: false, error: emailRefusalMessage(result.refusal) };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/directory`);
  revalidatePath(`/o/${slug}/directory/${input.personId}`);

  return {
    ok: true,
    data: {
      personId: input.personId,
      ...(result.notes ? { notes: result.notes } : {}),
    },
  };
}

/** Error CLASS only, for logs: never the message (it can carry values). */
function errorClass(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  return code ? `${name}/${code}` : name;
}

const MAX_MINUTE_REFERENCE = 200;
const MAX_REASON = 500;

/**
 * Server Action for `RecordRollActionForm` - same plumbing shape as
 * `updatePersonAction` above and as `admin/community/new/actions.ts`'s
 * `createPersonAction`: `auth()`, `resolveOrgContext()` re-run inside the
 * action body, the permission check itself lives in `recordRollAction()`,
 * not duplicated here. Revalidates the Community list AND the pending
 * worklist - a new `pending` row must show up there immediately.
 *
 * WHAT TAKES EFFECT ON RECORD IS DECIDED BY THE KIND, in the lib and the
 * database function, never by anything in `input` (DECISION-198, R4): an
 * `other_participant_enrolled` is approved at insert and audited
 * (`tenant.roll_action.recorded`, in the same transaction, by the lib); every
 * other kind is a pending proposal. The action rebuilds `input` from its known
 * fields so a forged extra property cannot flow through.
 */
export async function recordRollActionAction(
  slug: string,
  input: RecordRollActionInput,
): Promise<
  ActionResult<{
    rollActionId: string;
    effect: "pending" | "recorded";
    affectsFiledPeriod: boolean;
    shadowed: { kind: string; effectiveDate: string } | null;
  }>
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: VALIDATION_COPY.signedOut };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: VALIDATION_COPY.noAccess };
  }

  // Bad input is a message, not the lib's throw. A PROPOSAL may be dated
  // ahead; an on-record kind may not (the database refuses it too, and its
  // refusal maps below).
  if (!input || !isUuid(input.personId)) {
    return { ok: false, error: PARTICIPANT_COPY.person_not_found };
  }
  if (!isRealYmd(input.effectiveDate)) {
    return { ok: false, error: VALIDATION_COPY.badDate };
  }
  const minute =
    typeof input.minuteReference === "string" ? input.minuteReference.trim() : "";
  if (minute.length > MAX_MINUTE_REFERENCE) {
    return { ok: false, error: VALIDATION_COPY.minuteTooLong };
  }

  const result = await recordRollAction(
    resolved.org.personId,
    resolved.org.organizationId,
    session.user.id,
    {
      personId: input.personId,
      kind: input.kind,
      effectiveDate: input.effectiveDate,
      minuteReference: minute === "" ? undefined : minute,
    },
    { actingUserEmail: session.user.email ?? null },
  );

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: PARTICIPANT_COPY.forbidden };
    case "not_found":
      return { ok: false, error: PARTICIPANT_COPY.person_not_found };
    case "invalid_kind":
      return { ok: false, error: PARTICIPANT_COPY.invalid_kind };
    case "refused":
      return { ok: false, error: PARTICIPANT_COPY[result.reason] };
    case "proposal_refused":
      return { ok: false, error: PROPOSAL_COPY[result.reason] };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/admin/community/pending`);
  revalidatePath(`/o/${slug}/admin/community/${input.personId}/edit`);

  return {
    ok: true,
    data: {
      rollActionId: result.rollActionId,
      effect: result.effect,
      affectsFiledPeriod: result.affectsFiledPeriod,
      shadowed: result.shadowedBy,
    },
  };
}

/**
 * Removes a participant ON RECORD (no Session approval): an
 * `other_participant_removed` roll row and the membership's `ended_on`, in one
 * transaction with its `tenant.roll_action.recorded` audit row (DECISION-198).
 * The date is bounded here (a real 'YYYY-MM-DD', not after today UTC) and again
 * by the database function. The kind is fixed in this action - never read from
 * client input.
 */
export async function removeParticipantAction(
  slug: string,
  input: { personId: string; effectiveDate: string; minuteReference?: string },
): Promise<ActionResult<{ rollActionId: string; affectsFiledPeriod: boolean }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: VALIDATION_COPY.signedOut };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: VALIDATION_COPY.noAccess };
  }

  if (!input || !isUuid(input.personId)) {
    return { ok: false, error: PARTICIPANT_COPY.person_not_found };
  }
  if (!isRealYmd(input.effectiveDate) || input.effectiveDate > todayUtcYmd()) {
    return { ok: false, error: VALIDATION_COPY.badDate };
  }
  const minute =
    typeof input.minuteReference === "string" ? input.minuteReference.trim() : "";
  if (minute.length > MAX_MINUTE_REFERENCE) {
    return { ok: false, error: VALIDATION_COPY.minuteTooLong };
  }

  const result = await recordParticipantAction(
    resolved.org.personId,
    resolved.org.organizationId,
    session.user.id,
    {
      personId: input.personId,
      kind: "other_participant_removed",
      effectiveDate: input.effectiveDate,
      minuteReference: minute === "" ? undefined : minute,
    },
    { actingUserEmail: session.user.email ?? null },
  );

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: PARTICIPANT_COPY.forbidden };
    case "refused":
      return { ok: false, error: PARTICIPANT_COPY[result.reason] };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/admin/community/${input.personId}/edit`);
  revalidatePath(`/o/${slug}/directory`);

  return {
    ok: true,
    data: {
      rollActionId: result.rollActionId,
      affectsFiledPeriod: result.affectsFiledPeriod,
    },
  };
}

/**
 * Undoes the person's latest participant entry by recording a void (F175):
 * only the latest effective action, only an on-record kind, only if not already
 * undone; undoing a removal reopens the membership only if it still matches the
 * removal's own end date and reason. A reason is required (1 to 500 characters)
 * and is written to the `tenant.roll_action.voided` audit row.
 */
export async function undoParticipantEntryAction(
  slug: string,
  input: { rollActionId: string; reason: string },
): Promise<
  ActionResult<{
    voidRollActionId: string;
    membershipReopened: boolean;
    affectsFiledPeriod: boolean;
    undoneKind: "other_participant_enrolled" | "other_participant_removed";
  }>
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: VALIDATION_COPY.signedOut };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: VALIDATION_COPY.noAccess };
  }

  if (!input || !isUuid(input.rollActionId)) {
    return { ok: false, error: PARTICIPANT_COPY.action_not_found };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") {
    return { ok: false, error: PARTICIPANT_COPY.reason_required };
  }
  if (reason.length > MAX_REASON) {
    return { ok: false, error: PARTICIPANT_COPY.reason_too_long };
  }

  const result = await voidParticipantAction(
    resolved.org.personId,
    resolved.org.organizationId,
    session.user.id,
    { rollActionId: input.rollActionId, reason },
    { actingUserEmail: session.user.email ?? null },
  );

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: PARTICIPANT_COPY.forbidden };
    case "refused":
      return { ok: false, error: PARTICIPANT_COPY[result.reason] };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/admin/community/[id]/edit`, "page");
  revalidatePath(`/o/${slug}/directory`);

  return {
    ok: true,
    data: {
      voidRollActionId: result.voidRollActionId,
      membershipReopened: result.membershipReopened,
      affectsFiledPeriod: result.affectsFiledPeriod,
      undoneKind: result.voidedKind,
    },
  };
}
