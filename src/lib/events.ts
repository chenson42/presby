import "server-only";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import { withOrgContext } from "@/lib/authz";
import { type db } from "@/lib/db";
import { eventTypes, events } from "@/lib/db/domain/events";
import {
  MAX_SERIES_TOTAL,
  generateRecurringDates,
  isChildEvent,
  isParentEvent,
  parsePattern,
  seriesTotalWithinCap,
} from "@/lib/events/recurrence";
import { formatWallClock, parseWallClock } from "@/lib/events/wall-clock";
import {
  deriveListed,
  inheritedListing,
  planSeriesListing,
  type SeriesRow,
} from "@/lib/events/website-listing";
import {
  DEFAULT_EVENT_TYPE_ICON,
  isEventTypeColor,
  isEventTypeIcon,
  type EventTypeColor,
  type EventTypeIcon,
} from "@/lib/events/type-palette";
import { isUuidShaped } from "@/lib/shared/uuid";

/**
 * Calendar events — docs/work-log/2026-08-26-events-model.md, Phase 3 design,
 * Phase 4 commit 2 (full-stack-developer). DECISION-113/115.
 *
 * SAME SHAPE AS `src/lib/groups.ts`/`src/lib/officers.ts` (Phase 3's own
 * instruction): one `withOrgContext()` transaction per exported function, the
 * `events.manage` gate checked FIRST inside every one of them via the private
 * `hasEventsManage` helper, typed `EventsResult` variants instead of thrown
 * exceptions for every expected/denied outcome.
 *
 * WALL-CLOCK TIMESTAMPS, TYPED DIGITS IN THE UTC FIELDS (DECISION-113 ruling
 * 3, corrected by F134). `startsAt`/`endsAt` are `timestamp` columns with NO
 * time zone. Drizzle WRITES such a column with `value.toISOString()` and READS
 * it by appending "+0000", so a `Date` carries wall-clock digits faithfully
 * only through its UTC fields: `parseWallClock`/`formatWallClock`
 * (`src/lib/events/wall-clock.ts`) and `recurrence.ts` use `Date.UTC` and
 * `getUTC*`/`setUTC*` throughout, and nothing here depends on the server's
 * time zone. (The earlier wording of this paragraph said LOCAL getters were
 * the discipline; that stored the typed digits only when the process ran in
 * UTC.) A value that came out of these functions is not an instant — never
 * hand it to anything that treats it as one. `cancelledAt` is the one
 * legitimate `timestamptz` column here (DECISION-113's own carve-out) and DOES
 * use `.toISOString()`, correctly, as a real instant. `eslint.config.mjs`
 * bans local Date getters/setters in this module and its siblings.
 *
 * SAME-ORG PARENT GUARD (`parent_event_id` carries no database FK on the
 * organization axis — architect's Phase 2 ruling, DECISION-115 ruling 3):
 * `createEvent` never accepts a caller-supplied `parentEventId` at all — its
 * generated children copy `organizationId` from the just-inserted parent
 * inside the SAME transaction, guaranteed by construction, not a separate
 * check. `extendSeriesPattern` is the one export that accepts a caller-
 * supplied id (`parentEventId`); it re-loads that row scoped to
 * `(id, organizationId, recurrencePattern is not null, parentEventId is
 * null)` before generating anything — `invalid_target` otherwise.
 *
 * TWO DISJOINT WRITE PATHS FOR "EDIT," NEVER ONE FUNCTION BRANCHING ON SHAPE
 * (Phase 3's Edge Cases, the load-bearing distinction Phase 1 flagged as
 * Gap 1): `updateEvent` edits ONE occurrence's own fields and NEVER touches
 * `recurrencePattern`/`recurrenceCount`; `extendSeriesPattern` generates
 * FUTURE rows and updates the parent's own pattern/count, and NEVER touches
 * any existing row's own fields. A materialized occurrence a check-in might
 * already reference can never move under either path.
 *
 * EVENT TYPES (DECISION-161). `eventTypeId` on create/update is optional; a
 * non-null id is pre-checked INSIDE the transaction (a UUID-shaped string that
 * names an ACTIVE type of THIS org, or the type this very event already
 * carries) and refused with `invalid_input` otherwise, so a garbage string
 * never reaches Postgres as a 22P02 and a foreign or retired type is a message,
 * not a 500. The composite FK `events_event_type_fk` is the backstop for a race.
 * `createEvent` writes the type on the parent AND on every generated child, and
 * `extendSeriesPattern` copies the parent's type onto its children - those two
 * hand-written field copies are exactly where a type would silently be lost.
 * `updateEvent` edits ONE occurrence, so changing one occurrence's type leaves a
 * mixed series (acceptable for v1, said so in the edit form).
 *
 * AUDIT, NARROWLY (DECISION-240, amending DECISION-113 ruling 5). Event
 * create, edit, extend and cancel are content configuration and stay
 * unaudited - EXCEPT when `website_listed` changes, because putting an event on
 * the public website is a disclosure change. Every path that can change that
 * column (`createEvent`, `updateEvent`, `extendSeriesPattern`,
 * `setSeriesWebsiteListing`) writes exactly one row with `insertAuditRow(tx,
 * ...)` in the SAME transaction as the change, so the two commit or roll back
 * together; a call that changes nothing, a cancel, and a refused call write
 * none. A fifth writer of `website_listed` must audit too.
 *
 * WEBSITE LISTING IS DERIVED, NEVER TRUSTED (DECISION-238, F251/F252). The
 * stored value is `deriveListed(input.websiteListed, input.isPublic)`: a
 * members-only event is never listed whatever was posted, and the UPDATE that
 * makes a listed event members-only clears the listing in the same statement so
 * the `events_website_requires_public` CHECK is never tripped by a routine
 * edit. New occurrences added to a series inherit from the LATEST non-cancelled
 * occurrence (`inheritedListing`), never from the parent row alone.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const EVENTS_MANAGE = "events.manage";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const LOCATION_MAX = 200;

/**
 * The single-permission gate every exported function in this module checks
 * FIRST — not exported, same discipline `hasGroupsManage`/`hasOfficersManage`
 * document.
 */
async function hasEventsManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${EVENTS_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

// ---------------------------------------------------------------------------
// Shared result / entry types
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

export interface EventListEntry {
  eventId: string;
  title: string;
  startsAt: string; // ISO, wall-clock (no tz)
  endsAt: string | null;
  /** True = open to everyone; false = members only. NOT website publication. */
  isPublic: boolean;
  /** Marked to appear on the public website calendar (when that is turned on). */
  websiteListed: boolean;
  allowsCheckin: boolean;
  cancelledAt: string | null;
  isRecurringSeries: boolean; // recurrencePattern is non-null on this row
  isSeriesOccurrence: boolean; // parentEventId is non-null
}

/**
 * What a series' "Website listing" section needs: the counts for the two
 * confirmations, computed by the SAME `planSeriesListing` the write uses, so the
 * number shown is the number of rows changed.
 */
export interface SeriesWebsiteSummary {
  /** The anchor event's start ('YYYY-MM-DDTHH:mm'), for the dialog copy. */
  fromStartsAt: string;
  /** "This and later" -> listed. */
  put: { changes: number; skippedCancelled: number; skippedMembersOnly: number };
  /** "This and later" -> unlisted. */
  take: { changes: number };
  /** What `extendSeriesPattern` would give new occurrences (the series parent's page). */
  inheritsOnExtend: boolean;
}

export interface SeriesListingOutcome {
  changed: number;
  unchanged: number;
  skippedCancelled: number;
  skippedMembersOnly: number;
}

export interface EventDetail extends EventListEntry {
  description: string | null;
  location: string | null;
  parentEventId: string | null;
  recurrencePattern: string | null; // only ever set on the series' first row
  recurrenceCount: number | null;
  /** The event's own type (null = untyped, rendered as the org's fallback). */
  eventType: { id: string; name: string } | null;
  /** Other rows sharing this event's own id-or-parent series, if any. */
  seriesOccurrences: Array<{
    eventId: string;
    startsAt: string;
    cancelledAt: string | null;
  }>;
  /** null for a standalone event (a series of fewer than two rows). */
  seriesWebsite: SeriesWebsiteSummary | null;
}

interface EventRow {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  isPublic: boolean;
  websiteListed: boolean;
  allowsCheckin: boolean;
  cancelledAt: Date | null;
  parentEventId: string | null;
  recurrencePattern: string | null;
  recurrenceCount: number | null;
  eventTypeId: string | null;
}

function toSeriesRow(row: EventRow): SeriesRow {
  return {
    id: row.id,
    startsAt: row.startsAt,
    isPublic: row.isPublic,
    websiteListed: row.websiteListed,
    cancelled: row.cancelledAt !== null,
  };
}

function toListEntry(row: EventRow): EventListEntry {
  return {
    eventId: row.id,
    title: row.title,
    startsAt: formatWallClock(row.startsAt),
    endsAt: row.endsAt ? formatWallClock(row.endsAt) : null,
    isPublic: row.isPublic,
    websiteListed: row.websiteListed,
    allowsCheckin: row.allowsCheckin,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    isRecurringSeries: isParentEvent(row),
    isSeriesOccurrence: isChildEvent(row),
  };
}

const EVENT_COLUMNS = {
  id: events.id,
  organizationId: events.organizationId,
  title: events.title,
  description: events.description,
  location: events.location,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  isPublic: events.isPublic,
  websiteListed: events.websiteListed,
  allowsCheckin: events.allowsCheckin,
  cancelledAt: events.cancelledAt,
  parentEventId: events.parentEventId,
  recurrencePattern: events.recurrencePattern,
  recurrenceCount: events.recurrenceCount,
  eventTypeId: events.eventTypeId,
} as const;

/**
 * Server-side length limits, checked here regardless of what any zod shape
 * in the UI layer also enforces (Phase 1's Adversarial Pass — this exact gap
 * shipped client-only once before). Returns the `invalid_input` message, or
 * `null` when every field is within bounds.
 */
function validateFieldLengths(input: {
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
async function eventTypeUsable(
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

// ---------------------------------------------------------------------------
// listEvents
// ---------------------------------------------------------------------------

/**
 * All occurrences at this org, ordered by `startsAt` ascending. Cancelled
 * rows are INCLUDED and visually marked, never filtered out — this is the
 * admin surface, not a future public one (DECISION-113's public-visibility
 * ruling governs Increment 4's separate query, not this one).
 */
export async function listEvents(
  viewerPersonId: string,
  organizationId: string,
): Promise<EventsResult<EventListEntry[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const rows = await tx
      .select(EVENT_COLUMNS)
      .from(events)
      .where(eq(events.organizationId, organizationId))
      .orderBy(events.startsAt);

    return { kind: "ok", data: rows.map(toListEntry) };
  });
}

// ---------------------------------------------------------------------------
// getEvent
// ---------------------------------------------------------------------------

/**
 * One occurrence's full detail, plus its series siblings (if it is a parent
 * or a child) for the "part of a series" UI affordance. `invalid_target` for
 * a nonexistent id or one from another org, indistinguishably — same
 * enumeration posture `getGroup`/`getOfficerHistory` already take.
 */
export async function getEvent(
  viewerPersonId: string,
  organizationId: string,
  eventId: string,
): Promise<EventsResult<EventDetail>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .select(EVENT_COLUMNS)
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
      .limit(1);
    if (!row) {
      return { kind: "invalid_target" };
    }

    let seriesRows: EventRow[] = [];
    if (isParentEvent(row)) {
      seriesRows = await tx
        .select(EVENT_COLUMNS)
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            eq(events.parentEventId, row.id),
          ),
        )
        .orderBy(events.startsAt);
    } else if (isChildEvent(row) && row.parentEventId) {
      seriesRows = await tx
        .select(EVENT_COLUMNS)
        .from(events)
        .where(
          and(
            eq(events.organizationId, organizationId),
            or(eq(events.id, row.parentEventId), eq(events.parentEventId, row.parentEventId)),
            ne(events.id, row.id),
          ),
        )
        .orderBy(events.startsAt);
    }

    let eventType: { id: string; name: string } | null = null;
    if (row.eventTypeId) {
      const [typeRow] = await tx
        .select({ id: eventTypes.id, name: eventTypes.name })
        .from(eventTypes)
        .where(
          and(
            eq(eventTypes.id, row.eventTypeId),
            eq(eventTypes.organizationId, organizationId),
          ),
        )
        .limit(1);
      eventType = typeRow ?? null;
    }

    // The "Website listing" section's counts, from the rows this function
    // already loaded and the SAME planner the write uses. A series of fewer than
    // two rows (a standalone event) has none: one event is changed in its form.
    let seriesWebsite: SeriesWebsiteSummary | null = null;
    const seriesAll: EventRow[] = seriesRows.length > 0 ? [row, ...seriesRows] : [];
    if (seriesAll.length >= 2) {
      const planRows = seriesAll.map(toSeriesRow);
      const seriesParent = isParentEvent(row)
        ? row
        : seriesAll.find((r) => r.id === row.parentEventId);
      const putPlan = planSeriesListing(planRows, row.id, true);
      const takePlan = planSeriesListing(planRows, row.id, false);
      seriesWebsite = {
        fromStartsAt: formatWallClock(row.startsAt),
        put: {
          changes: putPlan.ids.length,
          skippedCancelled: putPlan.skippedCancelled,
          skippedMembersOnly: putPlan.skippedMembersOnly,
        },
        take: { changes: takePlan.ids.length },
        inheritsOnExtend: !!seriesParent && inheritedListing(planRows) && seriesParent.isPublic,
      };
    }

    return {
      kind: "ok",
      data: {
        ...toListEntry(row),
        description: row.description,
        location: row.location,
        parentEventId: row.parentEventId,
        recurrencePattern: row.recurrencePattern,
        recurrenceCount: row.recurrenceCount,
        eventType,
        seriesOccurrences: seriesRows.map((r) => ({
          eventId: r.id,
          startsAt: formatWallClock(r.startsAt),
          cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
        })),
        seriesWebsite,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// createEvent
// ---------------------------------------------------------------------------

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

/**
 * Inserts one row. When `input.recurrence` is present, inserts the first
 * occurrence, then generates `count - 1` further discrete rows via the
 * ported recurrence math, each carrying `parentEventId` = the first row's
 * own id and `organizationId` copied from the SAME just-inserted parent
 * inside the SAME transaction — the same-org property is structurally
 * guaranteed by construction, never a separate check.
 * `recurrencePattern`/`recurrenceCount` are stored ONLY on the first (parent)
 * row, never on the generated children.
 */
export async function createEvent(
  viewerPersonId: string,
  organizationId: string,
  actor: EventActor,
  input: CreateEventInput,
): Promise<EventsResult<{ eventId: string; occurrenceIds: string[] }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
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
  });
}

// ---------------------------------------------------------------------------
// updateEvent
// ---------------------------------------------------------------------------

export interface UpdateEventInput {
  eventId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt?: string;
  /** Open to everyone (true) or members only (false). */
  isPublic: boolean;
  /** REQUIRED (see `CreateEventInput`); the stored value is derived from it and `isPublic`. */
  websiteListed: boolean;
  allowsCheckin: boolean;
  /** `undefined` leaves the type unchanged; `null` clears it; an id sets it. */
  eventTypeId?: string | null;
}

/**
 * Edits ONE occurrence's own fields (whether standalone, a parent, or a
 * child row). NEVER touches `recurrencePattern`/`recurrenceCount` and NEVER
 * affects sibling rows — that is `extendSeriesPattern`'s job.
 * `invalid_target` if the event doesn't exist at this org, OR is already
 * cancelled (a cancelled occurrence is not editable — Edge Cases).
 */
export async function updateEvent(
  viewerPersonId: string,
  organizationId: string,
  actor: EventActor,
  input: UpdateEventInput,
): Promise<EventsResult<{ eventId: string }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [existing] = await tx
      .select({
        id: events.id,
        cancelledAt: events.cancelledAt,
        eventTypeId: events.eventTypeId,
        websiteListed: events.websiteListed,
      })
      .from(events)
      .where(and(eq(events.id, input.eventId), eq(events.organizationId, organizationId)))
      .limit(1);
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

    if (
      input.eventTypeId &&
      !(await eventTypeUsable(
        tx,
        organizationId,
        input.eventTypeId,
        existing.eventTypeId,
      ))
    ) {
      return { kind: "invalid_input", message: EVENT_TYPE_UNAVAILABLE };
    }

    // Derived, never the posted value alone (F251): `is_public` and
    // `website_listed` are written in the SAME statement, so making a listed
    // event members-only clears the listing and the CHECK is never tripped.
    const listed = deriveListed(input.websiteListed, input.isPublic);

    await tx
      .update(events)
      .set({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        location: input.location?.trim() || null,
        startsAt,
        endsAt,
        isPublic: input.isPublic,
        websiteListed: listed,
        allowsCheckin: input.allowsCheckin,
        // undefined = leave the column out of the SET entirely (unchanged).
        ...(input.eventTypeId !== undefined
          ? { eventTypeId: input.eventTypeId }
          : {}),
      })
      .where(and(eq(events.id, input.eventId), eq(events.organizationId, organizationId)));

    if (listed !== existing.websiteListed) {
      await insertAuditRow(tx, {
        action: listed
          ? AUDIT_ACTIONS.EVENT_LISTED_ON_WEBSITE
          : AUDIT_ACTIONS.EVENT_UNLISTED_FROM_WEBSITE,
        actor,
        resourceType: "event",
        resourceId: input.eventId,
        metadata: {
          organizationId,
          via: "update",
          changed: 1,
          // The listing was cleared because the event became members-only.
          ...(!listed && !input.isPublic ? { clearedBecauseMembersOnly: true } : {}),
        },
      });
    }

    return { kind: "ok", data: { eventId: input.eventId } };
  });
}

// ---------------------------------------------------------------------------
// extendSeriesPattern
// ---------------------------------------------------------------------------

export interface ExtendSeriesInput {
  /** Must be the SERIES PARENT's own id (recurrencePattern non-null,
   *  parentEventId null) — invalid_target otherwise. */
  parentEventId: string;
  /** Replaces the parent's stored pattern going forward; already-
   *  materialized rows are never re-read against it. */
  pattern: string;
  /** How many ADDITIONAL occurrences to generate beyond the series' current
   *  last occurrence — never a replacement count. */
  additionalCount: number;
}

/**
 * DECISION-113's "pattern edits extend/regenerate the horizon only" made
 * concrete: loads the parent row scoped to `(id, organizationId,
 * recurrencePattern is not null, parentEventId is null)` — `invalid_target`
 * otherwise (the explicit same-org/same-series guard the architect flagged
 * as needing an app-level check). Finds the series' current LATEST
 * occurrence, then generates `additionalCount` further discrete rows forward
 * from that date using `pattern` (bounds-checked against the same
 * 52-occurrence cap, counted against the SERIES TOTAL, not just this call).
 * Updates the parent's own `recurrencePattern`/`recurrenceCount`. Every
 * existing row — parent or child — is left completely untouched.
 */
export async function extendSeriesPattern(
  viewerPersonId: string,
  organizationId: string,
  actor: EventActor,
  input: ExtendSeriesInput,
): Promise<EventsResult<{ occurrenceIds: string[] }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [parent] = await tx
      .select(EVENT_COLUMNS)
      .from(events)
      .where(
        and(
          eq(events.id, input.parentEventId),
          eq(events.organizationId, organizationId),
          isNotNull(events.recurrencePattern),
          isNull(events.parentEventId),
        ),
      )
      .limit(1);
    if (!parent) {
      return { kind: "invalid_target" };
    }

    if (!Number.isInteger(input.additionalCount) || input.additionalCount < 1) {
      return {
        kind: "invalid_input",
        message: "Enter at least 1 additional occurrence.",
      };
    }

    const existingCount = parent.recurrenceCount ?? 1;
    const totalCount = existingCount + input.additionalCount;
    if (!seriesTotalWithinCap(totalCount)) {
      return {
        kind: "invalid_input",
        message: `A series can have at most ${MAX_SERIES_TOTAL} occurrences in total (this series already has ${existingCount}).`,
      };
    }

    try {
      parsePattern(input.pattern);
    } catch {
      return { kind: "invalid_input", message: "Choose a valid repeat pattern." };
    }

    // Every row of the series (parent plus children, at most MAX_SERIES_TOTAL),
    // read once: the latest start for the date math, and what the new
    // occurrences inherit for the website listing.
    const children = await tx
      .select(EVENT_COLUMNS)
      .from(events)
      .where(
        and(eq(events.organizationId, organizationId), eq(events.parentEventId, parent.id)),
      )
      .orderBy(events.startsAt);
    const latestStart = children.reduce(
      (latest, c) => (c.startsAt.getTime() > latest.getTime() ? c.startsAt : latest),
      children.length > 0 ? children[0]!.startsAt : parent.startsAt,
    );

    // F252: from the LATEST non-cancelled occurrence, never the parent row
    // alone (the parent is usually the oldest and still listed after a "this and
    // later" unlisting), and never listed when the series is members-only.
    const inheritsListed =
      parent.isPublic && inheritedListing([parent, ...children].map(toSeriesRow));

    const durationMs =
      parent.endsAt ? parent.endsAt.getTime() - parent.startsAt.getTime() : null;

    const dates = generateRecurringDates(
      latestStart,
      input.pattern,
      input.additionalCount + 1,
    ).slice(1);

    const occurrenceIds: string[] = [];
    for (const date of dates) {
      const childEndsAt = durationMs !== null ? new Date(date.getTime() + durationMs) : null;
      const [child] = await tx
        .insert(events)
        .values({
          organizationId,
          title: parent.title,
          description: parent.description,
          location: parent.location,
          startsAt: date,
          endsAt: childEndsAt,
          isPublic: parent.isPublic,
          websiteListed: inheritsListed,
          allowsCheckin: parent.allowsCheckin,
          eventTypeId: parent.eventTypeId,
          parentEventId: parent.id,
          recurrencePattern: null,
          recurrenceCount: null,
        })
        .returning({ id: events.id });
      occurrenceIds.push(child!.id);
    }

    await tx
      .update(events)
      .set({ recurrencePattern: input.pattern, recurrenceCount: totalCount })
      .where(eq(events.id, parent.id));

    if (inheritsListed && occurrenceIds.length > 0) {
      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.EVENT_LISTED_ON_WEBSITE,
        actor,
        resourceType: "event",
        resourceId: parent.id,
        metadata: {
          organizationId,
          via: "extend",
          changed: occurrenceIds.length,
          rootEventId: parent.id,
        },
      });
    }

    return { kind: "ok", data: { occurrenceIds } };
  });
}

// ---------------------------------------------------------------------------
// setSeriesWebsiteListing
// ---------------------------------------------------------------------------

export interface SetSeriesWebsiteListingInput {
  /** The ANCHOR occurrence: it and every later occurrence of its series are changed. */
  eventId: string;
  listed: boolean;
}

/**
 * Puts an event and all LATER events of its series on the public website, or
 * takes them off, in one transaction (DECISION-238/240/241; Phase 2 R5). The
 * rest of a repeating series' editing is one occurrence at a time, so this is
 * the one series-wide action. A standalone event is a series of one and works
 * the same way.
 *
 * ONE job, ONE gate: `events.manage` first, inside this transaction. The anchor
 * is loaded scoped to `(id, organizationId)` - a foreign or missing id is
 * `invalid_target`, indistinguishably. The whole series is read `FOR UPDATE`,
 * the pure `planSeriesListing` (the very function `getEvent` counts with)
 * picks the ids, one UPDATE writes them, and ONE audit row records the change
 * (none when nothing changed). The table CHECK is the backstop; the rows are
 * locked, so it cannot fire here, and if it ever did the whole transaction
 * would roll back, never a partial change.
 *
 * Returns the ACTUAL counts, which the caller reports instead of the earlier
 * confirmation's (a concurrent edit may have moved them).
 */
export async function setSeriesWebsiteListing(
  viewerPersonId: string,
  organizationId: string,
  actor: EventActor,
  input: SetSeriesWebsiteListingInput,
): Promise<EventsResult<SeriesListingOutcome>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    if (typeof input.listed !== "boolean") {
      return { kind: "invalid_input", message: "Choose whether to put these events on the website or take them off." };
    }
    if (typeof input.eventId !== "string" || !isUuidShaped(input.eventId)) {
      return { kind: "invalid_target" }; // a garbage id must not reach Postgres as a 22P02
    }

    const [anchor] = await tx
      .select({ id: events.id, parentEventId: events.parentEventId })
      .from(events)
      .where(and(eq(events.id, input.eventId), eq(events.organizationId, organizationId)))
      .limit(1);
    if (!anchor) {
      return { kind: "invalid_target" };
    }

    const rootId = anchor.parentEventId ?? anchor.id;
    const seriesRows = await tx
      .select(EVENT_COLUMNS)
      .from(events)
      .where(
        and(
          eq(events.organizationId, organizationId),
          or(eq(events.id, rootId), eq(events.parentEventId, rootId)),
        ),
      )
      .orderBy(events.startsAt)
      .for("update");

    const plan = planSeriesListing(seriesRows.map(toSeriesRow), anchor.id, input.listed);

    if (plan.ids.length > 0) {
      await tx
        .update(events)
        .set({ websiteListed: input.listed })
        .where(and(eq(events.organizationId, organizationId), inArray(events.id, plan.ids)));

      await insertAuditRow(tx, {
        action: input.listed
          ? AUDIT_ACTIONS.EVENT_LISTED_ON_WEBSITE
          : AUDIT_ACTIONS.EVENT_UNLISTED_FROM_WEBSITE,
        actor,
        resourceType: "event",
        resourceId: rootId,
        metadata: {
          organizationId,
          via: "series",
          scope: "this_and_later",
          changed: plan.ids.length,
          skippedCancelled: plan.skippedCancelled,
          skippedMembersOnly: plan.skippedMembersOnly,
          rootEventId: rootId,
          anchorEventId: anchor.id,
        },
      });
    }

    return {
      kind: "ok",
      data: {
        changed: plan.ids.length,
        unchanged: plan.unchanged,
        skippedCancelled: plan.skippedCancelled,
        skippedMembersOnly: plan.skippedMembersOnly,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// cancelEvent
// ---------------------------------------------------------------------------

/**
 * Sets `cancelled_at = now()` on ONE occurrence. Never a delete, never
 * cascades to siblings (cancelling a series parent does not cancel its
 * children — an explicit v1 non-goal). `invalid_target` if the event doesn't
 * exist at this org; if already cancelled, this is an idempotent no-op —
 * `ok` again, not `invalid_input` (re-cancelling an already-cancelled row is
 * not a user mistake worth surfacing as one).
 */
export async function cancelEvent(
  viewerPersonId: string,
  organizationId: string,
  eventId: string,
): Promise<EventsResult<{ eventId: string }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [existing] = await tx
      .select({ id: events.id, cancelledAt: events.cancelledAt })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
      .limit(1);
    if (!existing) {
      return { kind: "invalid_target" };
    }
    if (existing.cancelledAt !== null) {
      return { kind: "ok", data: { eventId } };
    }

    await tx
      .update(events)
      .set({ cancelledAt: new Date() })
      .where(eq(events.id, eventId));

    return { kind: "ok", data: { eventId } };
  });
}

// ---------------------------------------------------------------------------
// getEventTypePickerData
// ---------------------------------------------------------------------------

export interface EventTypePickerOption {
  id: string;
  name: string;
  colorToken: EventTypeColor;
  iconKey: EventTypeIcon;
  /** True only for the event's own CURRENT type when that type has been retired. */
  isRetired: boolean;
}

export interface EventTypePickerData {
  options: EventTypePickerOption[];
  /** The fallback's name (what "No type" renders as), or null for an org with none. */
  fallbackName: string | null;
}

/**
 * What the event forms' type picker offers, under `events.manage` (the people
 * using the forms hold it; `event_types.manage` is a different permission).
 * `options` = the ACTIVE non-fallback types in manager order, plus the event's
 * CURRENT type when it has been retired (`isRetired: true`, so editing an old
 * event does not silently drop its type). The fallback is never an option - it
 * IS "No type" - and a current type equal to the fallback maps to "No type", so
 * it is not added either.
 */
export async function getEventTypePickerData(
  viewerPersonId: string,
  organizationId: string,
  opts?: { currentTypeId?: string | null },
): Promise<EventsResult<EventTypePickerData>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventsManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const currentTypeId =
      opts?.currentTypeId && isUuidShaped(opts.currentTypeId)
        ? opts.currentTypeId.toLowerCase()
        : null;

    const rows = await tx
      .select({
        id: eventTypes.id,
        name: eventTypes.name,
        color: eventTypes.color,
        icon: eventTypes.icon,
        isActive: eventTypes.isActive,
        isFallback: eventTypes.isFallback,
      })
      .from(eventTypes)
      .where(eq(eventTypes.organizationId, organizationId))
      .orderBy(eventTypes.sortOrder, sql`lower(${eventTypes.name})`, eventTypes.id);

    const options: EventTypePickerOption[] = rows
      .filter(
        (r) =>
          !r.isFallback && (r.isActive || r.id.toLowerCase() === currentTypeId),
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        colorToken: isEventTypeColor(r.color) ? r.color : "neutral",
        iconKey: isEventTypeIcon(r.icon) ? r.icon : DEFAULT_EVENT_TYPE_ICON,
        isRetired: !r.isActive,
      }));

    return {
      kind: "ok",
      data: {
        options,
        fallbackName: rows.find((r) => r.isFallback)?.name ?? null,
      },
    };
  });
}
