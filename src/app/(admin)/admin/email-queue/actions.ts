"use server";
import "server-only";

// audit-exempt: operator retry is non-security-sensitive
// Retry-now is an operational action; the prior permanent failure is already
// captured in the EMAIL_QUEUE_PERMANENT_FAILURE audit event written by the
// worker. The check:audit tripwire requires this file-level marker AND the
// inline marker above each mutation (see scripts/check-audit-coverage.mjs).

import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import type { ActionResult } from "@/types/actions";

/**
 * Retry a failed email queue row.
 *
 * Resets status to 'queued', nextAttemptAt to NOW(), and attemptCount to 0.
 * Leaves failureReason in place so the admin can read why it failed before
 * the worker's next attempt overwrites it.
 *
 * Guard: independently re-checks ADMIN_EMAIL_QUEUE on every call — an
 * authenticated member calling this action directly is rejected here.
 * Only `failed` rows may be retried (V1 scope).
 */
export async function retryEmailAction(id: string): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_EMAIL_QUEUE)) {
    return { ok: false, error: "Forbidden." };
  }

  const row = await db.query.emailQueue.findFirst({
    where: eq(emailQueue.id, id),
    columns: { id: true, status: true },
  });

  if (!row) return { ok: false, error: "Row not found." };
  if (row.status !== "failed") {
    return { ok: false, error: "Only failed rows can be retried." };
  }

  // audit-exempt: operator retry is non-security-sensitive
  await db
    .update(emailQueue)
    .set({ status: "queued", nextAttemptAt: new Date(), attemptCount: 0 })
    .where(eq(emailQueue.id, id));

  return { ok: true };
}
