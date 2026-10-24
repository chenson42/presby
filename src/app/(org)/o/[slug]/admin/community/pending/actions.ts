"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  approveRollAction,
  approveRollActions,
  denyRollAction,
  withdrawRollAction,
} from "@/lib/roll";
import { isUuid } from "@/lib/is-uuid";
import { todayUtcYmd } from "@/lib/ymd";
import type { ActionResult } from "@/types/actions";
import {
  BULK_COPY,
  DECISION_COPY,
  DECISION_VALIDATION_COPY,
  WITHDRAW_COPY,
} from "./decision-copy";

/**
 * Server Actions for `/o/<slug>/admin/community/pending`: approve, bulk approve,
 * deny and withdraw (docs/work-log/2026-10-22-founding-admin-directory.md,
 * Increment 2). Same plumbing shape as `admin/roles/actions.ts`: `auth()` not
 * `cachedAuth()`, `resolveOrgContext()` re-run inside every action body,
 * `organizationId` and the acting person NEVER taken from the client.
 *
 * NONE of these calls `recordAudit()`, and none needs to: `src/lib/roll.ts`
 * writes the `tenant.roll_action.approved|denied|withdrawn` rows with
 * `insertAuditRow()` in the SAME transaction as the decision (R13, F180). The
 * permission check lives in the lib (pre-check) AND in the database function
 * (by the actor's `users.id`); this file only re-resolves the session, bounds
 * the client's own fields, and maps every typed refusal through one copy table
 * (`decision-copy.ts`, a type error if a code lacks copy).
 *
 * The decision itself (approve vs deny) is fixed by WHICH action is called,
 * never by a field in the payload: there is no `decision` or `status` input to
 * forge. The approver is the session's `users.id`.
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
    return { ok: false, error: DECISION_VALIDATION_COPY.signedOut };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: DECISION_VALIDATION_COPY.noAccess };
  }

  return {
    ok: true,
    userId: session.user.id,
    email: session.user.email ?? null,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
  };
}

function revalidateQueue(slug: string, personId?: string) {
  revalidatePath(`/o/${slug}/admin/community/pending`);
  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/directory`);
  if (personId) {
    revalidatePath(`/o/${slug}/admin/community/${personId}/edit`);
  }
}

export type ApproveRollActionData = {
  rollActionId: string;
  /** 'YYYY-MM-DD'. */
  effectiveDate: string;
  /** The effective date is after today (UTC): the cache projects on that day. */
  futureDated: boolean;
  /** A live filed return covers the effective year; the filed return is not
   * changed, but the approver is told. */
  affectsFiledPeriod: boolean;
  /** A later roll entry exists, so this does not change the current status. */
  shadowed: { kind: string; effectiveDate: string } | null;
  selfApproved: boolean;
};

export async function approveRollActionAction(
  slug: string,
  input: { rollActionId: string; minuteReference?: string },
): Promise<ActionResult<ApproveRollActionData>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  if (!input || !isUuid(input.rollActionId)) {
    return { ok: false, error: DECISION_COPY.not_found };
  }

  const result = await approveRollAction(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input.rollActionId,
    {
      minuteReference:
        typeof input.minuteReference === "string" ? input.minuteReference : undefined,
    },
    { actingUserEmail: identity.email },
  );

  if (result.kind === "forbidden") {
    return { ok: false, error: DECISION_COPY.forbidden };
  }
  if (result.kind === "refused") {
    return { ok: false, error: DECISION_COPY[result.reason] };
  }

  revalidateQueue(slug, result.personId);

  return {
    ok: true,
    data: {
      rollActionId: result.rollActionId,
      effectiveDate: result.effectiveDate,
      futureDated: result.effectiveDate > todayUtcYmd(),
      affectsFiledPeriod: result.affectsFiledPeriod,
      shadowed: result.shadowedBy
        ? { kind: result.shadowedBy.kind, effectiveDate: result.shadowedBy.effectiveDate }
        : null,
      selfApproved: result.selfApproved,
    },
  };
}

export type ApproveRollActionsData = {
  approved: number;
  /** One entry per row that was NOT approved, each with its own plain-language
   * reason. The action is `ok: true` even when this is non-empty: a bulk run
   * is per row, not atomic (R18). */
  failed: Array<{ rollActionId: string; error: string }>;
  /** Any approved row touched a filed year. */
  affectsFiledPeriod: boolean;
  /** How many approved rows are dated before the person's latest entry. */
  shadowedCount: number;
};

export async function approveRollActionsAction(
  slug: string,
  input: { rollActionIds: string[]; minuteReference?: string },
): Promise<ActionResult<ApproveRollActionsData>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  if (!input || !Array.isArray(input.rollActionIds)) {
    return { ok: false, error: BULK_COPY.empty };
  }

  const result = await approveRollActions(
    identity.personId,
    identity.organizationId,
    identity.userId,
    {
      rollActionIds: input.rollActionIds,
      minuteReference:
        typeof input.minuteReference === "string" ? input.minuteReference : undefined,
    },
    { actingUserEmail: identity.email },
  );

  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: DECISION_COPY.forbidden };
    case "empty":
      return { ok: false, error: BULK_COPY.empty };
    case "too_many":
      return { ok: false, error: BULK_COPY.tooMany };
    case "ok":
      break;
  }

  const failed: Array<{ rollActionId: string; error: string }> = [];
  let affectsFiledPeriod = false;
  let shadowedCount = 0;
  for (const { rollActionId, result: row } of result.results) {
    if (row.kind === "ok") {
      if (row.affectsFiledPeriod) affectsFiledPeriod = true;
      if (row.shadowedBy) shadowedCount += 1;
    } else if (row.kind === "forbidden") {
      failed.push({ rollActionId, error: DECISION_COPY.forbidden });
    } else {
      failed.push({ rollActionId, error: DECISION_COPY[row.reason] });
    }
  }

  // The people touched are not returned per row to the client; the whole
  // queue and the Community list revalidate, which is what the page reads.
  revalidateQueue(slug);
  for (const { result: row } of result.results) {
    if (row.kind === "ok") {
      revalidatePath(`/o/${slug}/admin/community/${row.personId}/edit`);
    }
  }

  return {
    ok: true,
    data: { approved: result.approved, failed, affectsFiledPeriod, shadowedCount },
  };
}

export async function denyRollActionAction(
  slug: string,
  input: { rollActionId: string; reason: string },
): Promise<ActionResult<{ rollActionId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  if (!input || !isUuid(input.rollActionId)) {
    return { ok: false, error: DECISION_COPY.not_found };
  }

  const result = await denyRollAction(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input.rollActionId,
    { reason: typeof input.reason === "string" ? input.reason : "" },
    { actingUserEmail: identity.email },
  );

  if (result.kind === "forbidden") {
    return { ok: false, error: DECISION_COPY.forbidden };
  }
  if (result.kind === "refused") {
    return { ok: false, error: DECISION_COPY[result.reason] };
  }

  revalidatePath(`/o/${slug}/admin/community/pending`);
  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/admin/community/${result.personId}/edit`);

  return { ok: true, data: { rollActionId: result.rollActionId } };
}

export async function withdrawRollActionAction(
  slug: string,
  input: { rollActionId: string; reason: string },
): Promise<ActionResult<{ rollActionId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  if (!input || !isUuid(input.rollActionId)) {
    return { ok: false, error: WITHDRAW_COPY.not_found };
  }

  const result = await withdrawRollAction(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input.rollActionId,
    { reason: typeof input.reason === "string" ? input.reason : "" },
    { actingUserEmail: identity.email },
  );

  if (result.kind === "forbidden") {
    return { ok: false, error: WITHDRAW_COPY.forbidden };
  }
  if (result.kind === "refused") {
    return { ok: false, error: WITHDRAW_COPY[result.reason] };
  }

  revalidatePath(`/o/${slug}/admin/community/pending`);
  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/admin/community/${result.personId}/edit`);

  return { ok: true, data: { rollActionId: result.rollActionId } };
}
