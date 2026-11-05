import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { isUuidShaped } from "@/lib/shared/uuid";
import { ledTeamIds } from "./authority";
import { forbidden, notFound, type WorshipFailure } from "./result";
import { rowsOf, uuidList } from "./sql-util";
import type { WorshipHas } from "./vocab";

/**
 * Which drafts a Send would take - docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 store export `sendRequests` and read `getSendPreview`. READ-ONLY: the
 * ONE decision shared by the preview (`reads.ts`) and the Send (`store.ts`), so
 * the dialog's counts and the result of pressing Send cannot disagree. It
 * writes nothing, so it is not on the writer allow-list.
 *
 * SCOPE. A holder of `worship.schedule` sends for every team, or for the one
 * `groupId` they name. A seat holder's scope is CUT to the teams they lead
 * (a chair or leader of team A has no reach into team B): the teams come from
 * the live seat function, and a `groupId` outside them is `forbidden`.
 *
 * WHAT IS A SENDABLE DRAFT. A `draft` person row on a service that is not
 * cancelled and has not started, on a team still serving it (not removed).
 * Each row carries `onTeam`: the person is on the team's roster NOW (in date),
 * unmerged, living, and still related to the organization. A draft whose person
 * left the team is NOT sent (the Send re-checks per person, and reports how many
 * it left behind).
 */

export interface SendFilter {
  /** `null`: every team. Otherwise only these team groups. */
  groupIds: string[] | null;
  /** `null`: every upcoming service. Otherwise only these events. */
  eventIds: string[] | null;
}

export async function resolveSendFilter(
  tx: OrgTx,
  viewer: { personId: string; organizationId: string },
  has: Partial<WorshipHas>,
  input: { eventIds?: string[]; groupId?: string },
): Promise<{ kind: "ok"; filter: SendFilter } | WorshipFailure> {
  if (input.groupId !== undefined && !isUuidShaped(input.groupId)) return notFound();
  if (input.eventIds !== undefined) {
    if (!Array.isArray(input.eventIds) || input.eventIds.some((id) => typeof id !== "string" || !isUuidShaped(id))) {
      return notFound();
    }
  }
  const eventIds = input.eventIds !== undefined ? [...new Set(input.eventIds)] : null;

  if (has.schedule === true) {
    return { kind: "ok", filter: { groupIds: input.groupId ? [input.groupId] : null, eventIds } };
  }
  const led = await ledTeamIds(tx, viewer);
  if (led.length === 0) return forbidden();
  if (input.groupId) {
    if (!led.includes(input.groupId)) return forbidden();
    return { kind: "ok", filter: { groupIds: [input.groupId], eventIds } };
  }
  return { kind: "ok", filter: { groupIds: led, eventIds } };
}

export interface DraftRow {
  assignmentId: string;
  eventId: string;
  groupId: string;
  personId: string;
  /** Wall-clock 'YYYY-MM-DDTHH:mm'. */
  startsAt: string;
  positionName: string;
  teamName: string;
  /** On the roster now, unmerged, living, relationship open. */
  onTeam: boolean;
}

/** The drafts a Send with this filter would consider, in service-then-position order. */
export async function loadSendableDrafts(tx: OrgTx, organizationId: string, filter: SendFilter): Promise<DraftRow[]> {
  if (filter.groupIds !== null && filter.groupIds.length === 0) return [];
  if (filter.eventIds !== null && filter.eventIds.length === 0) return [];
  const rows = rowsOf(
    await tx.execute(sql`
      select a.id::text as assignment_id, a.event_id::text as event_id, a.group_id::text as group_id,
             a.person_id::text as person_id,
             to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at,
             wp.name as position_name, g.name as team_name,
             exists (
               select 1
                 from group_memberships gm
                 join people pe on pe.id = gm.person_id
                 join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id
                where gm.organization_id = a.organization_id and gm.group_id = a.group_id and gm.person_id = a.person_id
                  and gm.starts_on <= presby_worship_org_today(a.organization_id)
                  and (gm.ends_on is null or gm.ends_on > presby_worship_org_today(a.organization_id))
                  and pe.merged_into_id is null and pe.date_of_death is null and m.ended_on is null
             ) as on_team
        from worship_assignments a
        join events e on e.id = a.event_id and e.organization_id = a.organization_id
        join worship_service_teams st
          on st.event_id = a.event_id and st.group_id = a.group_id and st.organization_id = a.organization_id
        join worship_positions wp on wp.id = a.position_id and wp.organization_id = a.organization_id
        join groups g on g.id = a.group_id and g.organization_id = a.organization_id
       where a.organization_id = ${organizationId}::uuid
         and a.status = 'draft' and a.person_id is not null
         and e.cancelled_at is null
         and e.starts_at > presby_worship_org_now(a.organization_id)
         and st.removed_at is null
         ${filter.groupIds ? sql`and a.group_id in (${uuidList(filter.groupIds)})` : sql``}
         ${filter.eventIds ? sql`and a.event_id in (${uuidList(filter.eventIds)})` : sql``}
       order by e.starts_at, e.id, wp.sort_order, wp.name, a.created_at, a.id
    `),
  );
  return rows.map((r) => ({
    assignmentId: String(r.assignment_id),
    eventId: String(r.event_id),
    groupId: String(r.group_id),
    personId: String(r.person_id),
    startsAt: String(r.starts_at),
    positionName: String(r.position_name),
    teamName: String(r.team_name),
    onTeam: r.on_team === true,
  }));
}
