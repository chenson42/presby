import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import type { OrgTx } from "@/lib/authz";
import { worshipAssignments } from "@/lib/db/domain/worship";
import type {
  EventCancelledHookInput,
  EventHookResult,
  EventUpdatedHookInput,
} from "@/lib/events/hooks";
import { queueCancelledNotices } from "./notify";
import { rowsOf } from "./sql-util";

/**
 * Worship's reactions to an event changing under it - docs/work-log/
 * 2026-11-04-worship-inc1.md, Phase 3 "The cancel hook"; DECISION-326; architect
 * addendum C1 and C4. Called ONLY by `src/lib/events/hooks.ts`, in the
 * caller's own transaction (a cancel from Manage events and a cancel from the
 * worship board are the same code path).
 *
 * THE IMPORT RULE (C1). This file, and every file it imports, may not import
 * `@/lib/events` (the file), `events/{mutate,hooks,insert}.ts` or
 * `worship/store.ts` at runtime; `import type` is erased and allowed (the two
 * input types above come from `events/hooks.ts` that way). `hooks.ts` imports
 * this file; a cycle would make the cancel path unbuildable.
 * `worship/boundaries.test.ts` and `events/boundaries.source.test.ts` walk the
 * static imports and fail on any such path.
 *
 * WRITER ALLOW-LIST. With `store.ts`, this is one of the TWO files that write a
 * `worship_*` table (`boundaries.test.ts`). It writes `worship_assignments`
 * only, through the same trigger-guarded shape as the store: the move to
 * `withdrawn` with reason `service_cancelled` and no actor, which the update
 * guard accepts only when the event is already cancelled.
 *
 * CANCEL. Runs after `cancelled_at` is set, only on the transition (an
 * already-cancelled event runs no hook). If the event has no `worship_services`
 * row it returns at once. Otherwise it locks every assignment of the event
 * (`FOR UPDATE`, ordered by id), withdraws drafts and open requests, RETAINS
 * confirmed and declined rows ("the schedule is retained"), and - when the
 * toggle is on - queues one cancel notice per person who was `requested` or
 * `confirmed` (never a draft, a decliner or a guest; never a presumed minor;
 * nobody with no deliverable address). A hook that cannot write its queue rows
 * throws and the cancel rolls back. There is no inline send on this path: the
 * five-minute email-queue cron sends. The queue ids are returned (S1) and
 * worship's callers ignore them.
 *
 * UPDATE. A no-op in Increment 1: the registered place a later increment
 * reacts to a service move (F430: moving a service sends no message).
 *
 * READS `events` only for an event that carries a `worship_services` row, and
 * only its start (DECISION-316; `calendar-visibility.source.test.ts`).
 */

export async function onServiceCancelledInTx(
  tx: OrgTx,
  input: EventCancelledHookInput,
): Promise<EventHookResult> {
  const { organizationId, eventId } = input;

  const isService = rowsOf(
    await tx.execute(sql`
      select 1 from worship_services
       where event_id = ${eventId}::uuid and organization_id = ${organizationId}::uuid
    `),
  );
  if (isService.length === 0) return { queueIds: [] };

  const rows = rowsOf(
    await tx.execute(sql`
      select a.id::text as id, a.person_id::text as person_id, a.status
        from worship_assignments a
       where a.event_id = ${eventId}::uuid and a.organization_id = ${organizationId}::uuid
       order by a.id
         for update
    `),
  );

  // Drafts and open requests are withdrawn by the cancel; confirmed and declined are retained.
  const toWithdraw = rows.filter((r) => r.status === "draft" || r.status === "requested");
  for (const row of toWithdraw) {
    await tx
      .update(worshipAssignments)
      .set({ status: "withdrawn", withdrawnReason: "service_cancelled" })
      .where(and(eq(worshipAssignments.id, String(row.id)), eq(worshipAssignments.organizationId, organizationId)));
  }

  // Who is told: people who were requested or confirmed, once each, and only while the toggle is on.
  const told = [...new Set(rows.filter((r) => (r.status === "requested" || r.status === "confirmed") && r.person_id !== null).map((r) => String(r.person_id)))];
  let queueIds: string[] = [];
  if (told.length > 0) {
    const enabled = rowsOf(
      await tx.execute(sql`select presby_worship_enabled(${organizationId}::uuid) as enabled`),
    )[0];
    if (enabled?.enabled === true) {
      const start = rowsOf(
        await tx.execute(sql`
          select to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at
            from events e
           where e.id = ${eventId}::uuid and e.organization_id = ${organizationId}::uuid
        `),
      )[0];
      if (start) {
        queueIds = await queueCancelledNotices(tx, {
          organizationId,
          startsAt: String(start.starts_at),
          personIds: told,
        });
      }
    }
  }

  if (toWithdraw.length > 0 || queueIds.length > 0) {
    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.WORSHIP_SERVICE_CANCELLED,
      actor: input.actor ? { userId: input.actor.userId, email: input.actor.email } : null,
      resourceType: "worship_service",
      resourceId: eventId,
      metadata: { eventId, withdrawn: toWithdraw.length, notified: queueIds.length },
    });
  }
  return { queueIds };
}

/** The registered slot for a service moving (F430: no message in Increment 1). A no-op. */
export async function onServiceUpdatedInTx(
  _tx: OrgTx,
  _input: EventUpdatedHookInput,
): Promise<EventHookResult> {
  return { queueIds: [] };
}
