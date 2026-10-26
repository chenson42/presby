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
import {
  resendSignInInvitation,
  revokeSignInInvitation,
  sendSignInInvitation,
  type SignInContext,
  type SignInSendResult,
} from "@/lib/onboarding/org-invite";
import { signInRefusalMessage } from "@/lib/onboarding/sign-in-copy";
import type { SignInActionResult } from "@/lib/onboarding/sign-in-types";
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

// ---------------------------------------------------------------------------
// Sign-in invitations (Community Increment 2b, Batch B2; Phase 3 "Server
// actions"). The congregation invites one of its own people from the person's
// edit page. Same plumbing as every action above: `auth()` not `cachedAuth()`,
// `resolveOrgContext()` re-run inside the body, and the organization, the acting
// person and the acting USER are all derived here from the session and the slug,
// never from the client. The client supplies a person id (a selection), the
// address the sender CONFIRMED and whether they acknowledged; the address the
// email goes to is chosen by the database from the person's record, so a posted
// address can only be refused (`address_changed`), never used.
//
// These actions hold no `db.*` call and write no audit row of their own: the
// library writes `invitation.created / .resent / .revoked` in the transaction
// that made the change (a failed audit insert rolls the invitation back), so
// `check:audit` passes vacuously, as it does for the actions above.
// ---------------------------------------------------------------------------

type SignInGate =
  | { ok: true; ctx: SignInContext; congregation: string }
  | { ok: false; error: string };

async function signInGate(slug: string): Promise<SignInGate> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in to do that." };
  if (typeof slug !== "string") return { ok: false, error: "You don't have access to that organization." };
  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") return { ok: false, error: "You don't have access to that organization." };
  return {
    ok: true,
    congregation: resolved.org.name,
    ctx: {
      organizationId: resolved.org.organizationId,
      actingPersonId: resolved.org.personId,
      actingUserId: session.user.id,
      actingUserEmail: session.user.email ?? null,
    },
  };
}

/** Rebuild the input from its known fields: a forged extra property cannot flow through. */
function signInInput(input: unknown): { personId: string; confirmedAddress: string; acknowledged: boolean } | null {
  if (typeof input !== "object" || input === null) return null;
  const { personId, confirmedAddress, acknowledged } = input as Record<string, unknown>;
  return {
    personId: typeof personId === "string" ? personId : "",
    confirmedAddress: typeof confirmedAddress === "string" ? confirmedAddress : "",
    acknowledged: acknowledged === true,
  };
}

function revalidateSignIn(slug: string, personId: string): void {
  revalidatePath(`/o/${slug}/admin/community/${personId}/edit`);
  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/admin/community/pending`);
  revalidatePath(`/o/${slug}/admin/officers`);
}

function sendResultToAction(result: SignInSendResult, congregation: string): SignInActionResult {
  switch (result.kind) {
    case "ok":
      return {
        ok: true,
        data: { address: result.address, expiresAt: result.expiresAt.toISOString(), delivery: result.delivery },
      };
    case "forbidden":
      return { ok: false, error: signInRefusalMessage("forbidden") };
    case "invalid_input":
      // A confirmation that is not even an address cannot match the record: the
      // same sentence as a stale confirmation (nothing new to say).
      return { ok: false, error: signInRefusalMessage("address_changed") };
    case "totp_unavailable":
      return { ok: false, error: signInRefusalMessage("totp_unavailable") };
    case "link_origin_unavailable":
      return { ok: false, error: signInRefusalMessage("link_origin_unavailable") };
    case "db_error":
      return { ok: false, error: signInRefusalMessage("db_error") };
    case "refused": {
      if (result.reason === "needs_acknowledgement") {
        // Not an error: the dialog shows its acknowledgement paragraphs.
        return { ok: false, error: "", needsAcknowledgement: result.ackReasons ?? [] };
      }
      if (result.reason === "cooldown") {
        const minutes = result.nextResendAt
          ? Math.max(1, Math.ceil((result.nextResendAt.getTime() - Date.now()) / 60_000))
          : 1;
        return {
          ok: false,
          error: signInRefusalMessage("cooldown", { minutes }),
          retryAfterMinutes: minutes,
        };
      }
      return {
        ok: false,
        error: signInRefusalMessage(result.reason, { name: result.personName ?? null, congregation }),
      };
    }
  }
}

/**
 * Invite a person to sign in. Gate: a signed-in member of this organization who
 * holds `people.manage` (the library checks it; the definer re-checks it).
 */
export async function sendSignInInvitationAction(
  slug: string,
  input: { personId: string; confirmedAddress: string; acknowledged?: boolean },
): Promise<SignInActionResult> {
  const gate = await signInGate(slug);
  if (!gate.ok) return { ok: false, error: gate.error };
  const clean = signInInput(input);
  if (!clean) return { ok: false, error: signInRefusalMessage("not_found") };

  const result = await sendSignInInvitation(gate.ctx, clean);
  if (result.kind === "ok") revalidateSignIn(slug, clean.personId);
  return sendResultToAction(result, gate.congregation);
}

/** Send the open invitation again: the earlier link stops working and the CURRENT address is re-read. */
export async function resendSignInInvitationAction(
  slug: string,
  input: { personId: string; confirmedAddress: string; acknowledged?: boolean },
): Promise<SignInActionResult> {
  const gate = await signInGate(slug);
  if (!gate.ok) return { ok: false, error: gate.error };
  const clean = signInInput(input);
  if (!clean) return { ok: false, error: signInRefusalMessage("not_found") };

  const result = await resendSignInInvitation(gate.ctx, clean);
  if (result.kind === "ok") revalidateSignIn(slug, clean.personId);
  return sendResultToAction(result, gate.congregation);
}

/** Cancel the person's open invitation. Terminal; refunds no limit. */
export async function revokeSignInInvitationAction(
  slug: string,
  input: { personId: string },
): Promise<ActionResult> {
  const gate = await signInGate(slug);
  if (!gate.ok) return { ok: false, error: gate.error };
  const personId = typeof input?.personId === "string" ? input.personId : "";

  const result = await revokeSignInInvitation(gate.ctx, { personId });
  switch (result.kind) {
    case "ok":
      revalidateSignIn(slug, personId);
      return { ok: true };
    case "forbidden":
      return { ok: false, error: signInRefusalMessage("forbidden") };
    case "refused":
      return { ok: false, error: signInRefusalMessage(result.reason) };
    case "db_error":
      return { ok: false, error: signInRefusalMessage("db_error") };
  }
}
