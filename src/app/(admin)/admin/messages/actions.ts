"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { HELP_CONTACT_STATUSES, type HelpContactStatus } from "@/lib/db/domain/help-contact";
import { HELP_CONTACT_INBOX_COPY as COPY } from "@/lib/help-contact/copy";
import { clearMessageDetails, isMessageId, setMessageStatus } from "@/lib/help-contact/inbox";
import { FEATURES, hasFeature } from "@/lib/permissions";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/admin/messages` (the contact-form inbox). Each one:
 * authenticate, authorize with `FEATURES.ADMIN_TICKETS` on EVERY call (the
 * page's own check does not protect a directly-invoked action), validate the
 * id, then call `inbox.ts`, which holds the platform connection and writes the
 * audit row in the same transaction as the change (CA10). This file has no
 * `db.` call, so `check:audit` is silent on it by construction; the guard is
 * `src/lib/help-contact/inbox.db.test.ts` (AF-7).
 *
 * Phase 3 ruled that the audit keys are imported where the audit row is
 * written (inbox.ts), not here.
 */

async function requireInboxSession(): Promise<
  { ok: true; actor: { userId: string; email: string | null } } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: COPY.refusals.notSignedIn };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_TICKETS)) {
    return { ok: false, error: COPY.refusals.forbidden };
  }
  return { ok: true, actor: { userId: session.user.id, email: session.user.email ?? null } };
}

/** Logged by class only: a driver message can carry a value from a stranger's message. */
function logFailure(what: string, err: unknown): void {
  console.error(`[admin-messages] ${what} failed: ${err instanceof Error ? err.name : typeof err}`);
}

function refresh(id: string): void {
  revalidatePath("/admin/messages");
  revalidatePath(`/admin/messages/${id}`);
}

export async function setContactMessageStatus(
  id: string,
  to: HelpContactStatus,
): Promise<ActionResult> {
  const gate = await requireInboxSession();
  if (!gate.ok) return gate;
  if (!isMessageId(id)) return { ok: false, error: COPY.refusals.notFound };
  if (!(HELP_CONTACT_STATUSES as readonly string[]).includes(to)) {
    return { ok: false, error: COPY.statusFailure };
  }

  let result;
  try {
    result = await setMessageStatus(gate.actor, id, to);
  } catch (err) {
    logFailure("status change", err);
    return { ok: false, error: COPY.statusFailure };
  }
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "not_found"
          ? COPY.refusals.notFound
          : COPY.refusals.clearedCannotBeNew,
    };
  }
  refresh(id);
  return { ok: true };
}

export async function clearContactMessageDetails(id: string): Promise<ActionResult> {
  const gate = await requireInboxSession();
  if (!gate.ok) return gate;
  if (!isMessageId(id)) return { ok: false, error: COPY.refusals.notFound };

  let result;
  try {
    result = await clearMessageDetails(gate.actor, id);
  } catch (err) {
    logFailure("clear details", err);
    return { ok: false, error: COPY.clearFailure };
  }
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "not_found"
          ? COPY.refusals.notFound
          : result.reason === "already_cleared"
            ? COPY.refusals.alreadyCleared
            : COPY.refusals.needsTriage,
    };
  }
  refresh(id);
  return { ok: true };
}
