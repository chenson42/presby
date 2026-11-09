import "server-only";
import { and, eq } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { events } from "@/lib/db/domain/events";
import {
  runEventCancelledHooks,
  runEventUpdatedHooks,
} from "@/lib/events/hooks";
import {
  validateFieldLengths,
  type EventActor,
  type EventsResult,
} from "@/lib/events/insert";
import { parseWallClock } from "@/lib/events/wall-clock";
import { isUuidShaped } from "@/lib/shared/uuid";

/**
 * The two in-transaction event writes a worship planner needs and does not
 * hold `events.manage` for: edit a service's title, time and place, and cancel
 * it (DECISION-326, F427; architect addendum C1 to C5).
 *
 * NO PERMISSION CHECK. Each caller gates on its own key before reaching here
 * (`events.ts` on `events.manage`; `worship/store.ts` on `worship.plan` plus the
 * join that proves the event carries a `worship_services` row, C2). That is why
 * this file's importers are pinned to exactly those two by
 * `events/boundaries.source.test.ts`: a third caller would be an event writer
 * with no gate of its own.
 *
 * ONE LOCK, TAKEN FIRST (C3). Both writers' first read is the event row
 * `FOR NO KEY UPDATE`, so a service edit, a cancel (from Manage events or from
 * the worship board), a Send and a sign-up all serialize on the same row, and
 * the `cancelled_at` check below reads AFTER the lock: an edit that loses the
 * race to a cancel returns `invalid_target`, never a stale write.
 *
 * `updateEventFieldsInTx` writes `title`, `description`, `location`,
 * `starts_at` and `ends_at` and NOTHING ELSE: never `is_public`,
 * `website_listed`, `allows_checkin`, `event_type_id`, `recurrence_*` or
 * `parent_event_id`. Because it never changes `website_listed`, it writes no
 * website-listing audit row (DECISION-240). Both writers fan out through
 * `events/hooks.ts` in the caller's transaction and return the queue ids.
 */

export async function updateEventFieldsInTx(
  tx: OrgTx,
  organizationId: string,
  input: {
    eventId: string;
    title: string;
    /** `undefined` leaves the description column out of the SET (unchanged). */
    description?: string;
    location?: string;
    /** 'YYYY-MM-DDTHH:mm', wall-clock. */
    startsAt: string;
    endsAt?: string;
  },
): Promise<EventsResult<{ eventId: string; queueIds: string[] }>> {
  if (!isUuidShaped(input.eventId)) return { kind: "invalid_target" };

  // The lock is the FIRST read (C3): the cancelled check below must see a
  // committed cancel, not the snapshot from before it.
  const [existing] = await tx
    .select({
      id: events.id,
      cancelledAt: events.cancelledAt,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      location: events.location,
    })
    .from(events)
    .where(and(eq(events.id, input.eventId), eq(events.organizationId, organizationId)))
    .limit(1)
    .for("no key update");
  if (!existing || existing.cancelledAt !== null) {
    return { kind: "invalid_target" };
  }

  const lengthError = validateFieldLengths(input);
  if (lengthError) {
    return { kind: "invalid_input", message: lengthError };
  }

  const startsAt = parseWallClock(input.startsAt);
  const endsAt = input.endsAt ? parseWallClock(input.endsAt) : null;
  if (endsAt && endsAt < startsAt) {
    return {
      kind: "invalid_input",
      message: "The end time can't be before the start time.",
    };
  }

  const location = input.location?.trim() || null;

  await tx
    .update(events)
    .set({
      title: input.title.trim(),
      ...(input.description !== undefined
        ? { description: input.description.trim() || null }
        : {}),
      location,
      startsAt,
      endsAt,
    })
    .where(and(eq(events.id, input.eventId), eq(events.organizationId, organizationId)));

  const { queueIds } = await runEventUpdatedHooks(tx, {
    organizationId,
    eventId: input.eventId,
    before: {
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      location: existing.location,
    },
    after: { startsAt, endsAt, location },
  });

  return { kind: "ok", data: { eventId: input.eventId, queueIds } };
}

/**
 * Sets `cancelled_at = now()` on ONE occurrence. Never a delete, never
 * cascades to siblings. `invalid_target` if the event does not exist at this
 * org. An already-cancelled event is an idempotent `ok` with `changed: false`
 * and NO hook runs (the fan-out happens on the transition only).
 */
export async function cancelEventInTx(
  tx: OrgTx,
  organizationId: string,
  eventId: string,
  actor: EventActor | null,
): Promise<
  EventsResult<{ eventId: string; changed: boolean; queueIds: string[] }>
> {
  if (!isUuidShaped(eventId)) return { kind: "invalid_target" };

  // Lock first (C3), then read the state the decision depends on.
  const [existing] = await tx
    .select({ id: events.id, cancelledAt: events.cancelledAt })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1)
    .for("no key update");
  if (!existing) {
    return { kind: "invalid_target" };
  }
  if (existing.cancelledAt !== null) {
    return { kind: "ok", data: { eventId, changed: false, queueIds: [] } };
  }

  await tx
    .update(events)
    .set({ cancelledAt: new Date() })
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)));

  const { queueIds } = await runEventCancelledHooks(tx, {
    organizationId,
    eventId,
    actor,
  });

  return { kind: "ok", data: { eventId, changed: true, queueIds } };
}
