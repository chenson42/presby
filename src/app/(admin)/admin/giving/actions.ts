"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { listDeadLetters, requeueDeadLetter } from "@/lib/admin/giving-ingest-health";
import { FEATURES, hasFeature } from "@/lib/permissions";
import type { ActionResult } from "@/types/actions";

/**
 * Platform requeue of a dead-lettered giving event - docs/work-log/
 * 2026-10-15-online-giving.md, Batch 3b and DECISION-175 (4). Gate:
 * `FEATURES.ADMIN_ORGANIZATIONS` (the platform axis; this page grants no access
 * to any congregation's data - it moves one inbox row back to `received` so the
 * cron retries it).
 *
 * auth() -> feature -> uuid -> the event must be in the CURRENT dead-letter list
 * (that is also where the audit row gets its organization id: the browser's
 * word is never trusted for it) -> `requeueDeadLetter()` -> audit ONLY on
 * `requeued` -> revalidate. Audit metadata is ids and an event type: no body, no
 * amount, no donor. A refusal mutates nothing.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requeueDeadLetterAction(eventId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }
  if (typeof eventId !== "string" || !UUID_RE.test(eventId)) {
    return { ok: false, error: "That isn't a valid event." };
  }

  let row;
  try {
    row = (await listDeadLetters()).find((r) => r.eventId === eventId);
  } catch {
    return { ok: false, error: "We couldn't read the dead-letter list. Nothing was changed." };
  }
  if (!row) {
    return { ok: false, error: "That event is no longer a dead letter. Reload the page to see the current list." };
  }

  let outcome;
  try {
    outcome = await requeueDeadLetter(eventId);
  } catch {
    return { ok: false, error: "We couldn't requeue that event. Nothing was changed." };
  }
  if (outcome !== "requeued") {
    revalidatePath("/admin/giving");
    return { ok: false, error: "That event is no longer a dead letter. Reload the page to see the current list." };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ORG_GIVING_EVENT_REQUEUED,
    resourceType: "organization",
    resourceId: row.organizationId,
    metadata: {
      organizationId: row.organizationId,
      connectionId: row.connectionId,
      eventId: row.eventId,
      eventType: row.eventType,
      attempts: row.attempts,
    },
  });
  revalidatePath("/admin/giving");
  return { ok: true };
}
