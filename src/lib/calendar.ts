import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import {
  isCategoryAxisOn,
  orgFeatureEnabledInTx,
} from "@/lib/org-features";
import { orgTimeZoneInTx } from "@/lib/org-settings";
import {
  DEFAULT_EVENT_TYPE_ICON,
  isEventTypeColor,
  isEventTypeIcon,
  type EventTypeColor,
  type EventTypeIcon,
} from "@/lib/events/type-palette";
import { sanitizeTypeFilter } from "@/lib/calendar/filters";
import {
  addDays,
  buildMonthGrid,
  isSameMonth,
  monthOfDayKey,
  type MonthRef,
} from "@/lib/calendar/month";
import { isUuidShaped } from "@/lib/shared/uuid";
import { todayInOrgZone } from "@/lib/shared/org-time";

/**
 * The member read path of the calendar — docs/work-log/2026-10-14-member-
 * calendar.md (Phase 3), DECISION-160/161. Three exports, one private gate, one
 * private visibility predicate, one private projection, shared by all three
 * (the home pipeline's requirement: the home card and the calendar can never
 * disagree about what a member sees).
 *
 * SAME SHAPE AS `src/lib/events.ts`: exactly one `withOrgContext()` transaction
 * per export, the gate checked FIRST inside it, a typed result instead of a
 * throw for every expected outcome. The order inside the transaction is fixed:
 *   (1) the org's calendar toggle (the category-axis flag is read BEFORE the
 *       transaction, `isFlagEnabled` having its own connection)  -> "disabled";
 *   (2) the permission gate, `events.view` OR `events.manage`, in ONE
 *       statement                                                -> "forbidden";
 *   (3) the org's time zone and today's key in it;
 *   (4) the queries.
 * `disabled` and `forbidden` are different pages with different copy, and the
 * gate runs before any lookup so existence is never revealed to someone
 * without access.
 *
 * `events.view OR events.manage` is NOT an implication built into the resolver
 * or the catalog (`presby_has_permission` is unchanged): it is this file's
 * private read gate (R8) and reveals nothing `events.manage` cannot already
 * read in the admin list.
 *
 * WALL-CLOCK TEXT, NEVER A `Date`. Times leave SQL as `to_char` text and are
 * formatted from their digits; bounds go in as bound 'YYYY-MM-DD' text cast
 * `::timestamp`, half-open (`>= first and < dayAfterLast`). "Today" is
 * `todayInOrgZone(now, org zone)`, never the server's date — on the last
 * evening of a month the server's UTC date is already next month. A raw
 * `new Date()` is permitted at most once per export, as the default for the
 * injectable `now`, and it only ever reaches `todayInOrgZone`.
 *
 * VISIBILITY (operator ruling 4): cancelled rows are excluded; `is_public` is
 * NOT a member filter (it means "open to everyone" vs. "members only", and
 * every active member sees both; being on the PUBLIC website is the separate
 * `website_listed`, read only by the anonymous presby_public_events_calendar()). Nothing admin-only is ever selected:
 * `allows_checkin`, `created_by`, `recurrence_count`, `recurrence_pattern`,
 * `parent_event_id` (as such), `created_at`, `updated_at`.
 *
 * UNTYPED EVENTS RESOLVE TO THE ORG'S FALLBACK TYPE IN SQL, so what is rendered
 * and what is filtered cannot disagree. `eventType` is null only for an org
 * with no event types at all.
 *
 * NO AUDIT: reads.
 */

export const CALENDAR_FEATURE_KEY = "org_portal.calendar" as const;

const EVENTS_VIEW = "events.view";
const EVENTS_MANAGE = "events.manage";

/** Runaway guard on the month query — a stored weekly series is ~4-5 rows a month. */
const MONTH_ROW_LIMIT = 1500;
const UPCOMING_LIMIT_MAX = 12;

export type MemberEventsResult<T> =
  | { kind: "ok"; data: T }
  /** The org's calendar toggle is off (or the worship category is). */
  | { kind: "disabled" }
  /** Neither events.view nor events.manage. */
  | { kind: "forbidden" };

export interface MemberEventType {
  id: string;
  name: string;
  colorToken: EventTypeColor;
  iconKey: EventTypeIcon;
}

export interface CalendarEntry {
  id: string;
  title: string;
  /** 'YYYY-MM-DDTHH:mm' via to_char in SQL. */
  startsAtWallClock: string;
  endsAtWallClock: string | null;
  /** startsAtWallClock.slice(0, 10) */
  dayKey: string;
  location: string | null;
  /** Read by Copy month only; never rendered. */
  isPublic: boolean;
  eventType: MemberEventType | null;
}

export interface MonthCalendarRequest {
  /** Already through parseMonthParam; absent -> the org-zone current month. */
  month?: MonthRef;
  /** Already through parseTypesParam; intersected with the org's ACTIVE ids INSIDE the transaction. */
  requestedTypeIds: readonly string[];
  /** Tests only. */
  now?: Date;
}

export interface MonthCalendarData {
  month: MonthRef;
  isCurrentMonth: boolean;
  timeZone: string;
  /** 'YYYY-MM-DD' in the org zone. */
  todayKey: string;
  /** The whole visible grid range, type-filtered, ordered (starts_at, id). */
  entries: CalendarEntry[];
  /** ACTIVE types, fallback LAST — the pills. */
  types: MemberEventType[];
  /** The sanitized filter; [] = All. */
  activeTypeIds: string[];
  /** Entries whose dayKey is in `month`, after the filter. */
  inMonthCount: number;
  /** The same without the filter (distinguishes "filters hide everything" from "empty month"). */
  unfilteredInMonthCount: number;
  /** Any non-cancelled event at all (only queried when unfilteredInMonthCount === 0). */
  orgHasEvents: boolean;
  /** events.manage — the page adds the org_portal.events flag check itself. */
  canManage: boolean;
}

export interface MemberEventDetail {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAtWallClock: string;
  endsAtWallClock: string | null;
  eventType: MemberEventType | null;
  /** parent_event_id is not null OR recurrence_pattern is not null. */
  isSeriesOccurrence: boolean;
}

export interface UpcomingMemberEvent {
  /** The representative occurrence; the detail-link target. */
  id: string;
  /** coalesce(parent_event_id, id) */
  seriesKey: string;
  title: string;
  /** 'YYYY-MM-DDTHH:mm' */
  startsAtWallClock: string;
  endsAtWallClock: string | null;
  location: string | null;
  /** null only when the org has no event types at all. */
  eventType: {
    name: string;
    colorToken: EventTypeColor;
    iconKey: EventTypeIcon;
  } | null;
}

// ---------------------------------------------------------------------------
// The shared SQL fragments (written once, interpolated into every query)
// ---------------------------------------------------------------------------

/** Untyped events resolve to the fallback row, typed events to their own. */
const MEMBER_FROM = sql`
  from events e
  left join event_types fb
    on fb.organization_id = e.organization_id and fb.is_fallback
  left join event_types t
    on t.id = coalesce(e.event_type_id, fb.id)
   and t.organization_id = e.organization_id
`;

/** Operator ruling 4: cancelled events are hidden. is_public is NOT a member filter. */
const MEMBER_VISIBLE = sql`e.cancelled_at is null`;

/** Text times, never a Date (check:sql-date, the wall-clock invariant). */
const STARTS_AT_WC = sql<string>`to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at_wc`;
const ENDS_AT_WC = sql<string>`to_char(e.ends_at, 'YYYY-MM-DD"T"HH24:MI') as ends_at_wc`;

/** The type columns every member projection selects. */
const TYPE_COLUMNS = sql`
  t.id as type_id, t.name as type_name, t.color as type_color, t.icon as type_icon
`;

// ---------------------------------------------------------------------------
// Private gate + projection
// ---------------------------------------------------------------------------

type GateOutcome =
  | { kind: "disabled" }
  | { kind: "forbidden" }
  | { kind: "open"; canManage: boolean };

/**
 * Steps (1) and (2) of the fixed order: toggle, then the permission gate.
 * `events.view OR events.manage` is ONE statement with both resolver calls.
 */
async function openMemberGate(
  tx: OrgTx,
  personId: string,
  organizationId: string,
  categoryAxisOn: boolean,
): Promise<GateOutcome> {
  if (
    !(await orgFeatureEnabledInTx(
      tx,
      organizationId,
      CALENDAR_FEATURE_KEY,
      categoryAxisOn,
    ))
  ) {
    return { kind: "disabled" };
  }

  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid, ${organizationId}::uuid, ${EVENTS_VIEW}
           ) as can_view,
           presby_has_permission(
             ${personId}::uuid, ${organizationId}::uuid, ${EVENTS_MANAGE}
           ) as can_manage
  `);
  const row = (
    result as unknown as {
      rows?: Array<{ can_view?: boolean; can_manage?: boolean }>;
    }
  ).rows?.[0];
  const canManage = row?.can_manage === true;
  if (row?.can_view !== true && !canManage) {
    return { kind: "forbidden" };
  }
  return { kind: "open", canManage };
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

interface TypeColumns {
  type_id: string | null;
  type_name: string | null;
  type_color: string | null;
  type_icon: string | null;
}

/** A stored value outside the closed lists degrades to neutral / CalendarDays, never throws. */
function toMemberEventType(row: TypeColumns): MemberEventType | null {
  if (!row.type_id || row.type_name === null) return null;
  return {
    id: row.type_id,
    name: row.type_name,
    colorToken: isEventTypeColor(row.type_color) ? row.type_color : "neutral",
    iconKey: isEventTypeIcon(row.type_icon) ? row.type_icon : DEFAULT_EVENT_TYPE_ICON,
  };
}

// ---------------------------------------------------------------------------
// getMonthCalendar
// ---------------------------------------------------------------------------

interface MonthRow extends TypeColumns {
  id: string;
  title: string;
  location: string | null;
  is_public: boolean;
  starts_at_wc: string;
  ends_at_wc: string | null;
}

/**
 * One month of the calendar for one viewer: the whole visible grid range
 * (`entries`), the pills (`types`), the sanitized filter and the counts the
 * page needs to pick the right empty state.
 */
export async function getMonthCalendar(
  viewerPersonId: string,
  organizationId: string,
  req: MonthCalendarRequest,
): Promise<MemberEventsResult<MonthCalendarData>> {
  const categoryAxisOn = await isCategoryAxisOn();

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const gate = await openMemberGate(
      tx,
      viewerPersonId,
      organizationId,
      categoryAxisOn,
    );
    if (gate.kind !== "open") return { kind: gate.kind };

    const timeZone = await orgTimeZoneInTx(tx, organizationId);
    const todayKey = todayInOrgZone(req.now ?? new Date(), timeZone);
    const month = req.month ?? monthOfDayKey(todayKey);
    const grid = buildMonthGrid(month);

    // The pills: ACTIVE types only, fallback last.
    const typeRows = rowsOf<{
      id: string;
      name: string;
      color: string;
      icon: string;
    }>(
      await tx.execute(sql`
        select id, name, color, icon
          from event_types
         where organization_id = ${organizationId}::uuid and is_active
         order by is_fallback, sort_order, lower(name), id
      `),
    );
    const types: MemberEventType[] = typeRows.flatMap((r) => {
      const type = toMemberEventType({
        type_id: r.id,
        type_name: r.name,
        type_color: r.color,
        type_icon: r.icon,
      });
      return type ? [type] : [];
    });
    const activeTypeIds = sanitizeTypeFilter(
      req.requestedTypeIds,
      types.map((t) => t.id),
    );

    const typeFilter: SQL =
      activeTypeIds.length > 0
        ? sql`and t.id in (${sql.join(
            activeTypeIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
        : sql``;

    const rows = rowsOf<MonthRow>(
      await tx.execute(sql`
        select e.id, e.title, e.location, e.is_public,
               ${STARTS_AT_WC}, ${ENDS_AT_WC},
               ${TYPE_COLUMNS}
          ${MEMBER_FROM}
         where e.organization_id = ${organizationId}::uuid
           and ${MEMBER_VISIBLE}
           and e.starts_at >= ${grid.firstKey}::timestamp
           and e.starts_at < ${grid.dayAfterLastKey}::timestamp
           ${typeFilter}
         order by e.starts_at, e.id
         limit ${MONTH_ROW_LIMIT}
      `),
    );

    const entries: CalendarEntry[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      startsAtWallClock: r.starts_at_wc,
      endsAtWallClock: r.ends_at_wc,
      dayKey: r.starts_at_wc.slice(0, 10),
      location: r.location,
      isPublic: r.is_public,
      eventType: toMemberEventType(r),
    }));

    const inMonthCount = entries.filter((e) =>
      isSameMonth(monthOfDayKey(e.dayKey), month),
    ).length;

    // Without a filter the unfiltered count is the count; with one, ask.
    let unfilteredInMonthCount = inMonthCount;
    if (activeTypeIds.length > 0) {
      const inMonthDays = grid.weeks.flat().filter((d) => d.inMonth);
      const monthStart = inMonthDays[0].key;
      const monthEndExclusive = addDays(inMonthDays[inMonthDays.length - 1].key, 1);
      const [countRow] = rowsOf<{ n: number }>(
        await tx.execute(sql`
          select count(*)::int as n
            from events e
           where e.organization_id = ${organizationId}::uuid
             and ${MEMBER_VISIBLE}
             and e.starts_at >= ${monthStart}::timestamp
             and e.starts_at < ${monthEndExclusive}::timestamp
        `),
      );
      unfilteredInMonthCount = Number(countRow?.n ?? 0);
    }

    // Only the genuinely empty month needs to know whether the ORG is empty.
    let orgHasEvents = true;
    if (unfilteredInMonthCount === 0) {
      const [existsRow] = rowsOf<{ has: boolean }>(
        await tx.execute(sql`
          select exists (
            select 1 from events e
             where e.organization_id = ${organizationId}::uuid
               and ${MEMBER_VISIBLE}
          ) as has
        `),
      );
      orgHasEvents = existsRow?.has === true;
    }

    return {
      kind: "ok",
      data: {
        month,
        isCurrentMonth: isSameMonth(month, monthOfDayKey(todayKey)),
        timeZone,
        todayKey,
        entries,
        types,
        activeTypeIds,
        inMonthCount,
        unfilteredInMonthCount,
        orgHasEvents,
        canManage: gate.canManage,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// getMemberEvent
// ---------------------------------------------------------------------------

interface DetailRow extends TypeColumns {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at_wc: string;
  ends_at_wc: string | null;
  is_series: boolean;
}

/**
 * One event for the detail page. `ok` with `event: null` means "no such event
 * for you" — missing, another org's, CANCELLED, or a non-UUID id — and the
 * page answers all four with the same `notFound()`. The gate runs FIRST, so
 * existence is never revealed to someone without access.
 */
export async function getMemberEvent(
  viewerPersonId: string,
  organizationId: string,
  eventId: string,
): Promise<
  MemberEventsResult<{ event: MemberEventDetail | null; canManage: boolean }>
> {
  const categoryAxisOn = await isCategoryAxisOn();

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const gate = await openMemberGate(
      tx,
      viewerPersonId,
      organizationId,
      categoryAxisOn,
    );
    if (gate.kind !== "open") return { kind: gate.kind };

    // A garbage id must not reach Postgres as a 22P02.
    if (!isUuidShaped(eventId)) {
      return { kind: "ok", data: { event: null, canManage: gate.canManage } };
    }

    const [row] = rowsOf<DetailRow>(
      await tx.execute(sql`
        select e.id, e.title, e.description, e.location,
               ${STARTS_AT_WC}, ${ENDS_AT_WC},
               (e.parent_event_id is not null
                 or e.recurrence_pattern is not null) as is_series,
               ${TYPE_COLUMNS}
          ${MEMBER_FROM}
         where e.id = ${eventId}::uuid
           and e.organization_id = ${organizationId}::uuid
           and ${MEMBER_VISIBLE}
         limit 1
      `),
    );

    const event: MemberEventDetail | null = row
      ? {
          id: row.id,
          title: row.title,
          description: row.description,
          location: row.location,
          startsAtWallClock: row.starts_at_wc,
          endsAtWallClock: row.ends_at_wc,
          eventType: toMemberEventType(row),
          isSeriesOccurrence: row.is_series === true,
        }
      : null;

    return { kind: "ok", data: { event, canManage: gate.canManage } };
  });
}

// ---------------------------------------------------------------------------
// listUpcomingMemberEvents
// ---------------------------------------------------------------------------

interface UpcomingRow extends TypeColumns {
  id: string;
  series_key: string;
  title: string;
  location: string | null;
  starts_at_wc: string;
  ends_at_wc: string | null;
}

/**
 * The home card's feed: the next events a member can see, ONE ROW PER SERIES.
 *
 * "Listed until its day ends": the filter is `starts_at >= <org-local today
 * 00:00>`, so a 10:30 service stays on the card until local midnight. Per
 * series (`coalesce(parent_event_id, id)`) the earliest qualifying row wins
 * (`distinct on`), so a series whose parent has passed yields its next child
 * with `seriesKey` = the parent's id. `limit` is clamped to 1..12; a
 * non-finite `limit` clamps to 1.
 *
 * The card needs no permission or toggle check of its own: it switches on
 * `kind` and renders nothing for `disabled` and `forbidden`. The set is a
 * subset of the calendar's default set by construction — same gate, same
 * `MEMBER_FROM`, same `MEMBER_VISIBLE`.
 */
export async function listUpcomingMemberEvents(
  viewerPersonId: string,
  organizationId: string,
  opts: { limit: number; now?: Date },
): Promise<MemberEventsResult<UpcomingMemberEvent[]>> {
  const limit = Number.isFinite(opts.limit)
    ? Math.min(UPCOMING_LIMIT_MAX, Math.max(1, Math.trunc(opts.limit)))
    : 1;
  const categoryAxisOn = await isCategoryAxisOn();

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const gate = await openMemberGate(
      tx,
      viewerPersonId,
      organizationId,
      categoryAxisOn,
    );
    if (gate.kind !== "open") return { kind: gate.kind };

    const timeZone = await orgTimeZoneInTx(tx, organizationId);
    const todayKey = todayInOrgZone(opts.now ?? new Date(), timeZone);

    const rows = rowsOf<UpcomingRow>(
      await tx.execute(sql`
        select * from (
          select distinct on (coalesce(e.parent_event_id, e.id))
                 e.id, coalesce(e.parent_event_id, e.id) as series_key,
                 e.title, e.location,
                 ${STARTS_AT_WC}, ${ENDS_AT_WC},
                 ${TYPE_COLUMNS}
            ${MEMBER_FROM}
           where e.organization_id = ${organizationId}::uuid
             and ${MEMBER_VISIBLE}
             and e.starts_at >= ${todayKey}::timestamp
           order by coalesce(e.parent_event_id, e.id), e.starts_at, e.id
        ) s
        order by s.starts_at_wc, s.id
        limit ${limit}
      `),
    );

    return {
      kind: "ok",
      data: rows.map((r) => {
        const type = toMemberEventType(r);
        return {
          id: r.id,
          seriesKey: r.series_key,
          title: r.title,
          startsAtWallClock: r.starts_at_wc,
          endsAtWallClock: r.ends_at_wc,
          location: r.location,
          eventType: type
            ? { name: type.name, colorToken: type.colorToken, iconKey: type.iconKey }
            : null,
        };
      }),
    };
  });
}
