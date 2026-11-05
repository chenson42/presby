import "server-only";
import { sql } from "drizzle-orm";
import { dayKeyOf } from "@/lib/calendar/wall-clock";
import { platformOrigin } from "@/lib/domains/host";
import { isUuidShaped } from "@/lib/shared/uuid";
import { loadWorshipContext, runGated, type WorshipContext, type WorshipViewer } from "./access";
import { canScheduleTeam, holdsPermission, ledTeamIds } from "./authority";
import { loadSendableDrafts, resolveSendFilter } from "./drafts";
import { decideReach } from "./notify";
import {
  overlapWindow,
  pickerWarnings,
  sendPlan,
  summarizeSend,
  windowsOverlap,
  type PickerAssessment,
} from "./plan";
import { forbidden, notFound, ok, type WorshipResult } from "./result";
import { displayName, likePattern, rowsOf, uuidList } from "./sql-util";
import {
  LIMITS,
  holdsAnyWorshipKey,
  isReason,
  type AssignmentStatus,
  type NoticeOutcome,
  type Reason,
  type TeamKind,
} from "./vocab";

/**
 * Every worship read - docs/work-log/2026-11-04-worship-inc1.md, Phase 3
 * "Reads". Each export repeats the gate (`runGated`: applicability, the toggle,
 * the keys) inside its own `withOrgContext` transaction and returns a
 * `WorshipResult`, so a page can render the honest off, forbidden and
 * not-found states without a second read.
 *
 * Reads `events` ONLY for rows that carry a `worship_services` row
 * (DECISION-316, `calendar-visibility.source.test.ts`). Selects title, start,
 * end, location and `cancelled_at` and nothing of an event's content.
 *
 * No contact details anywhere in Increment 1 (the team page lists names and
 * the positions each person can fill). The roster search returns names only,
 * the `getGroupFormOptions` shape (F432, `paper`).
 *
 * The CONFIGURATION reads (teams, positions, service types, roster search)
 * come first; the SCHEDULING reads (my schedule, a request, my blockouts, the
 * team page, the services list, the board, the picker, the send preview and the
 * Features count) follow. Nothing here writes.
 */

// ---------------------------------------------------------------------------
// The gate answer
// ---------------------------------------------------------------------------

/** `getWorshipContext(v)`: any member. The off, not-applicable and ok states a page renders. */
export function getWorshipContext(viewer: WorshipViewer): Promise<WorshipContext> {
  return loadWorshipContext(viewer);
}

/** The roster predicate every read and every guard shares: in date on the organization's today. */
function rosterToday(alias: "gm", org: string) {
  const a = sql.raw(alias);
  return sql`${a}.starts_on <= presby_worship_org_today(${org}::uuid)
             and (${a}.ends_on is null or ${a}.ends_on > presby_worship_org_today(${org}::uuid))`;
}

const kindOf = (value: unknown): TeamKind => (value === "choir" ? "choir" : "team");

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export interface TeamListEntry {
  groupId: string;
  name: string;
  kind: TeamKind;
  retired: boolean;
  /** Distinct people on the roster now (any role). */
  peopleCount: number;
  /** Live positions. */
  positionCount: number;
}

/** `worship.manage`. Every team of the organization, retired ones last. */
export function getTeamsAdmin(viewer: WorshipViewer): Promise<WorshipResult<TeamListEntry[]>> {
  return runGated(viewer, ["manage"], async (tx, has): Promise<WorshipResult<TeamListEntry[]>> => {
    if (!has.manage) return forbidden();
    const org = viewer.organizationId;
    const rows = rowsOf(
      await tx.execute(sql`
        select wt.group_id::text as group_id, g.name, gt.key as kind, (wt.retired_at is not null) as retired,
               (select count(distinct gm.person_id)::int from group_memberships gm
                 where gm.organization_id = wt.organization_id and gm.group_id = wt.group_id
                   and ${rosterToday("gm", org)}) as people_count,
               (select count(*)::int from worship_positions wp
                 where wp.organization_id = wt.organization_id and wp.group_id = wt.group_id
                   and wp.retired_at is null) as position_count
          from worship_teams wt
          join groups g on g.id = wt.group_id and g.organization_id = wt.organization_id
          join group_types gt on gt.id = g.group_type_id
         where wt.organization_id = ${org}::uuid
         order by (wt.retired_at is not null), lower(g.name), wt.group_id
      `),
    );
    return ok(
      rows.map((r) => ({
        groupId: String(r.group_id),
        name: String(r.name),
        kind: kindOf(r.kind),
        retired: r.retired === true,
        peopleCount: Number(r.people_count),
        positionCount: Number(r.position_count),
      })),
    );
  });
}

export interface TeamPosition {
  id: string;
  name: string;
  slots: number;
  sortOrder: number;
}

export interface TeamPerson {
  groupMembershipId: string;
  personId: string;
  displayName: string;
  /** `chair`, `leader` or `member`: a seat is changed under Groups, a member row here. */
  role: "chair" | "leader" | "member";
  /** The live positions this person is marked as able to fill. */
  positionIds: string[];
}

export interface TeamAdmin {
  groupId: string;
  name: string;
  description: string | null;
  kind: TeamKind;
  retired: boolean;
  positions: TeamPosition[];
  people: TeamPerson[];
  /** True when the group carries a live role grant: roster edits are `groups.manage`'s (R6). */
  roleBound: boolean;
}

const ROSTER_CAP = 500;

/**
 * `worship.manage`. One team with its live positions and its roster now, each
 * person with the positions they can fill. A team of another organization, or
 * an unknown id, is `not_found`. Names only: no contact details.
 */
export function getTeamAdmin(viewer: WorshipViewer, input: { groupId: string }): Promise<WorshipResult<TeamAdmin>> {
  return runGated(viewer, ["manage"], async (tx, has): Promise<WorshipResult<TeamAdmin>> => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.groupId)) return notFound();
    const org = viewer.organizationId;

    const header = rowsOf(
      await tx.execute(sql`
        select g.name, g.description, gt.key as kind, (wt.retired_at is not null) as retired,
               exists (select 1 from role_grants rg
                        where rg.organization_id = wt.organization_id and rg.group_id = wt.group_id
                          and rg.starts_on <= presby_worship_org_today(wt.organization_id)
                          and (rg.ends_on is null or rg.ends_on > presby_worship_org_today(wt.organization_id))) as role_bound
          from worship_teams wt
          join groups g on g.id = wt.group_id and g.organization_id = wt.organization_id
          join group_types gt on gt.id = g.group_type_id
         where wt.organization_id = ${org}::uuid and wt.group_id = ${input.groupId}::uuid
      `),
    )[0];
    if (!header) return notFound();

    const positionRows = rowsOf(
      await tx.execute(sql`
        select id::text as id, name, slots::int as slots, sort_order::int as sort_order
          from worship_positions
         where organization_id = ${org}::uuid and group_id = ${input.groupId}::uuid and retired_at is null
         order by sort_order, lower(name), id
      `),
    );

    const peopleRows = rowsOf(
      await tx.execute(sql`
        select gm.id::text as gm_id, gm.person_id::text as person_id, gm.group_role,
               p.first_name, p.preferred_name, p.last_name,
               coalesce((select array_agg(q.position_id::text order by q.position_id)
                           from worship_position_qualifications q
                           join worship_positions wp on wp.id = q.position_id and wp.organization_id = q.organization_id
                          where q.organization_id = gm.organization_id and q.person_id = gm.person_id
                            and q.group_id = gm.group_id and q.ended_at is null and wp.retired_at is null),
                        array[]::text[]) as position_ids
          from group_memberships gm
          join people p on p.id = gm.person_id
          join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id
         where gm.organization_id = ${org}::uuid and gm.group_id = ${input.groupId}::uuid
           and ${rosterToday("gm", org)}
           and p.merged_into_id is null and p.date_of_death is null and m.ended_on is null
         order by case gm.group_role when 'chair' then 0 when 'leader' then 1 else 2 end, lower(p.last_name), lower(p.first_name), gm.id
         limit ${ROSTER_CAP}
      `),
    );

    return ok({
      groupId: input.groupId,
      name: String(header.name),
      description: header.description === null ? null : String(header.description),
      kind: kindOf(header.kind),
      retired: header.retired === true,
      roleBound: header.role_bound === true,
      positions: positionRows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        slots: Number(r.slots),
        sortOrder: Number(r.sort_order),
      })),
      people: peopleRows.map((r) => ({
        groupMembershipId: String(r.gm_id),
        personId: String(r.person_id),
        displayName: displayName(r as { first_name: unknown; preferred_name: unknown; last_name: unknown }),
        role: r.group_role === "chair" ? "chair" : r.group_role === "leader" ? "leader" : "member",
        positionIds: Array.isArray(r.position_ids) ? (r.position_ids as string[]) : [],
      })),
    });
  });
}

export interface RosterCandidate {
  personId: string;
  displayName: string;
}

/**
 * `worship.manage`. Up to 20 CURRENT members whose name matches `q` (at least
 * two characters), who are not already on this team's roster. Names only
 * (F432): the same shape `getGroupFormOptions` hands a `groups.manage` holder.
 */
export function searchRosterCandidates(
  viewer: WorshipViewer,
  input: { groupId: string; q: string },
): Promise<WorshipResult<RosterCandidate[]>> {
  return runGated(viewer, ["manage"], async (tx, has): Promise<WorshipResult<RosterCandidate[]>> => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.groupId)) return notFound();
    const term = typeof input.q === "string" ? input.q.trim() : "";
    if ([...term].length < LIMITS.rosterSearchMinChars) return ok([]);
    const org = viewer.organizationId;
    const pattern = likePattern(term.slice(0, 80));

    const team = rowsOf(
      await tx.execute(sql`select 1 from worship_teams where organization_id = ${org}::uuid and group_id = ${input.groupId}::uuid`),
    );
    if (team.length === 0) return notFound();

    const rows = rowsOf(
      await tx.execute(sql`
        select p.id::text as person_id, p.first_name, p.preferred_name, p.last_name
          from memberships m
          join people p on p.id = m.person_id
         where m.organization_id = ${org}::uuid and m.ended_on is null
           and p.merged_into_id is null and p.date_of_death is null
           and (p.first_name ilike ${pattern} escape '\\'
                or p.last_name ilike ${pattern} escape '\\'
                or coalesce(p.preferred_name, '') ilike ${pattern} escape '\\'
                or (coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name) ilike ${pattern} escape '\\')
           and not exists (select 1 from group_memberships gm
                            where gm.organization_id = m.organization_id and gm.group_id = ${input.groupId}::uuid
                              and gm.person_id = m.person_id and ${rosterToday("gm", org)})
         order by lower(p.last_name), lower(p.first_name), p.id
         limit ${LIMITS.rosterSearchMax}
      `),
    );
    return ok(
      rows.map((r) => ({
        personId: String(r.person_id),
        displayName: displayName(r as { first_name: unknown; preferred_name: unknown; last_name: unknown }),
      })),
    );
  });
}

export interface AdoptableGroup {
  groupId: string;
  name: string;
  kind: TeamKind;
}

/**
 * `worship.manage` AND `groups.manage`. The managed `choir` and `team` groups
 * that are not yet worship teams: what "Or use a group you already have"
 * offers. Anyone without `groups.manage` gets `forbidden` (the form hides the
 * section for them).
 */
export function getAdoptableGroups(viewer: WorshipViewer): Promise<WorshipResult<AdoptableGroup[]>> {
  return runGated(viewer, ["manage"], async (tx, has): Promise<WorshipResult<AdoptableGroup[]>> => {
    if (!has.manage) return forbidden();
    if (!(await holdsPermission(tx, viewer, "groups.manage"))) return forbidden();
    const rows = rowsOf(
      await tx.execute(sql`
        select g.id::text as group_id, g.name, gt.key as kind
          from groups g
          join group_types gt on gt.id = g.group_type_id
         where g.organization_id = ${viewer.organizationId}::uuid
           and g.membership_source = 'managed' and gt.key in ('choir', 'team')
           and not exists (select 1 from worship_teams wt where wt.group_id = g.id and wt.organization_id = g.organization_id)
         order by lower(g.name), g.id
      `),
    );
    return ok(rows.map((r) => ({ groupId: String(r.group_id), name: String(r.name), kind: kindOf(r.kind) })));
  });
}

// ---------------------------------------------------------------------------
// Service types and the service form
// ---------------------------------------------------------------------------

export interface ServiceTypeEntry {
  id: string;
  name: string;
  /** 'HH:MM' (24-hour). */
  startTime: string;
  durationMinutes: number | null;
  location: string | null;
  retired: boolean;
  /** Live, non-retired default teams. */
  teamIds: string[];
}

const typeRows = (viewerOrg: string, only?: string) => sql`
  select t.id::text as id, t.name, to_char(t.start_time, 'HH24:MI') as start_time, t.duration_minutes::int as duration_minutes,
         t.location, (t.retired_at is not null) as retired,
         coalesce((select array_agg(tt.group_id::text order by tt.group_id)
                     from worship_service_type_teams tt
                     join worship_teams wt on wt.group_id = tt.group_id and wt.organization_id = tt.organization_id
                    where tt.organization_id = t.organization_id and tt.service_type_id = t.id
                      and tt.removed_at is null and wt.retired_at is null), array[]::text[]) as team_ids
    from worship_service_types t
   where t.organization_id = ${viewerOrg}::uuid ${only ? sql`and t.id = ${only}::uuid` : sql``}
   order by (t.retired_at is not null), lower(t.name), t.id
`;

function toTypeEntry(r: Record<string, unknown>): ServiceTypeEntry {
  return {
    id: String(r.id),
    name: String(r.name),
    startTime: String(r.start_time),
    durationMinutes: r.duration_minutes === null ? null : Number(r.duration_minutes),
    location: r.location === null ? null : String(r.location),
    retired: r.retired === true,
    teamIds: Array.isArray(r.team_ids) ? (r.team_ids as string[]) : [],
  };
}

/** `worship.manage` or `worship.plan`. Every service type, retired ones last. */
export function getServiceTypes(viewer: WorshipViewer): Promise<WorshipResult<ServiceTypeEntry[]>> {
  return runGated(viewer, ["manage", "plan"], async (tx, has): Promise<WorshipResult<ServiceTypeEntry[]>> => {
    if (!has.manage && !has.plan) return forbidden();
    return ok(rowsOf(await tx.execute(typeRows(viewer.organizationId))).map(toTypeEntry));
  });
}

/** `worship.manage`. One service type (any state). */
export function getServiceType(
  viewer: WorshipViewer,
  input: { serviceTypeId: string },
): Promise<WorshipResult<ServiceTypeEntry>> {
  return runGated(viewer, ["manage"], async (tx, has): Promise<WorshipResult<ServiceTypeEntry>> => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.serviceTypeId)) return notFound();
    const row = rowsOf(await tx.execute(typeRows(viewer.organizationId, input.serviceTypeId)))[0];
    return row ? ok(toTypeEntry(row)) : notFound();
  });
}

export interface ServiceFormOptions {
  /** Live service types with their default teams. */
  types: ServiceTypeEntry[];
  /** Live (non-retired) teams a service can be served by. */
  teams: Array<{ groupId: string; name: string }>;
}

/** `worship.plan` (or `worship.manage`). What "Add a service" and "Add several services" offer. */
export function getServiceFormOptions(viewer: WorshipViewer): Promise<WorshipResult<ServiceFormOptions>> {
  return runGated(viewer, ["manage", "plan"], async (tx, has): Promise<WorshipResult<ServiceFormOptions>> => {
    if (!has.plan && !has.manage) return forbidden();
    const types = rowsOf(await tx.execute(typeRows(viewer.organizationId))).map(toTypeEntry).filter((t) => !t.retired);
    const teams = rowsOf(
      await tx.execute(sql`
        select wt.group_id::text as group_id, g.name
          from worship_teams wt
          join groups g on g.id = wt.group_id and g.organization_id = wt.organization_id
         where wt.organization_id = ${viewer.organizationId}::uuid and wt.retired_at is null
         order by lower(g.name), wt.group_id
      `),
    );
    return ok({ types, teams: teams.map((r) => ({ groupId: String(r.group_id), name: String(r.name) })) });
  });
}

// ===========================================================================
// SCHEDULING READS (Batch 3)
// ===========================================================================

const textOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const reasonOrNull = (value: unknown): Reason | null => (isReason(value) ? value : null);

// ---------------------------------------------------------------------------
// The volunteer's own side
// ---------------------------------------------------------------------------

export interface ScheduleItem {
  assignmentId: string;
  eventId: string;
  title: string;
  /** Wall-clock 'YYYY-MM-DDTHH:mm'. */
  startsAt: string;
  location: string | null;
  groupId: string;
  teamName: string;
  positionName: string;
  status: "requested" | "confirmed" | "declined";
  declineReason: Reason | null;
  /** From the worship read itself, never from opening the member event page (sign-ups F414). */
  cancelled: boolean;
}

export interface MyTeam {
  groupId: string;
  name: string;
  youLead: boolean;
}

export interface MySchedule {
  waiting: ScheduleItem[];
  scheduled: ScheduleItem[];
  declined: ScheduleItem[];
  teams: MyTeam[];
}

/**
 * ANY MEMBER, for themselves. Upcoming, non-withdrawn assignments grouped
 * waiting (requested), scheduled (confirmed) and declined, each with the
 * service's title and wall-clock start, the team, the position and whether the
 * service was cancelled. A DRAFT is not shown: nobody is told until Send. Also
 * the teams the viewer is on now (a non-retired worship team's roster in date)
 * and whether they lead each. Another member's rows, another organization's and
 * a toggled-off organization's are never returned (`runGated` and the person
 * filter).
 */
export function getMySchedule(viewer: WorshipViewer): Promise<WorshipResult<MySchedule>> {
  return runGated(viewer, [], async (tx): Promise<WorshipResult<MySchedule>> => {
    const org = viewer.organizationId;
    const rows = rowsOf(
      await tx.execute(sql`
        select a.id::text as assignment_id, a.event_id::text as event_id, e.title,
               to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at, e.location,
               a.group_id::text as group_id, g.name as team_name, wp.name as position_name,
               a.status, a.decline_reason, (e.cancelled_at is not null) as cancelled
          from worship_assignments a
          join events e on e.id = a.event_id and e.organization_id = a.organization_id
          join worship_positions wp on wp.id = a.position_id and wp.organization_id = a.organization_id
          join groups g on g.id = a.group_id and g.organization_id = a.organization_id
         where a.organization_id = ${org}::uuid and a.person_id = ${viewer.personId}::uuid
           and a.status in ('requested', 'confirmed', 'declined')
           and e.starts_at > presby_worship_org_now(a.organization_id)
         order by e.starts_at, a.id
         limit 200
      `),
    );
    const items: ScheduleItem[] = rows.map((r) => ({
      assignmentId: String(r.assignment_id),
      eventId: String(r.event_id),
      title: String(r.title),
      startsAt: String(r.starts_at),
      location: textOrNull(r.location),
      groupId: String(r.group_id),
      teamName: String(r.team_name),
      positionName: String(r.position_name),
      status: r.status as ScheduleItem["status"],
      declineReason: reasonOrNull(r.decline_reason),
      cancelled: r.cancelled === true,
    }));
    const teamRows = rowsOf(
      await tx.execute(sql`
        select wt.group_id::text as group_id, g.name,
               presby_worship_leads_team(wt.organization_id, ${viewer.personId}::uuid, wt.group_id,
                                         presby_worship_org_today(wt.organization_id)) as you_lead
          from worship_teams wt
          join groups g on g.id = wt.group_id and g.organization_id = wt.organization_id
         where wt.organization_id = ${org}::uuid and wt.retired_at is null
           and exists (select 1 from group_memberships gm
                        where gm.organization_id = wt.organization_id and gm.group_id = wt.group_id
                          and gm.person_id = ${viewer.personId}::uuid and ${rosterToday("gm", org)})
         order by lower(g.name), wt.group_id
      `),
    );
    return ok({
      waiting: items.filter((i) => i.status === "requested"),
      scheduled: items.filter((i) => i.status === "confirmed"),
      declined: items.filter((i) => i.status === "declined"),
      teams: teamRows.map((r) => ({ groupId: String(r.group_id), name: String(r.name), youLead: r.you_lead === true })),
    });
  });
}

export interface RequestView {
  assignmentId: string;
  organizationName: string;
  eventId: string;
  groupId: string;
  title: string;
  startsAt: string;
  location: string | null;
  teamName: string;
  positionName: string;
  status: Exclude<AssignmentStatus, "draft">;
  declineReason: Reason | null;
  cancelled: boolean;
  started: boolean;
  /** Not withdrawn, not cancelled, not started: the person can still answer. */
  open: boolean;
}

/**
 * ANY MEMBER, their own request. `not_found` unless the row is the viewer's
 * (and not a draft): another person's assignment id, an unknown id and a
 * draft's id are the SAME answer. A withdrawn row, a cancelled or a started
 * service comes back with `open: false` so the page shows "This request is no
 * longer open".
 */
export function getRequest(viewer: WorshipViewer, input: { assignmentId: string }): Promise<WorshipResult<RequestView>> {
  return runGated(viewer, [], async (tx): Promise<WorshipResult<RequestView>> => {
    if (!isUuidShaped(input.assignmentId)) return notFound();
    const r = rowsOf(
      await tx.execute(sql`
        select a.id::text as assignment_id, a.event_id::text as event_id, a.group_id::text as group_id,
               o.name as organization_name, e.title, to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at, e.location,
               g.name as team_name, wp.name as position_name, a.status, a.decline_reason,
               (e.cancelled_at is not null) as cancelled,
               (e.starts_at <= presby_worship_org_now(a.organization_id)) as started
          from worship_assignments a
          join organizations o on o.id = a.organization_id
          join events e on e.id = a.event_id and e.organization_id = a.organization_id
          join worship_positions wp on wp.id = a.position_id and wp.organization_id = a.organization_id
          join groups g on g.id = a.group_id and g.organization_id = a.organization_id
         where a.id = ${input.assignmentId}::uuid and a.organization_id = ${viewer.organizationId}::uuid
           and a.person_id = ${viewer.personId}::uuid and a.status <> 'draft'
      `),
    )[0];
    if (!r) return notFound();
    const cancelled = r.cancelled === true;
    const started = r.started === true;
    const status = r.status as RequestView["status"];
    return ok({
      assignmentId: String(r.assignment_id),
      organizationName: String(r.organization_name),
      eventId: String(r.event_id),
      groupId: String(r.group_id),
      title: String(r.title),
      startsAt: String(r.starts_at),
      location: textOrNull(r.location),
      teamName: String(r.team_name),
      positionName: String(r.position_name),
      status,
      declineReason: reasonOrNull(r.decline_reason),
      cancelled,
      started,
      open: status !== "withdrawn" && !cancelled && !started,
    });
  });
}

export interface BlockoutEntry {
  id: string;
  /** 'YYYY-MM-DD', inclusive. */
  startsOn: string;
  endsOn: string;
  reason: Reason | null;
}

/** ANY MEMBER, their own live "dates I can't serve", earliest first. */
export function getMyBlockouts(viewer: WorshipViewer): Promise<WorshipResult<BlockoutEntry[]>> {
  return runGated(viewer, [], async (tx): Promise<WorshipResult<BlockoutEntry[]>> => {
    const rows = rowsOf(
      await tx.execute(sql`
        select id::text as id, starts_on::text as starts_on, ends_on::text as ends_on, reason
          from worship_blockouts
         where organization_id = ${viewer.organizationId}::uuid and person_id = ${viewer.personId}::uuid and ended_at is null
         order by starts_on, id
      `),
    );
    return ok(
      rows.map((r) => ({
        id: String(r.id),
        startsOn: String(r.starts_on),
        endsOn: String(r.ends_on),
        reason: reasonOrNull(r.reason),
      })),
    );
  });
}

// ---------------------------------------------------------------------------
// The team page
// ---------------------------------------------------------------------------

export interface TeamPagePerson {
  personId: string;
  displayName: string;
  role: "chair" | "leader" | "member";
  /** Names of the live positions this person is marked as able to fill. */
  canFill: string[];
}

export interface TeamPage {
  groupId: string;
  name: string;
  description: string | null;
  retired: boolean;
  leaders: TeamPagePerson[];
  people: TeamPagePerson[];
  /** The viewer may schedule this team (the key or the seat): the page offers "Schedule this team". */
  canSchedule: boolean;
  /** Upcoming, uncancelled services this team serves; only for someone who may schedule. */
  services: Array<{ eventId: string; title: string; startsAt: string }>;
}

/**
 * A person on the team's roster now, or a holder of ANY worship key. Everyone
 * else (and an unknown or other organization's id) gets `not_found`. Names, the
 * chair and leader badges and the positions each person can fill. NO CONTACT
 * DETAILS in Increment 1.
 */
export function getTeamPage(viewer: WorshipViewer, input: { groupId: string }): Promise<WorshipResult<TeamPage>> {
  return runGated(viewer, ["manage", "plan", "schedule"], async (tx, has): Promise<WorshipResult<TeamPage>> => {
    if (!isUuidShaped(input.groupId)) return notFound();
    const org = viewer.organizationId;
    const header = rowsOf(
      await tx.execute(sql`
        select g.name, g.description, (wt.retired_at is not null) as retired,
               exists (select 1 from group_memberships gm
                        where gm.organization_id = wt.organization_id and gm.group_id = wt.group_id
                          and gm.person_id = ${viewer.personId}::uuid and ${rosterToday("gm", org)}) as on_team
          from worship_teams wt
          join groups g on g.id = wt.group_id and g.organization_id = wt.organization_id
         where wt.organization_id = ${org}::uuid and wt.group_id = ${input.groupId}::uuid
      `),
    )[0];
    if (!header) return notFound();
    const anyKey = holdsAnyWorshipKey({ manage: has.manage === true, plan: has.plan === true, schedule: has.schedule === true });
    if (header.on_team !== true && !anyKey) return notFound();

    const peopleRows = rowsOf(
      await tx.execute(sql`
        select gm.person_id::text as person_id, gm.group_role, p.first_name, p.preferred_name, p.last_name,
               coalesce((select array_agg(wp.name order by wp.sort_order, lower(wp.name))
                           from worship_position_qualifications q
                           join worship_positions wp on wp.id = q.position_id and wp.organization_id = q.organization_id
                          where q.organization_id = gm.organization_id and q.group_id = gm.group_id
                            and q.person_id = gm.person_id and q.ended_at is null and wp.retired_at is null),
                        array[]::text[]) as can_fill
          from group_memberships gm
          join people p on p.id = gm.person_id
          join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id
         where gm.organization_id = ${org}::uuid and gm.group_id = ${input.groupId}::uuid and ${rosterToday("gm", org)}
           and p.merged_into_id is null and p.date_of_death is null and m.ended_on is null
         order by lower(p.last_name), lower(p.first_name), gm.id
         limit ${ROSTER_CAP}
      `),
    );
    const all: TeamPagePerson[] = peopleRows.map((r) => ({
      personId: String(r.person_id),
      displayName: displayName(r as { first_name: unknown; preferred_name: unknown; last_name: unknown }),
      role: r.group_role === "chair" ? "chair" : r.group_role === "leader" ? "leader" : "member",
      canFill: Array.isArray(r.can_fill) ? (r.can_fill as string[]) : [],
    }));

    const canSchedule = await canScheduleTeam(tx, viewer, input.groupId, { schedule: has.schedule === true });
    let services: TeamPage["services"] = [];
    if (canSchedule) {
      services = rowsOf(
        await tx.execute(sql`
          select e.id::text as event_id, e.title, to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at
            from worship_service_teams st
            join events e on e.id = st.event_id and e.organization_id = st.organization_id
           where st.organization_id = ${org}::uuid and st.group_id = ${input.groupId}::uuid and st.removed_at is null
             and e.cancelled_at is null and e.starts_at > presby_worship_org_now(st.organization_id)
           order by e.starts_at, e.id
           limit 20
        `),
      ).map((r) => ({ eventId: String(r.event_id), title: String(r.title), startsAt: String(r.starts_at) }));
    }
    return ok({
      groupId: input.groupId,
      name: String(header.name),
      description: textOrNull(header.description),
      retired: header.retired === true,
      leaders: all.filter((p) => p.role !== "member"),
      people: all.filter((p) => p.role === "member"),
      canSchedule,
      services,
    });
  });
}

// ---------------------------------------------------------------------------
// Services and the board
// ---------------------------------------------------------------------------

export interface ServiceListEntry {
  eventId: string;
  title: string;
  startsAt: string;
  location: string | null;
  cancelled: boolean;
  /** Draft, requested and confirmed people against the slots of the serving teams' live positions. */
  filled: number;
  needed: number;
  waiting: number;
}

/**
 * ANY WORSHIP KEY. Services: `upcoming` (from the start of the organization's
 * today, capped at 100) or `earlier` (the last 20). ONE aggregate statement
 * for the counts: filled is capped per position at its slots, needed is the sum
 * of the slots of the live positions of the serving, non-removed teams, waiting
 * is the number of requests still unanswered.
 */
export function getServicesList(
  viewer: WorshipViewer,
  input: { scope: "upcoming" | "earlier" },
): Promise<WorshipResult<ServiceListEntry[]>> {
  return runGated(viewer, ["manage", "plan", "schedule"], async (tx, has): Promise<WorshipResult<ServiceListEntry[]>> => {
    if (!holdsAnyWorshipKey({ manage: has.manage === true, plan: has.plan === true, schedule: has.schedule === true })) {
      return forbidden();
    }
    const upcoming = input.scope !== "earlier";
    const rows = rowsOf(
      await tx.execute(sql`
        select e.id::text as event_id, e.title, to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at, e.location,
               (e.cancelled_at is not null) as cancelled,
               coalesce((select sum(c.slots)::int from (
                           select wp.slots from worship_service_teams st
                             join worship_positions wp on wp.group_id = st.group_id and wp.organization_id = st.organization_id and wp.retired_at is null
                            where st.event_id = e.id and st.organization_id = e.organization_id and st.removed_at is null) c), 0) as needed,
               coalesce((select sum(least(c.n, c.slots))::int from (
                           select wp.slots,
                                  (select count(*) from worship_assignments a
                                    where a.position_id = wp.id and a.event_id = e.id and a.organization_id = e.organization_id
                                      and a.status in ('draft', 'requested', 'confirmed')) as n
                             from worship_service_teams st
                             join worship_positions wp on wp.group_id = st.group_id and wp.organization_id = st.organization_id and wp.retired_at is null
                            where st.event_id = e.id and st.organization_id = e.organization_id and st.removed_at is null) c), 0) as filled,
               (select count(*)::int from worship_assignments a
                 where a.event_id = e.id and a.organization_id = e.organization_id and a.status = 'requested') as waiting
          from events e
          join worship_services ws on ws.event_id = e.id and ws.organization_id = e.organization_id
         where e.organization_id = ${viewer.organizationId}::uuid
           and ${
             upcoming
               ? sql`e.starts_at >= date_trunc('day', presby_worship_org_now(e.organization_id))`
               : sql`e.starts_at < date_trunc('day', presby_worship_org_now(e.organization_id))`
           }
         order by ${upcoming ? sql`e.starts_at, e.id` : sql`e.starts_at desc, e.id`}
         limit ${upcoming ? LIMITS.servicesListUpcoming : LIMITS.servicesListEarlier}
      `),
    );
    return ok(
      rows.map((r) => ({
        eventId: String(r.event_id),
        title: String(r.title),
        startsAt: String(r.starts_at),
        location: textOrNull(r.location),
        cancelled: r.cancelled === true,
        filled: Number(r.filled),
        needed: Number(r.needed),
        waiting: Number(r.waiting),
      })),
    );
  });
}

export interface BoardAssignment {
  assignmentId: string;
  personId: string | null;
  /** The person's display name, or the guest's name. */
  name: string;
  isGuest: boolean;
  status: AssignmentStatus;
  declineReason: Reason | null;
  noticeOutcome: NoticeOutcome | null;
  /** The display name of the leader who recorded the answer, when it was recorded on the person's behalf. */
  recordedBy: string | null;
  /** Presumed under 18 (`presby_photo_subject_is_minor`): no email goes to them; the leader asks a parent or guardian. */
  mayBeUnder18: boolean;
}

export interface BoardPosition {
  positionId: string;
  name: string;
  slots: number;
  /** Draft, requested and confirmed. */
  filled: number;
  assignments: BoardAssignment[];
}

export interface BoardTeam {
  groupId: string;
  name: string;
  /** The viewer may place, remove, record and send for THIS team. */
  canSchedule: boolean;
  positions: BoardPosition[];
}

export interface ServiceBoard {
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  cancelled: boolean;
  started: boolean;
  teams: BoardTeam[];
}

/**
 * ANY WORSHIP KEY (every serving team) or a live SEAT (the teams the viewer
 * leads). One statement per level (the service, the teams, the positions, the
 * assignments): no query per team or per person. `groupId` narrows to one team.
 * An event that is not a worship service is `not_found`; a viewer with neither a
 * key nor a seat on any serving team (or on the named team) is `forbidden`, which
 * a page renders as the same not-found as an unknown id.
 */
export function getServiceBoard(
  viewer: WorshipViewer,
  input: { eventId: string; groupId?: string },
): Promise<WorshipResult<ServiceBoard>> {
  return runGated(viewer, ["manage", "plan", "schedule"], async (tx, has): Promise<WorshipResult<ServiceBoard>> => {
    if (!isUuidShaped(input.eventId)) return notFound();
    if (input.groupId !== undefined && !isUuidShaped(input.groupId)) return notFound();
    const org = viewer.organizationId;
    const service = rowsOf(
      await tx.execute(sql`
        select e.id::text as event_id, e.title, to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at,
               to_char(e.ends_at, 'YYYY-MM-DD"T"HH24:MI') as ends_at, e.location,
               (e.cancelled_at is not null) as cancelled,
               (e.starts_at <= presby_worship_org_now(e.organization_id)) as started
          from events e
          join worship_services ws on ws.event_id = e.id and ws.organization_id = e.organization_id
         where e.id = ${input.eventId}::uuid and e.organization_id = ${org}::uuid
      `),
    )[0];
    if (!service) return notFound();

    const anyKey = holdsAnyWorshipKey({ manage: has.manage === true, plan: has.plan === true, schedule: has.schedule === true });
    const led = await ledTeamIds(tx, viewer);
    const serving = rowsOf(
      await tx.execute(sql`
        select st.group_id::text as group_id, g.name
          from worship_service_teams st
          join groups g on g.id = st.group_id and g.organization_id = st.organization_id
         where st.organization_id = ${org}::uuid and st.event_id = ${input.eventId}::uuid and st.removed_at is null
         order by lower(g.name), st.group_id
      `),
    );
    let visible = serving.filter((t) => anyKey || led.includes(String(t.group_id)));
    if (input.groupId !== undefined) visible = visible.filter((t) => String(t.group_id) === input.groupId);
    if (visible.length === 0) return forbidden();
    const groupIds = visible.map((t) => String(t.group_id));

    const positionRows = rowsOf(
      await tx.execute(sql`
        select id::text as id, group_id::text as group_id, name, slots::int as slots
          from worship_positions
         where organization_id = ${org}::uuid and group_id in (${uuidList(groupIds)}) and retired_at is null
         order by sort_order, lower(name), id
      `),
    );
    const assignmentRows = rowsOf(
      await tx.execute(sql`
        select a.id::text as id, a.group_id::text as group_id, a.position_id::text as position_id,
               a.person_id::text as person_id, a.guest_name, a.status, a.decline_reason, a.notice_outcome,
               a.response_source,
               p.first_name, p.preferred_name, p.last_name,
               rp.first_name as r_first, rp.preferred_name as r_preferred, rp.last_name as r_last,
               (a.person_id is not null and presby_photo_subject_is_minor(a.organization_id, a.person_id)) as minor
          from worship_assignments a
          left join people p on p.id = a.person_id
          left join people rp on rp.id = a.responded_by_person_id and a.response_source = 'on_behalf'
         where a.organization_id = ${org}::uuid and a.event_id = ${input.eventId}::uuid
           and a.group_id in (${uuidList(groupIds)}) and a.status <> 'withdrawn'
         order by a.created_at, a.id
      `),
    );

    const byPosition = new Map<string, BoardAssignment[]>();
    for (const r of assignmentRows) {
      const guest = r.person_id === null;
      const assignment: BoardAssignment = {
        assignmentId: String(r.id),
        personId: guest ? null : String(r.person_id),
        name: guest
          ? String(r.guest_name)
          : displayName(r as { first_name: unknown; preferred_name: unknown; last_name: unknown }),
        isGuest: guest,
        status: r.status as AssignmentStatus,
        declineReason: reasonOrNull(r.decline_reason),
        noticeOutcome: (r.notice_outcome as NoticeOutcome | null) ?? null,
        recordedBy:
          r.response_source === "on_behalf" && r.r_first !== null
            ? displayName({ first_name: r.r_first, preferred_name: r.r_preferred, last_name: r.r_last })
            : null,
        mayBeUnder18: r.minor === true,
      };
      const list = byPosition.get(String(r.position_id));
      if (list) list.push(assignment);
      else byPosition.set(String(r.position_id), [assignment]);
    }

    const teams: BoardTeam[] = visible.map((t) => {
      const groupId = String(t.group_id);
      return {
        groupId,
        name: String(t.name),
        canSchedule: has.schedule === true || led.includes(groupId),
        positions: positionRows
          .filter((p) => String(p.group_id) === groupId)
          .map((p) => {
            const assignments = byPosition.get(String(p.id)) ?? [];
            return {
              positionId: String(p.id),
              name: String(p.name),
              slots: Number(p.slots),
              filled: assignments.filter((a) => a.status !== "declined").length,
              assignments,
            };
          }),
      };
    });
    return ok({
      eventId: String(service.event_id),
      title: String(service.title),
      startsAt: String(service.starts_at),
      endsAt: textOrNull(service.ends_at),
      location: textOrNull(service.location),
      cancelled: service.cancelled === true,
      started: service.started === true,
      teams,
    });
  });
}

// ---------------------------------------------------------------------------
// The picker and the send preview
// ---------------------------------------------------------------------------

export interface PickerCandidate extends PickerAssessment {
  personId: string;
  displayName: string;
}

/**
 * `worship.schedule` or a live seat on `groupId`. The roster of that team, now,
 * for one position on one service: who is marked for the position, who has
 * saved the date as one they can't serve, who already holds a position that day
 * or overlaps another service, who said they can't serve THIS service, and who
 * may be under 18. `plan.pickerWarnings` turns the facts into warnings; nothing
 * here refuses (warn, never block). Excludes merged, deceased and
 * ended-relationship people, and anyone already live in this position on this
 * service. `showAll: false` lists only people marked for the position.
 *
 * Two statements regardless of the roster size (the roster with its flags, then
 * the other positions those people hold that day and the day on either side):
 * no query per person.
 */
export function getPickerCandidates(
  viewer: WorshipViewer,
  input: { eventId: string; groupId: string; positionId: string; showAll: boolean },
): Promise<WorshipResult<PickerCandidate[]>> {
  return runGated(viewer, ["schedule"], async (tx, has): Promise<WorshipResult<PickerCandidate[]>> => {
    if (![input.eventId, input.groupId, input.positionId].every((id) => typeof id === "string" && isUuidShaped(id))) {
      return notFound();
    }
    if (!(await canScheduleTeam(tx, viewer, input.groupId, { schedule: has.schedule === true }))) return forbidden();
    const org = viewer.organizationId;

    const service = rowsOf(
      await tx.execute(sql`
        select to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at, to_char(e.ends_at, 'YYYY-MM-DD"T"HH24:MI') as ends_at
          from events e
          join worship_services ws on ws.event_id = e.id and ws.organization_id = e.organization_id
         where e.id = ${input.eventId}::uuid and e.organization_id = ${org}::uuid
      `),
    )[0];
    if (!service) return notFound();
    const position = rowsOf(
      await tx.execute(sql`
        select 1 from worship_positions
         where id = ${input.positionId}::uuid and group_id = ${input.groupId}::uuid and organization_id = ${org}::uuid
      `),
    )[0];
    if (!position) return notFound();
    const startsAt = String(service.starts_at);
    const serviceDate = dayKeyOf(startsAt);

    const roster = rowsOf(
      await tx.execute(sql`
        select gm.person_id::text as person_id, p.first_name, p.preferred_name, p.last_name,
               exists (select 1 from worship_position_qualifications q
                        where q.organization_id = gm.organization_id and q.position_id = ${input.positionId}::uuid
                          and q.person_id = gm.person_id and q.ended_at is null) as qualified,
               exists (select 1 from worship_blockouts b
                        where b.organization_id = gm.organization_id and b.person_id = gm.person_id and b.ended_at is null
                          and ${serviceDate}::date between b.starts_on and b.ends_on) as blocked,
               exists (select 1 from worship_assignments a
                        where a.organization_id = gm.organization_id and a.event_id = ${input.eventId}::uuid
                          and a.person_id = gm.person_id and a.status = 'declined') as declined_this,
               presby_photo_subject_is_minor(gm.organization_id, gm.person_id) as minor
          from group_memberships gm
          join people p on p.id = gm.person_id
          join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id
         where gm.organization_id = ${org}::uuid and gm.group_id = ${input.groupId}::uuid and ${rosterToday("gm", org)}
           and p.merged_into_id is null and p.date_of_death is null and m.ended_on is null
           and not exists (select 1 from worship_assignments a
                            where a.organization_id = gm.organization_id and a.event_id = ${input.eventId}::uuid
                              and a.position_id = ${input.positionId}::uuid and a.person_id = gm.person_id
                              and a.status <> 'withdrawn')
         order by lower(p.last_name), lower(p.first_name), gm.person_id
         limit ${ROSTER_CAP}
      `),
    );
    const personIds = [...new Set(roster.map((r) => String(r.person_id)))];

    const others =
      personIds.length === 0
        ? []
        : rowsOf(
            await tx.execute(sql`
              select a.person_id::text as person_id, a.event_id::text as event_id, e.title,
                     to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at,
                     to_char(e.ends_at, 'YYYY-MM-DD"T"HH24:MI') as ends_at, wp.name as position_name
                from worship_assignments a
                join events e on e.id = a.event_id and e.organization_id = a.organization_id
                join worship_positions wp on wp.id = a.position_id and wp.organization_id = a.organization_id
               where a.organization_id = ${org}::uuid and a.person_id in (${uuidList(personIds)})
                 and a.status in ('draft', 'requested', 'confirmed') and e.cancelled_at is null
                 and e.starts_at::date between (${serviceDate}::date - 1) and (${serviceDate}::date + 1)
            `),
          );
    const thisWindow = overlapWindow(startsAt, service.ends_at === null ? null : String(service.ends_at));
    const sameDay = new Map<string, string[]>();
    const overlapping = new Map<string, string[]>();
    for (const o of others) {
      const personId = String(o.person_id);
      const otherStart = String(o.starts_at);
      if (dayKeyOf(otherStart) === serviceDate) {
        sameDay.set(personId, [...(sameDay.get(personId) ?? []), String(o.position_name)]);
      }
      // Another position on THIS service is a same-day note, not an overlap with itself.
      if (String(o.event_id) === input.eventId) continue;
      const otherWindow = overlapWindow(otherStart, o.ends_at === null ? null : String(o.ends_at));
      if (windowsOverlap(thisWindow, otherWindow)) {
        overlapping.set(personId, [...(overlapping.get(personId) ?? []), String(o.title)]);
      }
    }

    const candidates: PickerCandidate[] = roster.map((r) => {
      const personId = String(r.person_id);
      const assessment = pickerWarnings(
        {
          blockedOut: r.blocked === true,
          sameDayPositions: sameDay.get(personId) ?? [],
          overlappingServices: overlapping.get(personId) ?? [],
          declinedThisService: r.declined_this === true,
          mayBeUnder18: r.minor === true,
          qualified: r.qualified === true,
        },
        { serviceDate },
      );
      return {
        personId,
        displayName: displayName(r as { first_name: unknown; preferred_name: unknown; last_name: unknown }),
        ...assessment,
      };
    });
    const shown = input.showAll === true ? candidates : candidates.filter((c) => c.qualified);
    return ok([...shown.filter((c) => c.qualified), ...shown.filter((c) => !c.qualified)]);
  });
}

export interface SendPreview {
  /** Drafts a Send would move to requested. */
  assignments: number;
  /** People who would be asked. */
  people: number;
  services: number;
  emailed: number;
  guardian: number;
  noAddress: number;
  doNotContact: number;
  notEmailed: number;
  /** Drafts left behind because the person is no longer on the team. */
  notOnTeam: number;
  /** A Send would be refused for size (200 assignments or 52 services). */
  overCap: boolean;
  /** `platformOrigin()` is set: a Send can write its emails. */
  mailAvailable: boolean;
}

/**
 * `worship.schedule` or a live seat (scope cut to the teams the seat holder
 * leads). What a Send with this scope WOULD do, without writing: the SAME scope
 * resolution (`resolveSendFilter`), the SAME draft decision (`loadSendableDrafts`)
 * and the SAME per-person outcome (`decideReach`) `sendRequests` uses, so the
 * dialog's counts and the result of pressing Send cannot disagree.
 */
export function getSendPreview(
  viewer: WorshipViewer,
  input: { eventIds?: string[]; groupId?: string },
): Promise<WorshipResult<SendPreview>> {
  return runGated(viewer, ["schedule"], async (tx, has): Promise<WorshipResult<SendPreview>> => {
    const scope = await resolveSendFilter(tx, viewer, has, input);
    if (scope.kind !== "ok") return scope;
    const drafts = await loadSendableDrafts(tx, viewer.organizationId, scope.filter);
    const sendable = drafts.filter((d) => d.onTeam);
    const plan = sendPlan(sendable);
    const outcomes: NoticeOutcome[] = [];
    for (const person of plan.people) outcomes.push((await decideReach(tx, viewer.organizationId, person.personId)).outcome);
    const summary = summarizeSend(outcomes);
    return ok({
      assignments: plan.total,
      people: plan.people.length,
      services: plan.services,
      emailed: summary.emailed,
      guardian: summary.guardian,
      noAddress: summary.noAddress,
      doNotContact: summary.doNotContact,
      notEmailed: summary.notEmailed,
      notOnTeam: drafts.length - sendable.length,
      overCap: plan.overAssignmentCap || plan.overServiceCap,
      mailAvailable: platformOrigin() !== null,
    });
  });
}

// ---------------------------------------------------------------------------
// The Features page
// ---------------------------------------------------------------------------

// `countUpcomingScheduled(tx)` lives in `counts.ts` (a two-import file the Features page's
// off-warning registry can load without this module's weight) and is re-exported here, where
// the design lists it.
export { countUpcomingScheduled } from "./counts";
