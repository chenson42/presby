import "server-only";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import type { OrgTx } from "@/lib/authz";
import { eventTypes, events } from "@/lib/db/domain/events";
import {
  MAX_SERIES_TOTAL,
  generateRecurringDates,
  parsePattern,
  seriesTotalWithinCap,
} from "@/lib/events/recurrence";
import { parseWallClock } from "@/lib/events/wall-clock";
import { deriveListed } from "@/lib/events/website-listing";
import { isUuidShaped } from "@/lib/shared/uuid";

/**
 * The in-transaction event insert, extracted from `events.ts#createEvent`
 * (worship Increment 1, Batch 0; DECISION-326, F427).
 *
 * `createEvent` gates on `events.manage` and then calls `insertEventsInTx`. A
 * worship planner who holds `worship.plan` and not `events.manage` calls the
 * same function from `worship/store.ts` after its own gate. THIS FILE CHECKS NO
 * PERMISSION: each caller gates on its own key before reaching it. Behaviour is
 * exactly what `createEvent` did after its gate: field validation, wall-clock
 * parse, type check, the series math, the insert of the parent and its
 * children, and the website-listing audit row in the same transaction.
 *
 * It also owns the types and the field validators `events.ts` shares with it
 * (`EventsResult`, `EventActor`, `CreateEventInput`, `validateFieldLengths`,
 * the length limits, `eventTypeUsable`), so `mutate.ts` can use them without
 * importing `events.ts` (docs/work-log/2026-11-04-worship-inc1.md, C1/C2).
 *
 * It reads no event row: the series is generated from the input, and the
 * parent's id comes back from the insert's own RETURNING.
 */

// ---------------------------------------------------------------------------
// Shared result / actor types
// ---------------------------------------------------------------------------

export type EventsResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string };

/** Who is acting, for the audit row (`actor_user_id`, `actor_email`). */
export interface EventActor {
  userId: string;
  email: string | null;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  location?: string;
  /** 'YYYY-MM-DDTHH:mm', wall-clock. */
  startsAt: string;
  endsAt?: string;
  /** Open to everyone (true) or members only (false). */
  isPublic: boolean;
  /**
   * REQUIRED, not optional (DECISION-133: no "undefined means unchanged"
   * FormData ambiguity). Only a wish: the stored value is
   * `deriveListed(websiteListed, isPublic)`.
   */
  websiteListed: boolean;
  allowsCheckin: boolean;
  /** Present only when creating a repeating series. */
  recurrence?: { pattern: string; count: number };
  /** Optional event type (DECISION-161); null/absent = untyped. Copied to every generated child. */
  eventTypeId?: string | null;
}

// ---------------------------------------------------------------------------
// Validators shared with events.ts and mutate.ts
// ---------------------------------------------------------------------------

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const LOCATION_MAX = 200;

/**
 * Server-side length limits, checked here regardless of what any zod shape
 * in the UI layer also enforces (Phase 1's Adversarial Pass — this exact gap
 * shipped client-only once before). Returns the `invalid_input` message, or
 * `null` when every field is within bounds.
 */
export function validateFieldLengths(input: {
  title: string;
  description?: string;
  location?: string;
}): string | null {
  if (input.title.trim().length === 0) {
    return "Title is required.";
  }
  if (input.title.length > TITLE_MAX) {
    return `Title must be ${TITLE_MAX} characters or fewer.`;
  }
  if (input.description && input.description.length > DESCRIPTION_MAX) {
    return `Description must be ${DESCRIPTION_MAX} characters or fewer.`;
  }
  if (input.location && input.location.length > LOCATION_MAX) {
    return `Location must be ${LOCATION_MAX} characters or fewer.`;
  }
  return null;
}

export const EVENT_TYPE_UNAVAILABLE = "That event type isn't available. Choose another.";

/**
 * Whether `typeId` may be written onto an event of this org. A UUID-shaped
 * string naming a type of THIS org that is active - or that the event already
 * carries (a retired type already on this event stays selectable, so editing
 * an old event does not force a re-type).
 */
export async function eventTypeUsable(
  tx: OrgTx,
  organizationId: string,
  typeId: string,
  currentTypeId: string | null,
): Promise<boolean> {
  if (!isUuidShaped(typeId)) return false; // a garbage id must not reach Postgres as a 22P02
  const [row] = await tx
    .select({ id: eventTypes.id, isActive: eventTypes.isActive })
    .from(eventTypes)
    .where(and(eq(eventTypes.id, typeId), eq(eventTypes.organizationId, organizationId)))
    .limit(1);
  return !!row && (row.isActive || row.id === currentTypeId);
}

/**
 * The two switches the listing derives from must be real booleans. A server
 * action is a public entry point: the TypeScript types do not survive the
 * wire, and `undefined`/`"false"` would otherwise pick a branch by truthiness
 * (a false audit row, or a CHECK violation). Phase 5 FAIL-2.
 */
export const SWITCH_INVALID =
  "Choose whether this event is open to everyone and whether it appears on the website.";
export function switchesAreBooleans(input: {
  isPublic: unknown;
  websiteListed: unknown;
}): boolean {
  return typeof input.isPublic === "boolean" && typeof input.websiteListed === "boolean";
}

// ---------------------------------------------------------------------------
// insertEventsInTx
// ---------------------------------------------------------------------------

/**
 * Inserts one row. When `input.recurrence` is present, inserts the first
 * occurrence, then generates `count - 1` further discrete rows via the
 * ported recurrence math, each carrying `parentEventId` = the first row's
 * own id and `organizationId` copied from the SAME just-inserted parent
 * inside the SAME transaction — the same-org property is structurally
 * guaranteed by construction, never a separate check.
 * `recurrencePattern`/`recurrenceCount` are stored ONLY on the first (parent)
 * row, never on the generated children.
 *
 * NO PERMISSION CHECK — the caller has already gated on its own key.
 */
export async function insertEventsInTx(
  tx: OrgTx,
  organizationId: string,
  actor: EventActor,
  input: CreateEventInput,
): Promise<EventsResult<{ eventId: string; occurrenceIds: string[] }>> {
  if (!switchesAreBooleans(input)) {
    return { kind: "invalid_input", message: SWITCH_INVALID };
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

  if (
    input.eventTypeId &&
    !(await eventTypeUsable(tx, organizationId, input.eventTypeId, null))
  ) {
    return { kind: "invalid_input", message: EVENT_TYPE_UNAVAILABLE };
  }

  let pattern: string | undefined;
  if (input.recurrence) {
    if (!seriesTotalWithinCap(input.recurrence.count)) {
      return {
        kind: "invalid_input",
        message: `A series can have at most ${MAX_SERIES_TOTAL} occurrences in total.`,
      };
    }
    try {
      parsePattern(input.recurrence.pattern);
    } catch {
      return {
        kind: "invalid_input",
        message: "Choose a valid repeat pattern.",
      };
    }
    pattern = input.recurrence.pattern;
  }

  const listed = deriveListed(input.websiteListed, input.isPublic);

  const [parent] = await tx
    .insert(events)
    .values({
      organizationId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      location: input.location?.trim() || null,
      startsAt,
      endsAt,
      isPublic: input.isPublic,
      websiteListed: listed,
      allowsCheckin: input.allowsCheckin,
      eventTypeId: input.eventTypeId ?? null,
      parentEventId: null,
      recurrencePattern: pattern ?? null,
      recurrenceCount: input.recurrence?.count ?? null,
      createdBy: actor.userId,
    })
    .returning({ id: events.id });

  const occurrenceIds = [parent!.id];

  if (input.recurrence && input.recurrence.count > 1) {
    const durationMs = endsAt ? endsAt.getTime() - startsAt.getTime() : null;
    const dates = generateRecurringDates(
      startsAt,
      input.recurrence.pattern,
      input.recurrence.count,
    ).slice(1);

    for (const date of dates) {
      const childEndsAt =
        durationMs !== null ? new Date(date.getTime() + durationMs) : null;
      const [child] = await tx
        .insert(events)
        .values({
          organizationId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          location: input.location?.trim() || null,
          startsAt: date,
          endsAt: childEndsAt,
          isPublic: input.isPublic,
          websiteListed: listed,
          allowsCheckin: input.allowsCheckin,
          eventTypeId: input.eventTypeId ?? null,
          parentEventId: parent!.id,
          recurrencePattern: null,
          recurrenceCount: null,
          createdBy: actor.userId,
        })
        .returning({ id: events.id });
      occurrenceIds.push(child!.id);
    }
  }

  if (listed) {
    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.EVENT_LISTED_ON_WEBSITE,
      actor,
      resourceType: "event",
      resourceId: parent!.id,
      metadata: {
        organizationId,
        via: "create",
        changed: occurrenceIds.length,
        rootEventId: parent!.id,
      },
    });
  }

  return { kind: "ok", data: { eventId: parent!.id, occurrenceIds } };
}
