"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  createPerson,
  matchPerson,
  type CreatePersonInput,
  type MatchCandidate,
  type MatchPersonInput,
} from "@/lib/people";
import { isRealYmd, todayUtcYmd } from "@/lib/ymd";
import type { ActionResult } from "@/types/actions";
import {
  CREATE_COPY,
  PARTICIPANT_COPY,
  VALIDATION_COPY,
} from "../participant-copy";

/**
 * Server Actions for `/o/<slug>/admin/community/new` — the wizard's search step
 * and its single final submit. Same plumbing shape as `admin/roles/
 * actions.ts`: `auth()` not `cachedAuth()`, `organizationId` never trusted
 * from the client, `resolveOrgContext()` re-run inside every action body.
 *
 * NEITHER ACTION CALLS `recordAudit()`. `matchPerson()` is a read. A new
 * person with a pending proposal or a visitor writes no audit event by design
 * (only feature-toggle and roll-approve/deny were audited, per the original
 * Phase 2 ruling); a participant enrolment that takes effect ON RECORD IS
 * audited (`tenant.roll_action.recorded`, DECISION-198), but by
 * `createPerson()` -> `recordParticipantActionInTx()` with `insertAuditRow()`
 * in the SAME transaction, not here. The kind alone decides what takes effect
 * on record, inside the lib and the database function: nothing in the payload
 * (no flag, no extra field) can make a membership kind approved. This action
 * rebuilds `rollAction` from the validated fields so no stray property flows
 * through.
 *
 * ALLOW-LIST AT RUNTIME: `profession_of_faith`, `other_participant_enrolled`
 * and `visitor` (DECISION-200). `"none"` and any unknown kind are rejected.
 *
 * `rollAction.kind === "none"` REJECTED HERE, AT RUNTIME (docs/work-log/
 * 2026-08-27-staff-and-personnel.md, DECISION-128/129 follow-on). `people.ts`
 * widened `CreatePersonInput.rollAction` to a third arm for staff hiring's
 * inline person-create, and this action still accepts a plain
 * `CreatePersonInput` from client input — a Server Action's parameter types
 * are not a runtime boundary (an arbitrary caller who knows this action's id
 * can post any JSON shape regardless of what `member-wizard-schema.ts`'s zod
 * schema allows client-side). The member wizard's whole contract is "every
 * new member gets a real roll action" — silently letting a `"none"` payload
 * through here would let anyone reachable at this action skip that
 * requirement entirely, since `createPerson()` itself now only requires
 * `people.manage` (not `roll.propose`) for that kind. Checked and rejected
 * BEFORE calling `createPerson()`, not left to fall through as a type error.
 */

async function resolveActingIdentity(slug: string): Promise<
  | {
      ok: true;
      userId: string;
      email: string | null;
      personId: string;
      organizationId: string;
    }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: VALIDATION_COPY.signedOut };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: VALIDATION_COPY.noAccess };
  }

  return {
    ok: true,
    userId: session.user.id,
    email: session.user.email ?? null,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
  };
}

export async function matchPersonAction(
  slug: string,
  input: MatchPersonInput,
): Promise<ActionResult<{ candidates: MatchCandidate[] }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await matchPerson(identity.personId, identity.organizationId, input);

  if (result.kind === "forbidden") {
    return { ok: false, error: CREATE_COPY.forbidden };
  }

  return { ok: true, data: { candidates: result.candidates } };
}

const MAX_FREE_TEXT = 200;

/**
 * Validates and REBUILDS `rollAction` from its known fields. Returns an error
 * string for anything off the allow-list or malformed, so a user sees a
 * message (the lib throws on bad input) and no unexpected property reaches
 * `createPerson()`.
 */
function sanitizeRollAction(
  raw: CreatePersonInput["rollAction"] | undefined,
): { ok: true; rollAction: CreatePersonInput["rollAction"] } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: VALIDATION_COPY.unknownKind };
  }
  const today = todayUtcYmd();

  if (raw.kind === "visitor") {
    const first =
      typeof raw.firstVisitDate === "string" ? raw.firstVisitDate.trim() : "";
    if (first !== "" && (!isRealYmd(first) || first > today)) {
      return { ok: false, error: VALIDATION_COPY.badFirstVisit };
    }
    const heard = typeof raw.howHeard === "string" ? raw.howHeard.trim() : "";
    if (heard.length > MAX_FREE_TEXT) {
      return { ok: false, error: VALIDATION_COPY.howHeardTooLong };
    }
    return {
      ok: true,
      rollAction: {
        kind: "visitor",
        firstVisitDate: first === "" ? undefined : first,
        howHeard: heard === "" ? undefined : heard,
      },
    };
  }

  if (raw.kind === "profession_of_faith" || raw.kind === "other_participant_enrolled") {
    // A participant enrolment takes effect on record, so it may not be dated
    // after today (the database refuses it too). A PROPOSAL may be dated ahead
    // (a profession at an upcoming service): the Session decides it and the
    // daily reconcile moves the cache when the date arrives (F29).
    if (
      !isRealYmd(raw.effectiveDate) ||
      (raw.kind === "other_participant_enrolled" && raw.effectiveDate > today)
    ) {
      return { ok: false, error: VALIDATION_COPY.badDate };
    }
    const minute =
      typeof raw.minuteReference === "string" ? raw.minuteReference.trim() : "";
    if (minute.length > MAX_FREE_TEXT) {
      return { ok: false, error: VALIDATION_COPY.minuteTooLong };
    }
    return {
      ok: true,
      rollAction: {
        kind: raw.kind,
        effectiveDate: raw.effectiveDate,
        minuteReference: minute === "" ? undefined : minute,
      },
    };
  }

  // "none" (the staff anchor) and anything unknown. See this file's header.
  return { ok: false, error: "A connection is required to add a new person." };
}

export async function createPersonAction(
  slug: string,
  input: CreatePersonInput,
): Promise<
  ActionResult<{
    personId: string;
    rollActionId: string | null;
    effect: "none" | "pending" | "recorded";
    affectsFiledPeriod: boolean;
  }>
> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  // See this file's header comment - a client-supplied "none" (or any unknown
  // kind) must never reach createPerson() from THIS action.
  const checked = sanitizeRollAction(input.rollAction);
  if (!checked.ok) {
    return { ok: false, error: checked.error };
  }
  if (
    input.identity?.mode === "new" &&
    input.identity.dateOfBirth !== undefined &&
    input.identity.dateOfBirth !== "" &&
    !isRealYmd(input.identity.dateOfBirth)
  ) {
    return { ok: false, error: VALIDATION_COPY.badBirthDate };
  }

  const result = await createPerson(
    identity.personId,
    identity.organizationId,
    identity.userId,
    { ...input, rollAction: checked.rollAction },
    { actingUserEmail: identity.email },
  );

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: CREATE_COPY.forbidden };
    case "existing_member_elsewhere":
      return { ok: false, error: CREATE_COPY.existingElsewhere };
    case "already_here":
      return { ok: false, error: CREATE_COPY.alreadyHere };
    case "invalid_household":
      return { ok: false, error: CREATE_COPY.invalidHousehold };
    case "roll_refused":
      return { ok: false, error: PARTICIPANT_COPY[result.reason] };
    case "ok":
      break;
  }

  // `rollActionId` is null for visitor/none (no roll row). A null for a
  // roll-bearing kind means createPerson() and this action disagree about
  // which kind was passed, a genuine invariant break, not an expected case.
  if (checked.rollAction.kind !== "visitor" && result.rollActionId === null) {
    throw new Error(
      "createPersonAction: createPerson() returned a null rollActionId for a roll-action-bearing call",
    );
  }

  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/admin/community/pending`);

  return {
    ok: true,
    data: {
      personId: result.personId,
      rollActionId: result.rollActionId,
      effect: result.effect,
      affectsFiledPeriod: result.affectsFiledPeriod,
    },
  };
}
