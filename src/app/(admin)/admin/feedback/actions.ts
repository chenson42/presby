"use server";
import "server-only";

import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import type { ActionResult } from "@/types/actions";

// ---------------------------------------------------------------------------
// Status state machine
// ---------------------------------------------------------------------------

/**
 * Legal status transitions for feedback rows.
 * Status lifecycle:
 *   new → triaged (admin is working it)
 *   new → declined (won't do — explicit rejection)
 *   triaged → done (delivered)
 *   triaged → declined (decided against after initial review)
 *   done → (terminal — no further transitions)
 *   declined → (terminal — no further transitions)
 *
 * Terminal states have empty arrays; the action returns a typed error for
 * any attempted transition from a terminal state or an invalid forward step.
 */
const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  new: ["triaged", "declined"],
  triaged: ["done", "declined"],
  done: [], // terminal
  declined: [], // terminal
};

const KNOWN_STATUSES = new Set(Object.keys(VALID_TRANSITIONS));

// ---------------------------------------------------------------------------
// updateFeedbackStatus
// ---------------------------------------------------------------------------

/**
 * Update a feedback row's status.
 * Gate: independently checks admin.feedback feature on EVERY call.
 * An authenticated member cannot be prevented from calling server actions
 * directly — the feature check here is the authoritative guard.
 *
 * Returns { ok: false, error } for:
 *   - Unauthenticated calls
 *   - Missing admin.feedback feature
 *   - Unknown target status
 *   - Row not found
 *   - Illegal state-machine transition (including regressions from terminal states)
 */
export async function updateFeedbackStatus(
  feedbackId: string,
  newStatus: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Not signed in." };
  }
  if (!hasFeature(session.user.features, FEATURES.ADMIN_FEEDBACK)) {
    return { ok: false, error: "Forbidden." };
  }

  // Validate newStatus is a recognized state before touching the DB.
  if (!KNOWN_STATUSES.has(newStatus)) {
    return { ok: false, error: `Invalid status '${newStatus}'.` };
  }

  // Fetch current status to validate the transition.
  const row = await db.query.feedback.findFirst({
    where: eq(schema.feedback.id, feedbackId),
    columns: { status: true },
  });
  if (!row) {
    return { ok: false, error: "Feedback not found." };
  }

  // State-machine check: reject illegal transitions and regressions.
  const allowed = VALID_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return {
      ok: false,
      error: `Cannot change status from '${row.status}' to '${newStatus}'.`,
    };
  }

  // audit-exempt: operator triage mutation; not a user-access or security-sensitive change
  await db
    .update(schema.feedback)
    .set({ status: newStatus })
    .where(eq(schema.feedback.id, feedbackId));

  return { ok: true };
}
