import "server-only";
import { sql } from "drizzle-orm";
import { isUuidShaped } from "@/lib/shared/uuid";
import { loadWorshipContext, runGated, type WorshipContext, type WorshipViewer } from "./access";
import { holdsPermission } from "./authority";
import { forbidden, notFound, ok, type WorshipResult } from "./result";
import { displayName, likePattern, rowsOf } from "./sql-util";
import { LIMITS, type TeamKind } from "./vocab";

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
 * This file holds the CONFIGURATION reads (teams, positions, service types,
 * roster search). The scheduling reads (my schedule, the board, the picker, the
 * send preview) are appended in Batch 3.
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
