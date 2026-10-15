import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { isUniqueViolation } from "@/lib/db/errors";
import { eventTypes } from "@/lib/db/domain/events";
import { organizations } from "@/lib/db/domain/org";
import {
  isEventTypeColor,
  isEventTypeIcon,
  type EventTypeColor,
  type EventTypeIcon,
} from "@/lib/events/type-palette";
import { eventTypeSeedPlan } from "@/lib/events/type-seed-plan";
import { isUuidShaped } from "@/lib/shared/uuid";

/**
 * Event types - the organization's own set of colour/icon labels for events
 * (docs/work-log/2026-10-14-member-calendar.md, Phase 3; DECISION-161). The
 * manager's CRUD under `event_types.manage` ONLY.
 *
 * SAME SHAPE AS `src/lib/events.ts`: one `withOrgContext()` transaction per
 * export, the single-permission gate checked FIRST inside it, a typed result
 * instead of a throw for every expected outcome. `events.manage` alone is
 * `forbidden` here: managing an event and managing the vocabulary events are
 * labelled with are different permissions (R9), and `event_types.manage` has no
 * default binding.
 *
 * NO AUDIT EVENTS ON ANY MUTATION HERE (DECISION-161, ruling R7). Event types
 * are content configuration, an extension of DECISION-113 ruling 5; there is no
 * tenant audit reader yet (DECISION-067), so an audit row would have no
 * tenant-side reader. Attribution is `updated_by` / `updated_at` on the row.
 * Do not add a `recordAudit()` call without a fresh ruling.
 *
 * NO DELETE: `presby_app` holds no DELETE grant on `event_types`. A type that is
 * no longer wanted is RETIRED (`is_active = false`): it stays on the events that
 * already carry it, stays out of the pills and the pickers, and keeps its name
 * reserved. The fallback ("General") cannot be retired, recoloured, or moved.
 *
 * A failed statement aborts its transaction, so a unique-index race (`23505`)
 * is caught OUTSIDE `withOrgContext`, never inside the callback.
 */

const EVENT_TYPES_MANAGE = "event_types.manage";
const NAME_MAX = 60;
const SORT_STEP = 10;

export type EventTypesResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string };

export interface EventTypeRow {
  id: string;
  name: string;
  color: EventTypeColor;
  icon: EventTypeIcon;
  sortOrder: number;
  isActive: boolean;
  isFallback: boolean;
  /** Events typed with it (cancelled included) - "Used by N events". */
  usageCount: number;
}

export interface EventTypeInput {
  name: string;
  color: string;
  icon: string;
}

async function hasEventTypesManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${EVENT_TYPES_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

/** Whether the viewer may manage this org's event types - for the page's links, not a substitute for the gate inside every export. */
export async function canManageEventTypes(
  viewerPersonId: string,
  organizationId: string,
): Promise<boolean> {
  return withOrgContext(viewerPersonId, organizationId, (tx) =>
    hasEventTypesManage(tx, viewerPersonId, organizationId),
  );
}

function duplicateMessage(name: string): string {
  return `You already have an event type called '${name}'.`;
}

type ValidInput =
  | { ok: true; name: string; color: EventTypeColor; icon: EventTypeIcon }
  | { ok: false; message: string };

/**
 * Field validation, before the database sees anything. Neutral is a valid
 * palette member here; whether it is allowed for THIS row (only the fallback's)
 * depends on the row and is decided by the caller.
 */
function validateInput(input: EventTypeInput): ValidInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length === 0) {
    return { ok: false, message: "Name is required." };
  }
  if (name.length > NAME_MAX) {
    return { ok: false, message: `Name must be ${NAME_MAX} characters or fewer.` };
  }
  if (!isEventTypeColor(input.color)) {
    return { ok: false, message: "Choose a color." };
  }
  if (!isEventTypeIcon(input.icon)) {
    return { ok: false, message: "Choose an icon." };
  }
  return { ok: true, name, color: input.color, icon: input.icon };
}

async function nameTaken(
  tx: OrgTx,
  organizationId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const conditions = [
    eq(eventTypes.organizationId, organizationId),
    sql`lower(${eventTypes.name}) = lower(${name})`,
  ];
  if (excludeId) conditions.push(ne(eventTypes.id, excludeId));
  const [row] = await tx
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(and(...conditions))
    .limit(1);
  return !!row;
}

async function loadType(tx: OrgTx, organizationId: string, id: string) {
  if (!isUuidShaped(id)) return null;
  const [row] = await tx
    .select({
      id: eventTypes.id,
      color: eventTypes.color,
      isFallback: eventTypes.isFallback,
      isActive: eventTypes.isActive,
    })
    .from(eventTypes)
    .where(and(eq(eventTypes.id, id), eq(eventTypes.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// listEventTypes
// ---------------------------------------------------------------------------

/**
 * ALL of the org's types, retired included, fallback LAST (`order by
 * is_fallback, sort_order, lower(name), id`), each with how many events carry it.
 */
export async function listEventTypes(
  viewerPersonId: string,
  organizationId: string,
): Promise<EventTypesResult<EventTypeRow[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventTypesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select t.id, t.name, t.color, t.icon, t.sort_order, t.is_active,
             t.is_fallback,
             (select count(*)::int
                from events e
               where e.event_type_id = t.id
                 and e.organization_id = t.organization_id) as usage_count
        from event_types t
       where t.organization_id = ${organizationId}::uuid
       order by t.is_fallback, t.sort_order, lower(t.name), t.id
    `);
    const rows =
      (
        result as unknown as {
          rows?: Array<{
            id: string;
            name: string;
            color: string;
            icon: string;
            sort_order: number;
            is_active: boolean;
            is_fallback: boolean;
            usage_count: number;
          }>;
        }
      ).rows ?? [];

    return {
      kind: "ok",
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        color: isEventTypeColor(r.color) ? r.color : "neutral",
        icon: isEventTypeIcon(r.icon) ? r.icon : "CalendarDays",
        sortOrder: Number(r.sort_order),
        isActive: r.is_active,
        isFallback: r.is_fallback,
        usageCount: Number(r.usage_count),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// createEventType
// ---------------------------------------------------------------------------

/**
 * Adds a type at the end of the manager's order (`max(sort_order)` of the
 * NON-fallback rows + 10, or 10 when there are none). Neutral is refused: it is
 * the fallback's colour.
 */
export async function createEventType(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: EventTypeInput,
): Promise<EventTypesResult<{ id: string }>> {
  const trimmedName = typeof input.name === "string" ? input.name.trim() : "";
  try {
    return await withOrgContext(viewerPersonId, organizationId, async (tx) => {
      if (!(await hasEventTypesManage(tx, viewerPersonId, organizationId))) {
        return { kind: "forbidden" } as const;
      }

      const valid = validateInput(input);
      if (!valid.ok) return { kind: "invalid_input", message: valid.message } as const;
      if (valid.color === "neutral") {
        // Neutral is reserved for the fallback, which is seeded, never created.
        return { kind: "invalid_input", message: "Choose a color." } as const;
      }
      if (await nameTaken(tx, organizationId, valid.name)) {
        return { kind: "invalid_input", message: duplicateMessage(valid.name) } as const;
      }

      const [maxRow] = await tx
        .select({ max: sql<number | null>`max(${eventTypes.sortOrder})` })
        .from(eventTypes)
        .where(
          and(
            eq(eventTypes.organizationId, organizationId),
            eq(eventTypes.isFallback, false),
          ),
        );
      const sortOrder = (maxRow?.max ?? 0) + SORT_STEP;

      const [created] = await tx
        .insert(eventTypes)
        .values({
          organizationId,
          name: valid.name,
          color: valid.color,
          icon: valid.icon,
          sortOrder,
          isActive: true,
          isFallback: false,
          updatedBy: actingUserId,
        })
        .returning({ id: eventTypes.id });

      return { kind: "ok", data: { id: created!.id } } as const;
    });
  } catch (err) {
    // The race the pre-check cannot see: two creators, one name.
    if (isUniqueViolation(err)) {
      return { kind: "invalid_input", message: duplicateMessage(trimmedName) };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updateEventType
// ---------------------------------------------------------------------------

/**
 * Renames / recolours / re-icons one type. The fallback keeps `neutral` (a
 * different colour is `invalid_input`); its name and icon are editable.
 * Editing never touches an event.
 */
export async function updateEventType(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: EventTypeInput & { id: string },
): Promise<EventTypesResult<{ id: string }>> {
  const trimmedName = typeof input.name === "string" ? input.name.trim() : "";
  try {
    return await withOrgContext(viewerPersonId, organizationId, async (tx) => {
      if (!(await hasEventTypesManage(tx, viewerPersonId, organizationId))) {
        return { kind: "forbidden" } as const;
      }

      const existing = await loadType(tx, organizationId, input.id);
      if (!existing) return { kind: "invalid_target" } as const;

      const valid = validateInput(input);
      if (!valid.ok) return { kind: "invalid_input", message: valid.message } as const;

      if (existing.isFallback) {
        if (valid.color !== "neutral") {
          return {
            kind: "invalid_input",
            message: "The default type keeps its neutral color.",
          } as const;
        }
      } else if (valid.color === "neutral") {
        return { kind: "invalid_input", message: "Choose a color." } as const;
      }

      if (await nameTaken(tx, organizationId, valid.name, existing.id)) {
        return { kind: "invalid_input", message: duplicateMessage(valid.name) } as const;
      }

      await tx
        .update(eventTypes)
        .set({
          name: valid.name,
          color: valid.color,
          icon: valid.icon,
          updatedBy: actingUserId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(eventTypes.id, existing.id), eq(eventTypes.organizationId, organizationId)),
        );

      return { kind: "ok", data: { id: existing.id } } as const;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { kind: "invalid_input", message: duplicateMessage(trimmedName) };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// setEventTypeActive
// ---------------------------------------------------------------------------

/**
 * Retires or reactivates a type. Retiring touches no event: the events keep
 * their type, which simply stops being offered. The fallback cannot be retired;
 * reactivating is always allowed.
 */
export async function setEventTypeActive(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  id: string,
  isActive: boolean,
): Promise<EventTypesResult<{ id: string }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventTypesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const existing = await loadType(tx, organizationId, id);
    if (!existing) return { kind: "invalid_target" };

    if (existing.isFallback && !isActive) {
      return { kind: "invalid_input", message: "The default type can't be retired." };
    }

    await tx
      .update(eventTypes)
      .set({ isActive, updatedBy: actingUserId, updatedAt: new Date() })
      .where(
        and(eq(eventTypes.id, existing.id), eq(eventTypes.organizationId, organizationId)),
      );

    return { kind: "ok", data: { id: existing.id } };
  });
}

// ---------------------------------------------------------------------------
// moveEventType
// ---------------------------------------------------------------------------

/**
 * Swaps a type with its neighbour among the NON-fallback rows (the listed
 * order, retired ones included), then renumbers those rows 10, 20, 30... The
 * fallback is never moved and is always listed last. Moving past an end is a
 * no-op `ok`. Last-write-wins: two admins moving at once can interleave, and
 * the result is still a valid order.
 */
export async function moveEventType(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  id: string,
  direction: "up" | "down",
): Promise<EventTypesResult<{ id: string }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventTypesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const existing = await loadType(tx, organizationId, id);
    if (!existing) return { kind: "invalid_target" };
    if (existing.isFallback) {
      return { kind: "invalid_input", message: "The default type always stays last." };
    }

    const ordered = await tx
      .select({ id: eventTypes.id, sortOrder: eventTypes.sortOrder })
      .from(eventTypes)
      .where(
        and(
          eq(eventTypes.organizationId, organizationId),
          eq(eventTypes.isFallback, false),
        ),
      )
      .orderBy(
        asc(eventTypes.sortOrder),
        asc(sql`lower(${eventTypes.name})`),
        asc(eventTypes.id),
      );

    const index = ordered.findIndex((r) => r.id === existing.id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= ordered.length) {
      return { kind: "ok", data: { id: existing.id } };
    }

    const reordered = [...ordered];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    for (let position = 0; position < reordered.length; position += 1) {
      const row = reordered[position];
      const sortOrder = (position + 1) * SORT_STEP;
      const before = ordered.find((r) => r.id === row.id)!.sortOrder;
      if (before === sortOrder) continue;
      await tx
        .update(eventTypes)
        .set({ sortOrder, updatedBy: actingUserId, updatedAt: new Date() })
        .where(
          and(eq(eventTypes.id, row.id), eq(eventTypes.organizationId, organizationId)),
        );
    }

    return { kind: "ok", data: { id: existing.id } };
  });
}

// ---------------------------------------------------------------------------
// seedStandardEventTypes
// ---------------------------------------------------------------------------

/**
 * "Add the standard event types": inserts the plan for this org's
 * `organization_type` (`eventTypeSeedPlan`) with `on conflict do nothing` - no
 * conflict target, so it also survives the fallback's partial unique index -
 * and returns how many rows it actually created. Idempotent: a second call
 * creates 0. Existing types are never changed.
 */
export async function seedStandardEventTypes(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
): Promise<EventTypesResult<{ created: number }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasEventTypesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [org] = await tx
      .select({ organizationType: organizations.organizationType })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return { kind: "invalid_target" };

    const plan = eventTypeSeedPlan(org.organizationType);
    const created = await tx
      .insert(eventTypes)
      .values(
        plan.map((t) => ({
          organizationId,
          name: t.name,
          color: t.color,
          icon: t.icon,
          sortOrder: t.sortOrder,
          isActive: t.isActive,
          isFallback: t.isFallback,
          updatedBy: actingUserId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: eventTypes.id });

    return { kind: "ok", data: { created: created.length } };
  });
}
