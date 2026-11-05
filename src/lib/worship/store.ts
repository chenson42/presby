import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import type { OrgTx } from "@/lib/authz";
import { platformOrigin } from "@/lib/domains/host";
import { groupMemberships, groups, groupTypes } from "@/lib/db/domain/groups";
import {
  worshipAssignments,
  worshipPositionQualifications,
  worshipPositions,
  worshipServiceTypeTeams,
  worshipServiceTypes,
  worshipServices,
  worshipTeams,
} from "@/lib/db/domain/worship";
import { insertEventsInTx, type EventActor } from "@/lib/events/insert";
import { cancelEventInTx, updateEventFieldsInTx } from "@/lib/events/mutate";
import { isDayKey } from "@/lib/calendar/month";
import { formatWallClock, parseWallClock, WALL_CLOCK_RE } from "@/lib/events/wall-clock";
import {
  addManagedGroupMemberInTx,
  endManagedGroupMemberInTx,
  insertManagedGroupInTx,
  updateManagedGroupInTx,
} from "@/lib/groups";
import { isUuidShaped } from "@/lib/shared/uuid";
import { runGated, type WorshipViewer } from "./access";
import { canScheduleTeam, holdsPermission } from "./authority";
import { ACTION_COPY, GATE_COPY, MEMBER_COPY, SERVICES_COPY, TEAMS_COPY } from "./copy";
import { loadSendableDrafts, resolveSendFilter } from "./drafts";
import { validateGuestName } from "./guest-name";
import { decideReach, queueDeclinedNotice, queueRequestNotices } from "./notify";
import { mergeBlockoutRanges, sendPlan, validateBlockoutRange, type BlockoutRange } from "./plan";
import {
  conflict,
  forbidden,
  invalid,
  mapDatabaseError,
  notFound,
  ok,
  type WorshipFailure,
  type WorshipResult,
} from "./result";
import { isStarterKey, startersFor, type StarterKey } from "./starters";
import { inEffectDay, orgName, orgToday, rowsOf, uuidList } from "./sql-util";
import {
  ANSWERS,
  LIMITS,
  SERVICE_PATTERNS,
  TEAM_KINDS,
  isReason,
  statusForAnswer,
  type Answer,
  type NoticeOutcome,
  type Reason,
  type ServicePattern,
  type TeamKind,
} from "./vocab";

/**
 * THE WRITER of every `worship_*` table (with `event-hooks.ts`, the only other
 * writer: the allow-list is exactly these two files, architect addendum C1) -
 * docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "Store exports".
 *
 * ONE `withOrgContext` TRANSACTION PER EXPORT, through `runGated` in
 * `access.ts`: the org-type applicability check, then the toggle (with the
 * category axis), then the named keys, all inside the transaction the write
 * runs in. A server action is a public entry point, so every export repeats
 * the gate; the page's gate is a courtesy. Audit rows are written in the SAME
 * transaction as the change they record (`insertAuditRow`, never
 * `recordAudit()`), so a change and its record commit or roll back together.
 *
 * Every export returns a `WorshipResult`. A guard refusal from the database
 * (migration 0085 section 7, CONSTRAINT codes `worship_guard_*`) is mapped to
 * a result by `mapDatabaseError` after the transaction has rolled back; an
 * error that is not ours is rethrown.
 *
 * AUTHORITY. `worship.manage` (teams, positions, qualifications, rosters,
 * service types), `worship.plan` (services), and `worship.schedule` OR a live
 * chair/leader seat on that team's own group (people). Appointing a chair or
 * leader is NOT here: that stays under `groups.manage` (R6).
 *
 * Roster writes go ONLY through the `groups.ts` in-transaction primitives, with
 * the `member` role only, and are refused when the group carries a live role
 * grant (a roster that confers a role is `groups.manage`'s to change).
 *
 * No `getPlatformDb()` here (`sweep.ts` is the only user). No raw write to
 * `group_memberships` or `events`.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Runs a gated export and turns a database refusal into its result. */
async function guarded<T>(
  viewer: WorshipViewer,
  names: Parameters<typeof runGated>[1],
  fn: (tx: OrgTx, has: Parameters<Parameters<typeof runGated>[2]>[1]) => Promise<WorshipResult<T>>,
): Promise<WorshipResult<T>> {
  try {
    return (await runGated(viewer, names, fn)) as WorshipResult<T>;
  } catch (err) {
    const mapped = mapDatabaseError(err);
    if (mapped) return mapped;
    throw err;
  }
}

interface TeamRow {
  groupId: string;
  name: string;
  retired: boolean;
  kind: string;
}

async function loadTeam(tx: OrgTx, organizationId: string, groupId: string): Promise<TeamRow | null> {
  const rows = rowsOf(
    await tx.execute(sql`
      select wt.group_id::text as group_id, g.name, (wt.retired_at is not null) as retired, gt.key as kind
        from worship_teams wt
        join groups g on g.id = wt.group_id and g.organization_id = wt.organization_id
        join group_types gt on gt.id = g.group_type_id
       where wt.organization_id = ${organizationId}::uuid and wt.group_id = ${groupId}::uuid
    `),
  );
  const r = rows[0];
  if (!r) return null;
  return { groupId: String(r.group_id), name: String(r.name), retired: r.retired === true, kind: String(r.kind) };
}

interface PositionRow {
  id: string;
  groupId: string;
  name: string;
  retired: boolean;
}

async function loadPosition(tx: OrgTx, organizationId: string, positionId: string): Promise<PositionRow | null> {
  const [r] = await tx
    .select({
      id: worshipPositions.id,
      groupId: worshipPositions.groupId,
      name: worshipPositions.name,
      retiredAt: worshipPositions.retiredAt,
    })
    .from(worshipPositions)
    .where(and(eq(worshipPositions.id, positionId), eq(worshipPositions.organizationId, organizationId)))
    .limit(1);
  if (!r) return null;
  return { id: r.id, groupId: r.groupId, name: r.name, retired: r.retiredAt !== null };
}

/**
 * Upcoming (not started), uncancelled services with a live (draft, requested
 * or confirmed) assignment, for a team or for one position of it. The same
 * count `retireTeam` and `retirePosition` refuse on and Copy G2 quotes ("{n}
 * upcoming services").
 */
async function upcomingUseCount(
  tx: OrgTx,
  organizationId: string,
  scope: { groupId: string; positionId?: string },
): Promise<number> {
  const rows = rowsOf(
    await tx.execute(sql`
      select count(distinct a.event_id)::int as n
        from worship_assignments a
        join events e on e.id = a.event_id and e.organization_id = a.organization_id
       where a.organization_id = ${organizationId}::uuid
         and a.group_id = ${scope.groupId}::uuid
         ${scope.positionId ? sql`and a.position_id = ${scope.positionId}::uuid` : sql``}
         and a.status in ('draft', 'requested', 'confirmed')
         and e.cancelled_at is null
         and e.starts_at > presby_worship_org_now(${organizationId}::uuid)
    `),
  );
  return Number(rows[0]?.n ?? 0);
}

/** True when the group carries a live (in date) role grant: a roster that confers a role (R6). */
async function groupIsRoleBound(tx: OrgTx, organizationId: string, groupId: string): Promise<boolean> {
  const rows = rowsOf(
    await tx.execute(sql`
      select exists (
        select 1 from role_grants rg
         where rg.organization_id = ${organizationId}::uuid
           and rg.group_id = ${groupId}::uuid
           and rg.starts_on <= presby_worship_in_effect_day(${organizationId}::uuid)
           and (rg.ends_on is null or rg.ends_on > presby_worship_in_effect_day(${organizationId}::uuid))
      ) as bound
    `),
  );
  return rows[0]?.bound === true;
}

/**
 * INSERTS ARE RAW SQL, ON PURPOSE. `presby_app` holds COLUMN-LIMITED INSERT
 * grants on every worship table (migration 0085 section 8: no `id`, no
 * `created_at`, no `retired_at`), and Drizzle's `insert().values()` names EVERY
 * column of the table (with the `default` keyword for the ones you omit), which
 * Postgres refuses as a privilege error before any default applies. Each
 * statement below lists exactly the granted columns. UPDATEs are unaffected:
 * `.set()` names only what it sets.
 */
async function insertTeamRow(tx: OrgTx, organizationId: string, groupId: string, createdBy: string): Promise<void> {
  await tx.execute(sql`
    insert into worship_teams (group_id, organization_id, created_by)
    values (${groupId}::uuid, ${organizationId}::uuid, ${createdBy}::uuid)
  `);
}

async function insertPositionRow(
  tx: OrgTx,
  organizationId: string,
  input: { groupId: string; name: string; slots: number; sortOrder: number; createdBy: string },
): Promise<string> {
  const row = rowsOf(
    await tx.execute(sql`
      insert into worship_positions (organization_id, group_id, name, slots, sort_order, created_by)
      values (${organizationId}::uuid, ${input.groupId}::uuid, ${input.name}, ${input.slots}, ${input.sortOrder}, ${input.createdBy}::uuid)
      returning id::text as id
    `),
  )[0]!;
  return String(row.id);
}

function cleanName(value: unknown, max: number, tooLong: string): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: false, message: TEAMS_COPY.validation.nameRequired };
  const name = value.trim();
  if (name.length === 0) return { ok: false, message: TEAMS_COPY.validation.nameRequired };
  if ([...name].length > max) return { ok: false, message: tooLong };
  if (/\p{Cc}/u.test(name)) return { ok: false, message: TEAMS_COPY.validation.nameRequired };
  return { ok: true, name };
}

function slotsValid(slots: unknown): slots is number {
  return typeof slots === "number" && Number.isInteger(slots) && slots >= LIMITS.slotsMin && slots <= LIMITS.slotsMax;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export interface CreateTeamInput {
  name: string;
  kind: TeamKind;
  description?: string;
  starter?: StarterKey;
}

/** `worship.manage`. Creates a managed `team` or `choir` group, makes it a worship team, and adds the starter positions. */
export function createTeam(
  viewer: WorshipViewer,
  input: CreateTeamInput,
): Promise<WorshipResult<{ groupId: string; positionIds: string[] }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();

    const name = cleanName(input.name, LIMITS.teamName, TEAMS_COPY.validation.nameTooLong);
    if (!name.ok) return invalid(name.message);
    if (!(TEAM_KINDS as readonly string[]).includes(input.kind)) return invalid(ACTION_COPY.generic);
    if (input.starter !== undefined && !isStarterKey(input.starter)) return invalid(ACTION_COPY.generic);
    const description = typeof input.description === "string" ? input.description.trim().slice(0, LIMITS.teamDescription) : "";

    const [type] = await tx.select({ id: groupTypes.id }).from(groupTypes).where(eq(groupTypes.key, input.kind)).limit(1);
    if (!type) return invalid(ACTION_COPY.generic);

    const created = await insertManagedGroupInTx(tx, viewer.organizationId, {
      groupTypeId: type.id,
      name: name.name,
      description: description || undefined,
    });
    if (created.kind !== "ok") return invalid(created.kind === "invalid_input" ? created.message : ACTION_COPY.generic);
    const groupId = created.data.groupId;

    await insertTeamRow(tx, viewer.organizationId, groupId, viewer.userId);

    const positionIds: string[] = [];
    const starters = startersFor(input.starter);
    for (const [index, position] of starters.entries()) {
      positionIds.push(
        await insertPositionRow(tx, viewer.organizationId, {
          groupId,
          name: position.name,
          slots: position.slots,
          sortOrder: index,
          createdBy: viewer.userId,
        }),
      );
    }

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.WORSHIP_TEAM_CREATED,
      actor: { userId: viewer.userId, email: viewer.email },
      resourceType: "worship_team",
      resourceId: groupId,
      metadata: { via: "new", groupId },
    });
    return ok({ groupId, positionIds });
  });
}

/**
 * `worship.manage` AND `groups.manage`. Makes an existing managed `choir` or
 * `team` group a worship team. Refused for a derived group, the `court` and
 * `roster` types, and a group that is already a team.
 */
export function adoptTeam(viewer: WorshipViewer, input: { groupId: string }): Promise<WorshipResult<{ groupId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!(await holdsPermission(tx, viewer, "groups.manage"))) return forbidden();
    if (!isUuidShaped(input.groupId)) return notFound();

    const rows = rowsOf(
      await tx.execute(sql`
        select g.id::text as id, g.membership_source, gt.key as kind,
               exists (select 1 from worship_teams wt where wt.group_id = g.id and wt.organization_id = g.organization_id) as is_team
          from groups g
          join group_types gt on gt.id = g.group_type_id
         where g.id = ${input.groupId}::uuid and g.organization_id = ${viewer.organizationId}::uuid
      `),
    );
    const group = rows[0];
    if (!group) return notFound();
    if (group.membership_source !== "managed" || !["choir", "team"].includes(String(group.kind)) || group.is_team === true) {
      return invalid(ACTION_COPY.generic);
    }

    await insertTeamRow(tx, viewer.organizationId, input.groupId, viewer.userId);
    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.WORSHIP_TEAM_CREATED,
      actor: { userId: viewer.userId, email: viewer.email },
      resourceType: "worship_team",
      resourceId: input.groupId,
      metadata: { via: "existing", groupId: input.groupId },
    });
    return ok({ groupId: input.groupId });
  });
}

/** `worship.manage`. Renames a team (its group) and sets its description. Configuration: unaudited. */
export function updateTeam(
  viewer: WorshipViewer,
  input: { groupId: string; name: string; description?: string },
): Promise<WorshipResult<{ groupId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.groupId)) return notFound();
    const team = await loadTeam(tx, viewer.organizationId, input.groupId);
    if (!team) return notFound();

    const name = cleanName(input.name, LIMITS.teamName, TEAMS_COPY.validation.nameTooLong);
    if (!name.ok) return invalid(name.message);
    const description = typeof input.description === "string" ? input.description.trim().slice(0, LIMITS.teamDescription) : "";

    // `updateManagedGroupInTx` sets meets_when from its input; keep the group's own.
    const [current] = await tx
      .select({ meetsWhen: groups.meetsWhen })
      .from(groups)
      .where(and(eq(groups.id, input.groupId), eq(groups.organizationId, viewer.organizationId)))
      .limit(1);
    const updated = await updateManagedGroupInTx(tx, viewer.organizationId, {
      groupId: input.groupId,
      name: name.name,
      description: description || undefined,
      meetsWhen: current?.meetsWhen ?? undefined,
    });
    if (updated.kind === "invalid_target") return notFound();
    if (updated.kind !== "ok") return invalid(updated.kind === "invalid_input" ? updated.message : ACTION_COPY.generic);
    return ok({ groupId: input.groupId });
  });
}

/**
 * `worship.manage`. Sets `retired_at`. Refused (`in_use`, with the number of
 * upcoming services) while any draft, requested or confirmed assignment exists
 * on an upcoming, uncancelled service. Retiring a retired team is a no-op.
 */
export function retireTeam(
  viewer: WorshipViewer,
  input: { groupId: string },
): Promise<WorshipResult<{ groupId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.groupId)) return notFound();
    const team = await loadTeam(tx, viewer.organizationId, input.groupId);
    if (!team) return notFound();
    if (team.retired) return ok({ groupId: input.groupId });

    const inUse = await upcomingUseCount(tx, viewer.organizationId, { groupId: input.groupId });
    if (inUse > 0) return conflict("in_use", ACTION_COPY.inUse(team.name, inUse));

    await tx
      .update(worshipTeams)
      .set({ retiredAt: new Date() })
      .where(and(eq(worshipTeams.groupId, input.groupId), eq(worshipTeams.organizationId, viewer.organizationId)));
    return ok({ groupId: input.groupId });
  });
}

// ---------------------------------------------------------------------------
// Positions and qualifications
// ---------------------------------------------------------------------------

/** `worship.manage`. Name `btrim`'d 1 to 60, unique among live positions of the team (case-insensitive); slots 1 to 20; at most 40 live positions. */
export function addPosition(
  viewer: WorshipViewer,
  input: { groupId: string; name: string; slots: number },
): Promise<WorshipResult<{ positionId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.groupId)) return notFound();
    const team = await loadTeam(tx, viewer.organizationId, input.groupId);
    if (!team) return notFound();
    if (team.retired) return conflict("not_open", ACTION_COPY.teamRetired(team.name));

    const name = cleanName(input.name, LIMITS.positionName, TEAMS_COPY.validation.positionNameTooLong);
    if (!name.ok) return invalid(name.message);
    if (!slotsValid(input.slots)) return invalid(TEAMS_COPY.validation.slotsRange);

    // Serialize adds to one team so the cap and the duplicate check cannot both pass for two requests.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`worship_positions:${viewer.organizationId}:${input.groupId}`}, 0))`,
    );
    const stats = rowsOf(
      await tx.execute(sql`
        select count(*)::int as live,
               coalesce(max(sort_order), -1) + 1 as next_sort,
               bool_or(lower(name) = lower(${name.name})) as duplicate
          from worship_positions
         where organization_id = ${viewer.organizationId}::uuid
           and group_id = ${input.groupId}::uuid and retired_at is null
      `),
    )[0]!;
    if (stats.duplicate === true) {
      return conflict("duplicate_name", TEAMS_COPY.validation.positionDuplicate(name.name));
    }
    if (Number(stats.live) >= LIMITS.positionsPerTeam) {
      return conflict("over_cap", TEAMS_COPY.validation.positionLimit);
    }

    const positionId = await insertPositionRow(tx, viewer.organizationId, {
      groupId: input.groupId,
      name: name.name,
      slots: input.slots,
      sortOrder: Number(stats.next_sort),
      createdBy: viewer.userId,
    });
    return ok({ positionId });
  });
}

/** `worship.manage`. Renames a live position or changes its slot count. Lowering slots below the people already placed leaves them placed. */
export function updatePosition(
  viewer: WorshipViewer,
  input: { positionId: string; name: string; slots: number },
): Promise<WorshipResult<{ positionId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.positionId)) return notFound();
    const position = await loadPosition(tx, viewer.organizationId, input.positionId);
    if (!position) return notFound();
    if (position.retired) return conflict("not_open", ACTION_COPY.stale);

    const name = cleanName(input.name, LIMITS.positionName, TEAMS_COPY.validation.positionNameTooLong);
    if (!name.ok) return invalid(name.message);
    if (!slotsValid(input.slots)) return invalid(TEAMS_COPY.validation.slotsRange);

    const duplicate = rowsOf(
      await tx.execute(sql`
        select 1 from worship_positions
         where organization_id = ${viewer.organizationId}::uuid and group_id = ${position.groupId}::uuid
           and retired_at is null and id <> ${position.id}::uuid and lower(name) = lower(${name.name})
      `),
    );
    if (duplicate.length > 0) return conflict("duplicate_name", TEAMS_COPY.validation.positionDuplicate(name.name));

    await tx
      .update(worshipPositions)
      .set({ name: name.name, slots: input.slots })
      .where(and(eq(worshipPositions.id, position.id), eq(worshipPositions.organizationId, viewer.organizationId)));
    return ok({ positionId: position.id });
  });
}

/** `worship.manage`. Sets `retired_at`; refused (`in_use`) while anyone is live in it on an upcoming service. A retired position is a no-op. */
export function retirePosition(
  viewer: WorshipViewer,
  input: { positionId: string },
): Promise<WorshipResult<{ positionId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.positionId)) return notFound();
    const position = await loadPosition(tx, viewer.organizationId, input.positionId);
    if (!position) return notFound();
    if (position.retired) return ok({ positionId: position.id });

    const inUse = await upcomingUseCount(tx, viewer.organizationId, {
      groupId: position.groupId,
      positionId: position.id,
    });
    if (inUse > 0) return conflict("in_use", ACTION_COPY.inUse(position.name, inUse));

    await tx
      .update(worshipPositions)
      .set({ retiredAt: new Date() })
      .where(and(eq(worshipPositions.id, position.id), eq(worshipPositions.organizationId, viewer.organizationId)));
    return ok({ positionId: position.id });
  });
}

/**
 * `worship.manage`. Replace-set: ends the person's live qualifications that
 * are not in `positionIds` (`ended_at`), inserts the new ones. The person must
 * be on the team's roster now; every position must be a live position of this
 * team.
 */
export function setQualifications(
  viewer: WorshipViewer,
  input: { groupId: string; personId: string; positionIds: string[] },
): Promise<WorshipResult<{ added: number; ended: number }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.groupId) || !isUuidShaped(input.personId)) return notFound();
    if (!Array.isArray(input.positionIds) || input.positionIds.some((id) => typeof id !== "string" || !isUuidShaped(id))) {
      return invalid(ACTION_COPY.generic);
    }
    const wanted = [...new Set(input.positionIds)];
    if (wanted.length > LIMITS.positionsPerTeam) return invalid(ACTION_COPY.generic);

    const team = await loadTeam(tx, viewer.organizationId, input.groupId);
    if (!team) return notFound();

    const person = rowsOf(
      await tx.execute(sql`
        select p.first_name, p.preferred_name, p.last_name,
               exists (
                 select 1 from group_memberships gm
                  where gm.organization_id = ${viewer.organizationId}::uuid and gm.group_id = ${input.groupId}::uuid
                    and gm.person_id = ${input.personId}::uuid
                    and gm.starts_on <= presby_worship_in_effect_day(${viewer.organizationId}::uuid)
                    and (gm.ends_on is null or gm.ends_on > presby_worship_in_effect_day(${viewer.organizationId}::uuid))
               ) as on_roster
          from people p
          join memberships m on m.person_id = p.id and m.organization_id = ${viewer.organizationId}::uuid
         where p.id = ${input.personId}::uuid
      `),
    )[0];
    if (!person) return notFound();
    if (person.on_roster !== true) {
      const name = `${String(person.preferred_name ?? person.first_name)} ${String(person.last_name)}`;
      return conflict("not_open", ACTION_COPY.notOnTeam(name));
    }

    const live = await tx
      .select({ id: worshipPositions.id })
      .from(worshipPositions)
      .where(
        and(
          eq(worshipPositions.organizationId, viewer.organizationId),
          eq(worshipPositions.groupId, input.groupId),
          isNull(worshipPositions.retiredAt),
        ),
      );
    const liveIds = new Set(live.map((p) => p.id));
    if (wanted.some((id) => !liveIds.has(id))) return invalid(ACTION_COPY.stale);

    const existing = await tx
      .select({ id: worshipPositionQualifications.id, positionId: worshipPositionQualifications.positionId })
      .from(worshipPositionQualifications)
      .where(
        and(
          eq(worshipPositionQualifications.organizationId, viewer.organizationId),
          eq(worshipPositionQualifications.groupId, input.groupId),
          eq(worshipPositionQualifications.personId, input.personId),
          isNull(worshipPositionQualifications.endedAt),
        ),
      );
    const have = new Set(existing.map((q) => q.positionId));
    const toEnd = existing.filter((q) => !wanted.includes(q.positionId));
    const toAdd = wanted.filter((id) => !have.has(id));

    for (const q of toEnd) {
      await tx
        .update(worshipPositionQualifications)
        .set({ endedAt: new Date() })
        .where(and(eq(worshipPositionQualifications.id, q.id), eq(worshipPositionQualifications.organizationId, viewer.organizationId)));
    }
    for (const positionId of toAdd) {
      await tx.execute(sql`
        insert into worship_position_qualifications (organization_id, group_id, position_id, person_id, created_by)
        values (${viewer.organizationId}::uuid, ${input.groupId}::uuid, ${positionId}::uuid, ${input.personId}::uuid, ${viewer.userId}::uuid)
      `);
    }
    return ok({ added: toAdd.length, ended: toEnd.length });
  });
}

// ---------------------------------------------------------------------------
// Roster (member rows only, through the groups.ts primitives)
// ---------------------------------------------------------------------------

/**
 * `worship.manage`. Adds a `member` row to the team's group, starting on the
 * organization's today. Refused (`role_bound`) when the group carries a live
 * role grant. A person already on the roster is a no-op (no write, no audit).
 */
export function addTeamMember(
  viewer: WorshipViewer,
  input: { groupId: string; personId: string },
): Promise<WorshipResult<{ changed: boolean }>> {
  return guarded<{ changed: boolean }>(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.groupId) || !isUuidShaped(input.personId)) return notFound();
    const team = await loadTeam(tx, viewer.organizationId, input.groupId);
    if (!team) return notFound();
    if (team.retired) return conflict("not_open", ACTION_COPY.teamRetired(team.name));
    if (await groupIsRoleBound(tx, viewer.organizationId, input.groupId)) {
      return conflict("role_bound", ACTION_COPY.roleBound);
    }

    const result = await addManagedGroupMemberInTx(tx, viewer.organizationId, {
      groupId: input.groupId,
      personId: input.personId,
      startsOn: await orgToday(tx, viewer.organizationId),
    });
    if (result.kind === "overlap") return ok({ changed: false });
    if (result.kind === "invalid_target") {
      return invalid(TEAMS_COPY.validation.notOnRoll(await orgName(tx, viewer.organizationId)));
    }
    if (result.kind !== "ok") return invalid(result.kind === "invalid_input" ? result.message : ACTION_COPY.generic);

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.WORSHIP_ROSTER_CHANGED,
      actor: { userId: viewer.userId, email: viewer.email },
      resourceType: "worship_team",
      resourceId: input.groupId,
      metadata: { change: "added", groupId: input.groupId, personId: input.personId },
    });
    return ok({ changed: true });
  });
}

/**
 * `worship.manage`. Ends a `member` row (end-dated to the organization's
 * today, never deleted). Ending a `chair` or `leader` row is refused
 * (`invalid_input`: those are changed under Groups). Refused (`role_bound`)
 * when the group carries a live role grant.
 */
export function endTeamMember(
  viewer: WorshipViewer,
  input: { groupId: string; groupMembershipId: string },
): Promise<WorshipResult<{ changed: boolean }>> {
  return guarded<{ changed: boolean }>(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.groupId) || !isUuidShaped(input.groupMembershipId)) return notFound();
    const team = await loadTeam(tx, viewer.organizationId, input.groupId);
    if (!team) return notFound();

    const [row] = await tx
      .select({
        id: groupMemberships.id,
        personId: groupMemberships.personId,
        role: groupMemberships.groupRole,
        endsOn: groupMemberships.endsOn,
      })
      .from(groupMemberships)
      .where(
        and(
          eq(groupMemberships.id, input.groupMembershipId),
          eq(groupMemberships.groupId, input.groupId),
          eq(groupMemberships.organizationId, viewer.organizationId),
        ),
      )
      .limit(1);
    if (!row) return notFound();
    if (row.role !== "member") return invalid(TEAMS_COPY.validation.seatsUnderGroups);
    if (await groupIsRoleBound(tx, viewer.organizationId, input.groupId)) {
      return conflict("role_bound", ACTION_COPY.roleBound);
    }

    // The in-effect day (F434): the row's dates may have been stamped on either
    // clock, and an end date earlier than its start is refused by the primitive.
    const today = await inEffectDay(tx, viewer.organizationId);
    if (row.endsOn !== null && row.endsOn <= today) return ok({ changed: false });

    const result = await endManagedGroupMemberInTx(tx, viewer.organizationId, {
      groupMembershipId: row.id,
      endsOn: today,
    });
    if (result.kind === "invalid_target") return notFound();
    if (result.kind !== "ok") return invalid(result.kind === "invalid_input" ? result.message : ACTION_COPY.generic);

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.WORSHIP_ROSTER_CHANGED,
      actor: { userId: viewer.userId, email: viewer.email },
      resourceType: "worship_team",
      resourceId: input.groupId,
      metadata: { change: "ended", groupId: input.groupId, personId: row.personId },
    });
    return ok({ changed: true });
  });
}

// ---------------------------------------------------------------------------
// Service types
// ---------------------------------------------------------------------------

export interface ServiceTypeInput {
  name: string;
  /** 'HH:MM' (24-hour). */
  startTime: string;
  durationMinutes?: number | null;
  location?: string | null;
  /** The teams that usually serve. Live, non-retired worship teams only. */
  groupIds?: string[];
}

const START_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

type ValidTypeFields = {
  name: string;
  startTime: string;
  durationMinutes: number | null;
  location: string | null;
};

function validateServiceTypeFields(input: ServiceTypeInput): { ok: true; value: ValidTypeFields } | { ok: false; message: string } {
  const name = cleanName(input.name, LIMITS.serviceTypeName, TEAMS_COPY.validation.nameTooLong);
  if (!name.ok) return { ok: false, message: name.message };
  if (typeof input.startTime !== "string" || !START_TIME_RE.test(input.startTime)) {
    return { ok: false, message: ACTION_COPY.generic };
  }
  let durationMinutes: number | null = null;
  if (input.durationMinutes !== undefined && input.durationMinutes !== null) {
    const d = input.durationMinutes;
    if (!Number.isInteger(d) || d < LIMITS.durationMin || d > LIMITS.durationMax) {
      return { ok: false, message: ACTION_COPY.generic };
    }
    durationMinutes = d;
  }
  let location: string | null = null;
  if (typeof input.location === "string" && input.location.trim() !== "") {
    location = input.location.trim();
    if ([...location].length > LIMITS.serviceTypeLocation) return { ok: false, message: ACTION_COPY.generic };
  }
  return { ok: true, value: { name: name.name, startTime: `${input.startTime}:00`, durationMinutes, location } };
}

/** Every id must be a live (non-retired) worship team of this organization. */
async function liveTeamIdsOrNull(tx: OrgTx, organizationId: string, ids: readonly string[]): Promise<string[] | null> {
  const unique = [...new Set(ids)];
  if (unique.some((id) => typeof id !== "string" || !isUuidShaped(id))) return null;
  if (unique.length === 0) return [];
  const rows = await tx
    .select({ groupId: worshipTeams.groupId })
    .from(worshipTeams)
    .where(and(eq(worshipTeams.organizationId, organizationId), isNull(worshipTeams.retiredAt)));
  const live = new Set(rows.map((r) => r.groupId));
  return unique.every((id) => live.has(id)) ? unique : null;
}

async function applyServiceTypeTeams(
  tx: OrgTx,
  organizationId: string,
  serviceTypeId: string,
  wanted: readonly string[],
): Promise<void> {
  const existing = await tx
    .select({ groupId: worshipServiceTypeTeams.groupId, removedAt: worshipServiceTypeTeams.removedAt })
    .from(worshipServiceTypeTeams)
    .where(
      and(
        eq(worshipServiceTypeTeams.organizationId, organizationId),
        eq(worshipServiceTypeTeams.serviceTypeId, serviceTypeId),
      ),
    );
  const byGroup = new Map(existing.map((r) => [r.groupId, r.removedAt]));
  for (const row of existing) {
    if (row.removedAt === null && !wanted.includes(row.groupId)) {
      await tx
        .update(worshipServiceTypeTeams)
        .set({ removedAt: new Date() })
        .where(
          and(
            eq(worshipServiceTypeTeams.serviceTypeId, serviceTypeId),
            eq(worshipServiceTypeTeams.groupId, row.groupId),
            eq(worshipServiceTypeTeams.organizationId, organizationId),
          ),
        );
    }
  }
  for (const groupId of wanted) {
    if (!byGroup.has(groupId)) {
      await tx.execute(sql`
        insert into worship_service_type_teams (organization_id, service_type_id, group_id)
        values (${organizationId}::uuid, ${serviceTypeId}::uuid, ${groupId}::uuid)
      `);
    } else if (byGroup.get(groupId) !== null) {
      await tx
        .update(worshipServiceTypeTeams)
        .set({ removedAt: null })
        .where(
          and(
            eq(worshipServiceTypeTeams.serviceTypeId, serviceTypeId),
            eq(worshipServiceTypeTeams.groupId, groupId),
            eq(worshipServiceTypeTeams.organizationId, organizationId),
          ),
        );
    }
  }
}

async function typeNameTaken(tx: OrgTx, organizationId: string, name: string, exceptId?: string): Promise<boolean> {
  const rows = rowsOf(
    await tx.execute(sql`
      select 1 from worship_service_types
       where organization_id = ${organizationId}::uuid and retired_at is null
         and lower(name) = lower(${name})
         ${exceptId ? sql`and id <> ${exceptId}::uuid` : sql``}
    `),
  );
  return rows.length > 0;
}

/** `worship.manage`. Saves a kind of service: name (unique among live), start time, optional length and place, default teams. */
export function createServiceType(
  viewer: WorshipViewer,
  input: ServiceTypeInput,
): Promise<WorshipResult<{ serviceTypeId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    const fields = validateServiceTypeFields(input);
    if (!fields.ok) return invalid(fields.message);
    const teams = await liveTeamIdsOrNull(tx, viewer.organizationId, input.groupIds ?? []);
    if (teams === null) return invalid(ACTION_COPY.stale);
    if (await typeNameTaken(tx, viewer.organizationId, fields.value.name)) {
      return conflict("duplicate_name", SERVICES_COPY.types.duplicate(fields.value.name));
    }

    const row = rowsOf(
      await tx.execute(sql`
        insert into worship_service_types (organization_id, name, start_time, duration_minutes, location, created_by)
        values (${viewer.organizationId}::uuid, ${fields.value.name}, ${fields.value.startTime}::time,
                ${fields.value.durationMinutes}, ${fields.value.location}, ${viewer.userId}::uuid)
        returning id::text as id
      `),
    )[0]!;
    const serviceTypeId = String(row.id);
    await applyServiceTypeTeams(tx, viewer.organizationId, serviceTypeId, teams);
    return ok({ serviceTypeId });
  });
}

/** `worship.manage`. Edits a live type; `groupIds`, when given, replaces its default teams in the same transaction. */
export function updateServiceType(
  viewer: WorshipViewer,
  input: ServiceTypeInput & { serviceTypeId: string },
): Promise<WorshipResult<{ serviceTypeId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.serviceTypeId)) return notFound();
    const [existing] = await tx
      .select({ id: worshipServiceTypes.id, retiredAt: worshipServiceTypes.retiredAt })
      .from(worshipServiceTypes)
      .where(and(eq(worshipServiceTypes.id, input.serviceTypeId), eq(worshipServiceTypes.organizationId, viewer.organizationId)))
      .limit(1);
    if (!existing) return notFound();
    if (existing.retiredAt !== null) return conflict("not_open", ACTION_COPY.stale);

    const fields = validateServiceTypeFields(input);
    if (!fields.ok) return invalid(fields.message);
    let teams: string[] | null = null;
    if (input.groupIds !== undefined) {
      teams = await liveTeamIdsOrNull(tx, viewer.organizationId, input.groupIds);
      if (teams === null) return invalid(ACTION_COPY.stale);
    }
    if (await typeNameTaken(tx, viewer.organizationId, fields.value.name, existing.id)) {
      return conflict("duplicate_name", SERVICES_COPY.types.duplicate(fields.value.name));
    }

    await tx
      .update(worshipServiceTypes)
      .set(fields.value)
      .where(and(eq(worshipServiceTypes.id, existing.id), eq(worshipServiceTypes.organizationId, viewer.organizationId)));
    if (teams !== null) await applyServiceTypeTeams(tx, viewer.organizationId, existing.id, teams);
    return ok({ serviceTypeId: existing.id });
  });
}

/** `worship.manage`. Sets `retired_at`. Services already added from it stay as they are. A retired type is a no-op. */
export function retireServiceType(
  viewer: WorshipViewer,
  input: { serviceTypeId: string },
): Promise<WorshipResult<{ serviceTypeId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.serviceTypeId)) return notFound();
    const [existing] = await tx
      .select({ id: worshipServiceTypes.id, retiredAt: worshipServiceTypes.retiredAt })
      .from(worshipServiceTypes)
      .where(and(eq(worshipServiceTypes.id, input.serviceTypeId), eq(worshipServiceTypes.organizationId, viewer.organizationId)))
      .limit(1);
    if (!existing) return notFound();
    if (existing.retiredAt !== null) return ok({ serviceTypeId: existing.id });
    await tx
      .update(worshipServiceTypes)
      .set({ retiredAt: new Date() })
      .where(and(eq(worshipServiceTypes.id, existing.id), eq(worshipServiceTypes.organizationId, viewer.organizationId)));
    return ok({ serviceTypeId: existing.id });
  });
}

/** `worship.manage`. Replaces a live type's default teams (live, non-retired teams only). */
export function setServiceTypeTeams(
  viewer: WorshipViewer,
  input: { serviceTypeId: string; groupIds: string[] },
): Promise<WorshipResult<{ serviceTypeId: string }>> {
  return guarded(viewer, ["manage"], async (tx, has) => {
    if (!has.manage) return forbidden();
    if (!isUuidShaped(input.serviceTypeId)) return notFound();
    const [existing] = await tx
      .select({ id: worshipServiceTypes.id, retiredAt: worshipServiceTypes.retiredAt })
      .from(worshipServiceTypes)
      .where(and(eq(worshipServiceTypes.id, input.serviceTypeId), eq(worshipServiceTypes.organizationId, viewer.organizationId)))
      .limit(1);
    if (!existing) return notFound();
    if (existing.retiredAt !== null) return conflict("not_open", ACTION_COPY.stale);
    const teams = await liveTeamIdsOrNull(tx, viewer.organizationId, input.groupIds);
    if (teams === null) return invalid(ACTION_COPY.stale);
    await applyServiceTypeTeams(tx, viewer.organizationId, existing.id, teams);
    return ok({ serviceTypeId: existing.id });
  });
}

// ===========================================================================
// SCHEDULING (Batch 3): services, placements, Send, answers, blockouts
// ===========================================================================

/** The audit/event actor for the shared event writers. */
function eventActor(viewer: WorshipViewer): EventActor {
  return { userId: viewer.userId, email: viewer.email };
}

interface ServiceRow {
  id: string;
  cancelled: boolean;
  started: boolean;
  /** Wall-clock 'YYYY-MM-DDTHH:mm'. */
  startsAt: string;
  location: string | null;
}

/**
 * THE JOIN-UNDER-LOCK (architect addendum C2). Locks the event row `FOR NO KEY
 * UPDATE` joined to its `worship_services` row in one statement: an event with
 * no `worship_services` row yields NO row, which every caller answers as
 * `not_found`, the same response as an unknown id. A `worship.plan` holder
 * therefore reaches only worship services through `events/mutate.ts` (which
 * checks no permission of its own), and a plain event is byte-unchanged and
 * triggers no hook.
 *
 * The same lock serializes a service edit, a cancel (from Manage events or from
 * the worship board), a Send and a placement on one row, taken first.
 */
async function lockService(tx: OrgTx, organizationId: string, eventId: string): Promise<ServiceRow | null> {
  const row = rowsOf(
    await tx.execute(sql`
      select e.id::text as id,
             (e.cancelled_at is not null) as cancelled,
             (e.starts_at <= presby_worship_org_now(e.organization_id)) as started,
             to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at,
             e.location
        from events e
        join worship_services ws on ws.event_id = e.id and ws.organization_id = e.organization_id
       where e.id = ${eventId}::uuid and e.organization_id = ${organizationId}::uuid
         for no key update of e
    `),
  )[0];
  if (!row) return null;
  return {
    id: String(row.id),
    cancelled: row.cancelled === true,
    started: row.started === true,
    startsAt: String(row.starts_at),
    location: row.location === null ? null : String(row.location),
  };
}

/**
 * 'YYYY-MM-DDTHH:mm[:ss]' that is a REAL date and time. `parseWallClock` only
 * checks the shape and `Date.UTC` rolls 2026-02-30 over to March 2, so an
 * impossible value must be refused here, not stored as a different day.
 */
function isRealWallClock(value: unknown): value is string {
  if (typeof value !== "string" || !WALL_CLOCK_RE.test(value)) return false;
  const [date = "", time = ""] = value.split("T");
  const [hour = 99, minute = 99, second = 0] = time.split(":").map(Number);
  return isDayKey(date) && hour < 24 && minute < 60 && second < 60;
}

function addMinutes(wallClock: string, minutes: number): string {
  return formatWallClock(new Date(parseWallClock(wallClock).getTime() + minutes * 60_000)).slice(0, 16);
}

/** The organization's active event type named "Worship" (case-insensitive), else null (the service is untyped). */
async function worshipEventTypeId(tx: OrgTx, organizationId: string): Promise<string | null> {
  const row = rowsOf(
    await tx.execute(sql`
      select id::text as id from event_types
       where organization_id = ${organizationId}::uuid and is_active and lower(name) = 'worship'
       limit 1
    `),
  )[0];
  return row ? String(row.id) : null;
}

async function loadLiveServiceType(
  tx: OrgTx,
  organizationId: string,
  serviceTypeId: string,
): Promise<{ id: string; name: string; startTime: string; durationMinutes: number | null; location: string | null; teamIds: string[] } | null> {
  const row = rowsOf(
    await tx.execute(sql`
      select t.id::text as id, t.name, to_char(t.start_time, 'HH24:MI') as start_time,
             t.duration_minutes::int as duration_minutes, t.location,
             coalesce((select array_agg(tt.group_id::text order by tt.group_id)
                         from worship_service_type_teams tt
                         join worship_teams wt on wt.group_id = tt.group_id and wt.organization_id = tt.organization_id
                        where tt.organization_id = t.organization_id and tt.service_type_id = t.id
                          and tt.removed_at is null and wt.retired_at is null), array[]::text[]) as team_ids
        from worship_service_types t
       where t.id = ${serviceTypeId}::uuid and t.organization_id = ${organizationId}::uuid and t.retired_at is null
    `),
  )[0];
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    startTime: String(row.start_time),
    durationMinutes: row.duration_minutes === null ? null : Number(row.duration_minutes),
    location: row.location === null ? null : String(row.location),
    teamIds: Array.isArray(row.team_ids) ? (row.team_ids as string[]) : [],
  };
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export interface CreateServiceInput {
  title: string;
  /** 'YYYY-MM-DDTHH:mm', wall-clock. */
  startsAt: string;
  endsAt?: string;
  location?: string;
  serviceTypeId?: string;
  /** The teams that serve. Live worship teams only. */
  groupIds: string[];
  /** Skip the same-minute duplicate hint ("Add it anyway"). */
  allowDuplicate?: boolean;
}

export type CreateServiceData =
  | { created: true; eventId: string }
  /** Not created: another service starts at the same minute. The hint is never a refusal; resend with `allowDuplicate`. */
  | { created: false; duplicate: { eventId: string; title: string } };

/**
 * `worship.plan`. Adds one service: an events row (`insertEventsInTx`, open to
 * everyone, not on the website, no check-in; the organization's active
 * "Worship" event type when it has one) plus its `worship_services` row and the
 * serving teams. Events are unaudited unless website-listed (DECISION-240).
 *
 * THE S2 RESIDUAL (`paper`, DECISION-317): the `worship_services` insert below
 * follows `insertEventsInTx` in this same function, and `boundaries.test.ts`
 * pins that this and `generateServices` are the only inserters. A service is
 * only ever a newly created event.
 */
export function createService(
  viewer: WorshipViewer,
  input: CreateServiceInput,
): Promise<WorshipResult<CreateServiceData>> {
  return guarded<CreateServiceData>(viewer, ["plan"], async (tx, has) => {
    if (!has.plan) return forbidden();
    if (!isRealWallClock(input.startsAt)) return invalid(ACTION_COPY.generic);
    if (input.endsAt !== undefined && input.endsAt !== "" && !isRealWallClock(input.endsAt)) return invalid(ACTION_COPY.generic);
    if (!Array.isArray(input.groupIds)) return invalid(ACTION_COPY.generic);
    const teams = await liveTeamIdsOrNull(tx, viewer.organizationId, input.groupIds);
    if (teams === null) return invalid(ACTION_COPY.stale);
    let serviceTypeId: string | null = null;
    if (input.serviceTypeId !== undefined && input.serviceTypeId !== "") {
      if (!isUuidShaped(input.serviceTypeId)) return invalid(ACTION_COPY.generic);
      const type = await loadLiveServiceType(tx, viewer.organizationId, input.serviceTypeId);
      if (!type) return invalid(ACTION_COPY.stale);
      serviceTypeId = type.id;
    }

    if (input.allowDuplicate !== true) {
      const duplicate = rowsOf(
        await tx.execute(sql`
          select e.id::text as id, e.title
            from events e
            join worship_services ws on ws.event_id = e.id and ws.organization_id = e.organization_id
           where e.organization_id = ${viewer.organizationId}::uuid and e.cancelled_at is null
             and date_trunc('minute', e.starts_at) = ${input.startsAt}::timestamp
           order by e.id
           limit 1
        `),
      )[0];
      if (duplicate) {
        return ok({ created: false, duplicate: { eventId: String(duplicate.id), title: String(duplicate.title) } });
      }
    }

    const inserted = await insertEventsInTx(tx, viewer.organizationId, eventActor(viewer), {
      title: input.title,
      location: input.location,
      startsAt: input.startsAt,
      endsAt: input.endsAt || undefined,
      isPublic: true,
      websiteListed: false,
      allowsCheckin: false,
      eventTypeId: await worshipEventTypeId(tx, viewer.organizationId),
    });
    if (inserted.kind === "invalid_input") return invalid(inserted.message);
    if (inserted.kind !== "ok") return invalid(ACTION_COPY.generic);
    const eventId = inserted.data.eventId;

    await tx.execute(sql`
      insert into worship_services (event_id, organization_id, service_type_id, updated_by)
      values (${eventId}::uuid, ${viewer.organizationId}::uuid, ${serviceTypeId}::uuid, ${viewer.userId}::uuid)
    `);
    for (const groupId of teams) {
      await tx.execute(sql`
        insert into worship_service_teams (organization_id, event_id, group_id)
        values (${viewer.organizationId}::uuid, ${eventId}::uuid, ${groupId}::uuid)
      `);
    }
    return ok({ created: true, eventId });
  });
}

export interface GenerateServicesInput {
  serviceTypeId: string;
  /** 'YYYY-MM-DD'. */
  firstDate: string;
  pattern: ServicePattern;
  count: number;
}

/**
 * `worship.plan`. Adds a series from a service type: the type's usual time,
 * length, place and teams, repeated weekly, every two weeks or monthly, 1 to 26
 * at a time (the events cap of 52 in total still applies). One transaction, so
 * the whole series exists or none of it does. The `worship_services` insert
 * follows `insertEventsInTx` in this function (the S2 residual, see
 * `createService`).
 */
export function generateServices(
  viewer: WorshipViewer,
  input: GenerateServicesInput,
): Promise<WorshipResult<{ eventIds: string[] }>> {
  return guarded<{ eventIds: string[] }>(viewer, ["plan"], async (tx, has) => {
    if (!has.plan) return forbidden();
    if (!isUuidShaped(input.serviceTypeId)) return notFound();
    if (!(SERVICE_PATTERNS as readonly string[]).includes(input.pattern)) return invalid(ACTION_COPY.generic);
    if (typeof input.firstDate !== "string" || !isDayKey(input.firstDate)) return invalid(ACTION_COPY.generic);
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > LIMITS.generateMax) {
      return invalid(SERVICES_COPY.several.tooMany);
    }
    const type = await loadLiveServiceType(tx, viewer.organizationId, input.serviceTypeId);
    if (!type) return notFound();

    const startsAt = `${input.firstDate}T${type.startTime}`;
    if (!isRealWallClock(startsAt)) return invalid(ACTION_COPY.generic);
    const inserted = await insertEventsInTx(tx, viewer.organizationId, eventActor(viewer), {
      title: type.name,
      location: type.location ?? undefined,
      startsAt,
      endsAt: type.durationMinutes ? addMinutes(startsAt, type.durationMinutes) : undefined,
      isPublic: true,
      websiteListed: false,
      allowsCheckin: false,
      eventTypeId: await worshipEventTypeId(tx, viewer.organizationId),
      recurrence: input.count > 1 ? { pattern: input.pattern, count: input.count } : undefined,
    });
    if (inserted.kind === "invalid_input") return invalid(inserted.message);
    if (inserted.kind !== "ok") return invalid(ACTION_COPY.generic);

    for (const eventId of inserted.data.occurrenceIds) {
      await tx.execute(sql`
        insert into worship_services (event_id, organization_id, service_type_id, updated_by)
        values (${eventId}::uuid, ${viewer.organizationId}::uuid, ${type.id}::uuid, ${viewer.userId}::uuid)
      `);
      for (const groupId of type.teamIds) {
        await tx.execute(sql`
          insert into worship_service_teams (organization_id, event_id, group_id)
          values (${viewer.organizationId}::uuid, ${eventId}::uuid, ${groupId}::uuid)
        `);
      }
    }
    return ok({ eventIds: inserted.data.occurrenceIds });
  });
}

export interface UpdateServiceInput {
  eventId: string;
  title: string;
  /** 'YYYY-MM-DDTHH:mm', wall-clock. */
  startsAt: string;
  endsAt?: string;
  /** `undefined` keeps the current place; an empty string clears it. */
  location?: string | null;
}

/**
 * `worship.plan`. Edits a service's title, time and place. First the
 * join-under-lock (C2): an event that is not a worship service is `not_found`,
 * identical to an unknown id, and `mutate.ts` is never reached. Then
 * `updateEventFieldsInTx`, which writes only title, description (left alone),
 * location, start and end and fans out to the update hooks. A cancelled service
 * is `conflict not_open` ("That service was cancelled.").
 *
 * `updateEventFieldsInTx` writes `location` on every call (an undefined value
 * clears it), so a caller that means to keep the place passes the current one:
 * read here, under the same lock.
 */
export function updateService(
  viewer: WorshipViewer,
  input: UpdateServiceInput,
): Promise<WorshipResult<{ eventId: string }>> {
  return guarded<{ eventId: string }>(viewer, ["plan"], async (tx, has) => {
    if (!has.plan) return forbidden();
    if (!isUuidShaped(input.eventId)) return notFound();
    const service = await lockService(tx, viewer.organizationId, input.eventId);
    if (!service) return notFound();
    if (service.cancelled) return conflict("not_open", ACTION_COPY.serviceCancelled);
    if (!isRealWallClock(input.startsAt)) return invalid(ACTION_COPY.generic);
    if (input.endsAt !== undefined && input.endsAt !== "" && !isRealWallClock(input.endsAt)) return invalid(ACTION_COPY.generic);

    const location = input.location === undefined ? (service.location ?? undefined) : (input.location ?? undefined);
    const updated = await updateEventFieldsInTx(tx, viewer.organizationId, {
      eventId: input.eventId,
      title: input.title,
      location,
      startsAt: input.startsAt,
      endsAt: input.endsAt || undefined,
    });
    if (updated.kind === "invalid_input") return invalid(updated.message);
    if (updated.kind !== "ok") return conflict("not_open", ACTION_COPY.serviceCancelled);

    await tx
      .update(worshipServices)
      .set({ updatedBy: viewer.userId })
      .where(and(eq(worshipServices.eventId, input.eventId), eq(worshipServices.organizationId, viewer.organizationId)));
    return ok({ eventId: input.eventId });
  });
}

/**
 * `worship.plan`. Cancels a service through the ONE cancel writer
 * (`cancelEventInTx`), which sets `cancelled_at` and runs the cancel hook in
 * this transaction: drafts and open requests withdrawn, the people who were
 * asked or scheduled emailed (queued, sent by the cron), confirmed and declined
 * rows retained, one audit row. The same code path as a cancel from Manage
 * events. An event that is not a worship service is `not_found` (C2); a repeat
 * cancel is an `ok` no-op that runs no hook.
 */
export function cancelService(
  viewer: WorshipViewer,
  input: { eventId: string },
): Promise<WorshipResult<{ changed: boolean }>> {
  return guarded<{ changed: boolean }>(viewer, ["plan"], async (tx, has) => {
    if (!has.plan) return forbidden();
    if (!isUuidShaped(input.eventId)) return notFound();
    const service = await lockService(tx, viewer.organizationId, input.eventId);
    if (!service) return notFound();
    const cancelled = await cancelEventInTx(tx, viewer.organizationId, input.eventId, eventActor(viewer));
    if (cancelled.kind !== "ok") return notFound();
    return ok({ changed: cancelled.data.changed });
  });
}

/**
 * `worship.plan`. Replaces the teams serving a service: adds (or re-adds, clearing
 * `removed_at`) and soft-removes. Removing a team that has a live (non-withdrawn)
 * assignment on this service is refused (`in_use`). A cancelled service is
 * `conflict not_open`.
 */
export function setServiceTeams(
  viewer: WorshipViewer,
  input: { eventId: string; groupIds: string[] },
): Promise<WorshipResult<{ eventId: string }>> {
  return guarded<{ eventId: string }>(viewer, ["plan"], async (tx, has) => {
    if (!has.plan) return forbidden();
    if (!isUuidShaped(input.eventId)) return notFound();
    const service = await lockService(tx, viewer.organizationId, input.eventId);
    if (!service) return notFound();
    if (service.cancelled) return conflict("not_open", ACTION_COPY.serviceCancelled);
    if (!Array.isArray(input.groupIds)) return invalid(ACTION_COPY.generic);
    const wanted = await liveTeamIdsOrNull(tx, viewer.organizationId, input.groupIds);
    if (wanted === null) return invalid(ACTION_COPY.stale);

    const existing = rowsOf(
      await tx.execute(sql`
        select st.group_id::text as group_id, (st.removed_at is not null) as removed, g.name,
               (select count(*)::int from worship_assignments a
                 where a.organization_id = st.organization_id and a.event_id = st.event_id
                   and a.group_id = st.group_id and a.status <> 'withdrawn') as live
          from worship_service_teams st
          join groups g on g.id = st.group_id and g.organization_id = st.organization_id
         where st.organization_id = ${viewer.organizationId}::uuid and st.event_id = ${input.eventId}::uuid
         order by st.group_id
         for update of st
      `),
    );
    const byGroup = new Map(existing.map((r) => [String(r.group_id), r]));
    for (const row of existing) {
      if (row.removed === false && !wanted.includes(String(row.group_id)) && Number(row.live) > 0) {
        return conflict("in_use", ACTION_COPY.inUse(String(row.name), 1));
      }
    }
    for (const row of existing) {
      if (row.removed === false && !wanted.includes(String(row.group_id))) {
        await tx.execute(sql`
          update worship_service_teams set removed_at = now()
           where organization_id = ${viewer.organizationId}::uuid and event_id = ${input.eventId}::uuid
             and group_id = ${String(row.group_id)}::uuid
        `);
      }
    }
    for (const groupId of wanted) {
      const row = byGroup.get(groupId);
      if (!row) {
        await tx.execute(sql`
          insert into worship_service_teams (organization_id, event_id, group_id)
          values (${viewer.organizationId}::uuid, ${input.eventId}::uuid, ${groupId}::uuid)
        `);
      } else if (row.removed === true) {
        await tx.execute(sql`
          update worship_service_teams set removed_at = null
           where organization_id = ${viewer.organizationId}::uuid and event_id = ${input.eventId}::uuid
             and group_id = ${groupId}::uuid
        `);
      }
    }
    return ok({ eventId: input.eventId });
  });
}

// ---------------------------------------------------------------------------
// People in positions
// ---------------------------------------------------------------------------

interface PlacementTarget {
  service: ServiceRow;
  teamName: string;
}

/**
 * The checks every placement shares, in order, after the scheduling authority:
 * the service is a worship service (lock, `not_found` otherwise), is not
 * cancelled and has not started; the team is live and is serving it; the
 * position is a live position of that team. Each refusal carries its Copy
 * sentence; the database triggers re-check all of it.
 */
async function checkPlacement(
  tx: OrgTx,
  organizationId: string,
  input: { eventId: string; groupId: string; positionId: string },
): Promise<{ kind: "ok"; target: PlacementTarget } | WorshipFailure> {
  const service = await lockService(tx, organizationId, input.eventId);
  if (!service) return notFound();
  if (service.cancelled) return conflict("not_open", ACTION_COPY.serviceCancelled);
  if (service.started) return conflict("not_open", ACTION_COPY.serviceStarted);
  const team = await loadTeam(tx, organizationId, input.groupId);
  if (!team) return notFound();
  if (team.retired) return conflict("not_open", ACTION_COPY.teamRetired(team.name));
  const serving = rowsOf(
    await tx.execute(sql`
      select (removed_at is not null) as removed from worship_service_teams
       where organization_id = ${organizationId}::uuid and event_id = ${input.eventId}::uuid and group_id = ${input.groupId}::uuid
    `),
  )[0];
  if (!serving || serving.removed === true) return conflict("not_open", ACTION_COPY.stale);
  const position = await loadPosition(tx, organizationId, input.positionId);
  if (!position || position.groupId !== input.groupId) return notFound();
  if (position.retired) return conflict("not_open", ACTION_COPY.stale);
  return { kind: "ok", target: { service, teamName: team.name } };
}

/** `worship.schedule` or a live seat on `groupId`. Places a person as a DRAFT: nobody is told until Send. */
export function placePerson(
  viewer: WorshipViewer,
  input: { eventId: string; groupId: string; positionId: string; personId: string },
): Promise<WorshipResult<{ assignmentId: string }>> {
  return guarded<{ assignmentId: string }>(viewer, ["schedule"], async (tx, has) => {
    if (![input.eventId, input.groupId, input.positionId, input.personId].every((id) => typeof id === "string" && isUuidShaped(id))) {
      return notFound();
    }
    if (!(await canScheduleTeam(tx, viewer, input.groupId, has as { schedule: boolean }))) return forbidden();
    const checked = await checkPlacement(tx, viewer.organizationId, input);
    if (checked.kind !== "ok") return checked;

    const person = rowsOf(
      await tx.execute(sql`
        select p.first_name, p.preferred_name, p.last_name,
               exists (
                 select 1 from group_memberships gm
                   join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id
                  where gm.organization_id = ${viewer.organizationId}::uuid and gm.group_id = ${input.groupId}::uuid
                    and gm.person_id = ${input.personId}::uuid
                    and gm.starts_on <= presby_worship_in_effect_day(${viewer.organizationId}::uuid)
                    and (gm.ends_on is null or gm.ends_on > presby_worship_in_effect_day(${viewer.organizationId}::uuid))
                    and p.merged_into_id is null and p.date_of_death is null and m.ended_on is null
               ) as on_team
          from people p
          join memberships pm on pm.person_id = p.id and pm.organization_id = ${viewer.organizationId}::uuid
         where p.id = ${input.personId}::uuid
      `),
    )[0];
    if (!person) return notFound();
    if (person.on_team !== true) {
      const name = `${String(person.preferred_name ?? person.first_name)} ${String(person.last_name)}`;
      return conflict("not_open", ACTION_COPY.notOnTeam(name));
    }

    const row = rowsOf(
      await tx.execute(sql`
        insert into worship_assignments (organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
        values (${viewer.organizationId}::uuid, ${input.eventId}::uuid, ${input.groupId}::uuid, ${input.positionId}::uuid,
                ${input.personId}::uuid, ${viewer.personId}::uuid)
        returning id::text as id
      `),
    )[0]!;
    return ok({ assignmentId: String(row.id) });
  });
}

/**
 * `worship.schedule` or a live seat on `groupId`. Places a GUEST by name: the
 * row is born `confirmed`, recorded on the leader's behalf, and a guest is never
 * emailed. The name is validated by `validateGuestName` (no contact details).
 */
export function placeGuest(
  viewer: WorshipViewer,
  input: { eventId: string; groupId: string; positionId: string; guestName: string },
): Promise<WorshipResult<{ assignmentId: string }>> {
  return guarded<{ assignmentId: string }>(viewer, ["schedule"], async (tx, has) => {
    if (![input.eventId, input.groupId, input.positionId].every((id) => typeof id === "string" && isUuidShaped(id))) {
      return notFound();
    }
    if (!(await canScheduleTeam(tx, viewer, input.groupId, has as { schedule: boolean }))) return forbidden();
    const guest = validateGuestName(input.guestName);
    if (!guest.ok) return invalid(guest.message);
    const checked = await checkPlacement(tx, viewer.organizationId, input);
    if (checked.kind !== "ok") return checked;

    const row = rowsOf(
      await tx.execute(sql`
        insert into worship_assignments
          (organization_id, event_id, group_id, position_id, guest_name, assigned_by_person_id,
           status, responded_by_person_id, response_source)
        values (${viewer.organizationId}::uuid, ${input.eventId}::uuid, ${input.groupId}::uuid, ${input.positionId}::uuid,
                ${guest.name}, ${viewer.personId}::uuid, 'confirmed', ${viewer.personId}::uuid, 'on_behalf')
        returning id::text as id
      `),
    )[0]!;
    return ok({ assignmentId: String(row.id) });
  });
}

interface AssignmentRow {
  id: string;
  eventId: string;
  groupId: string;
  positionId: string;
  personId: string | null;
  status: string;
  declineReason: string | null;
  assignedBy: string;
}

/** Locks one assignment row of this organization (`FOR UPDATE`). */
async function lockAssignment(tx: OrgTx, organizationId: string, assignmentId: string): Promise<AssignmentRow | null> {
  const r = rowsOf(
    await tx.execute(sql`
      select id::text as id, event_id::text as event_id, group_id::text as group_id, position_id::text as position_id,
             person_id::text as person_id, status, decline_reason, assigned_by_person_id::text as assigned_by
        from worship_assignments
       where id = ${assignmentId}::uuid and organization_id = ${organizationId}::uuid
         for update
    `),
  )[0];
  if (!r) return null;
  return {
    id: String(r.id),
    eventId: String(r.event_id),
    groupId: String(r.group_id),
    positionId: String(r.position_id),
    personId: r.person_id === null ? null : String(r.person_id),
    status: String(r.status),
    declineReason: r.decline_reason === null ? null : String(r.decline_reason),
    assignedBy: String(r.assigned_by),
  };
}

/**
 * `worship.schedule` or a live seat on THE ASSIGNMENT'S TEAM. Takes a person
 * off a position: `withdrawn` with reason `removed`. **No message is sent**
 * (F430; the dialog says so). Allowed on a started or cancelled service (it
 * only removes). Removing a withdrawn row is an `ok` no-op.
 */
export function removeAssignment(
  viewer: WorshipViewer,
  input: { assignmentId: string },
): Promise<WorshipResult<{ changed: boolean }>> {
  return guarded<{ changed: boolean }>(viewer, ["schedule"], async (tx, has) => {
    if (!isUuidShaped(input.assignmentId)) return notFound();
    const a = await lockAssignment(tx, viewer.organizationId, input.assignmentId);
    if (!a) return notFound();
    if (!(await canScheduleTeam(tx, viewer, a.groupId, has as { schedule: boolean }))) return forbidden();
    if (a.status === "withdrawn") return ok({ changed: false });
    await tx
      .update(worshipAssignments)
      .set({ status: "withdrawn", withdrawnByPersonId: viewer.personId, withdrawnReason: "removed" })
      .where(and(eq(worshipAssignments.id, a.id), eq(worshipAssignments.organizationId, viewer.organizationId)));
    return ok({ changed: true });
  });
}

function parseAnswer(answer: unknown, reason: unknown): { ok: true; answer: Answer; reason: Reason | null } | { ok: false } {
  if (typeof answer !== "string" || !(ANSWERS as readonly string[]).includes(answer)) return { ok: false };
  if (answer === "declined" && reason !== undefined && reason !== null && reason !== "") {
    if (!isReason(reason)) return { ok: false };
    return { ok: true, answer: "declined", reason };
  }
  return { ok: true, answer: answer as Answer, reason: null };
}

/**
 * `worship.schedule` or a live seat on the assignment's team. Records an answer
 * on someone's behalf (`response_source = on_behalf`, attributed to the
 * recorder). The same answer again is a no-op (no write, no audit). A guest has
 * no answer to record. The service must be neither cancelled nor started (the
 * trigger enforces it). The leader knows, so no message is queued.
 */
export function recordResponse(
  viewer: WorshipViewer,
  input: { assignmentId: string; answer: Answer; reason?: Reason | null },
): Promise<WorshipResult<{ changed: boolean }>> {
  return guarded<{ changed: boolean }>(viewer, ["schedule"], async (tx, has) => {
    if (!isUuidShaped(input.assignmentId)) return notFound();
    const parsed = parseAnswer(input.answer, input.reason);
    if (!parsed.ok) return invalid(ACTION_COPY.generic);
    const a = await lockAssignment(tx, viewer.organizationId, input.assignmentId);
    if (!a) return notFound();
    if (!(await canScheduleTeam(tx, viewer, a.groupId, has as { schedule: boolean }))) return forbidden();
    if (a.personId === null) return invalid(ACTION_COPY.generic);
    if (a.status === "withdrawn") return conflict("not_open", ACTION_COPY.stale);

    const status = statusForAnswer(parsed.answer);
    if (a.status === status && (status !== "declined" || a.declineReason === parsed.reason)) {
      return ok({ changed: false });
    }
    await tx
      .update(worshipAssignments)
      .set({
        status,
        responseSource: "on_behalf",
        respondedByPersonId: viewer.personId,
        declineReason: status === "declined" ? parsed.reason : null,
      })
      .where(and(eq(worshipAssignments.id, a.id), eq(worshipAssignments.organizationId, viewer.organizationId)));
    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.WORSHIP_RESPONSE_RECORDED,
      actor: { userId: viewer.userId, email: viewer.email },
      resourceType: "worship_assignment",
      resourceId: a.id,
      metadata: { assignmentId: a.id, eventId: a.eventId, answer: parsed.answer },
    });
    return ok({ changed: true });
  });
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface SendResult {
  /** Assignments moved from draft to requested. */
  sent: number;
  /** People, by what happened to their notice. */
  emailed: number;
  guardian: number;
  noAddress: number;
  doNotContact: number;
  /** Drafts left as drafts because the person is no longer on the team. */
  notOnTeam: number;
  /** Distinct services touched. */
  services: number;
  /** The `email_queue` rows written; the action attempts the inline send after commit. */
  queueIds: string[];
}

/**
 * `worship.schedule` or a seat (scope cut to the teams the seat holder leads).
 * THE SEND: takes the drafts on future, uncancelled services, re-checks the
 * roster and membership per person, sets `requested`, `sent_by`, and the notice
 * outcome, and queues ONE email per person listing their positions and dates.
 *
 * ORDER, which is the lock order. (1) Refuse with `mail_unavailable` when
 * `platformOrigin()` is null, before anything. (2) Resolve the scope. (3) Find
 * the affected services, then lock their event rows `FOR NO KEY UPDATE` in
 * `(starts_at, id)` order (the same order every multi-row locker uses, so two
 * Sends cannot deadlock), THEN re-read the drafts: a Send that waited on the
 * lock finds the first Send's rows no longer drafts and "nothing to send", so
 * two concurrent Sends never double-queue a person, and a Send racing a cancel
 * sees `cancelled_at`. (4) At most 200 assignments or 52 services per call
 * (`over_cap`). (5) One outcome per person from `decideReach`: a presumed minor
 * is `guardian` and is never emailed; no address; do not contact; else
 * `emailed`. The audit row carries counts only.
 */
export function sendRequests(
  viewer: WorshipViewer,
  input: { eventIds?: string[]; groupId?: string },
): Promise<WorshipResult<SendResult>> {
  return guarded<SendResult>(viewer, ["schedule"], async (tx, has) => {
    if (platformOrigin() === null) return conflict("mail_unavailable", ACTION_COPY.sendMailUnavailable);
    const scope = await resolveSendFilter(tx, viewer, has, input);
    if (scope.kind !== "ok") return scope;

    const candidates = await loadSendableDrafts(tx, viewer.organizationId, scope.filter);
    const candidateEvents = [...new Set(candidates.map((d) => d.eventId))];
    if (candidateEvents.length > LIMITS.sendMaxServices) return conflict("over_cap", ACTION_COPY.sendOverCap);
    if (candidateEvents.length > 0) {
      await tx.execute(sql`
        select e.id from events e
         where e.organization_id = ${viewer.organizationId}::uuid and e.id in (${uuidList(candidateEvents)})
         order by e.starts_at, e.id
           for no key update of e
      `);
    }

    // Re-read under the locks: this is the set that is sent.
    const drafts = await loadSendableDrafts(tx, viewer.organizationId, scope.filter);
    const sendable = drafts.filter((d) => d.onTeam);
    const notOnTeam = drafts.length - sendable.length;
    if (sendable.length === 0) return invalid(ACTION_COPY.sendNothing);
    const plan = sendPlan(sendable);
    if (plan.overAssignmentCap || plan.overServiceCap) return conflict("over_cap", ACTION_COPY.sendOverCap);

    const reach = new Map<string, Awaited<ReturnType<typeof decideReach>>>();
    for (const person of plan.people) reach.set(person.personId, await decideReach(tx, viewer.organizationId, person.personId));

    let sent = 0;
    const sentBy = new Map<string, string[]>();
    for (const person of plan.people) {
      const outcome = reach.get(person.personId)!.outcome;
      for (const item of person.items) {
        const moved = await tx
          .update(worshipAssignments)
          .set({ status: "requested", sentByPersonId: viewer.personId, noticeOutcome: outcome })
          .where(
            and(
              eq(worshipAssignments.id, item.assignmentId),
              eq(worshipAssignments.organizationId, viewer.organizationId),
              eq(worshipAssignments.status, "draft"),
            ),
          )
          .returning({ id: worshipAssignments.id });
        if (moved.length === 1) {
          sent += 1;
          const list = sentBy.get(person.personId);
          if (list) list.push(item.assignmentId);
          else sentBy.set(person.personId, [item.assignmentId]);
        }
      }
    }

    const notices = plan.people
      .filter((p) => reach.get(p.personId)!.outcome === "emailed" && sentBy.has(p.personId))
      .map((p) => ({
        personId: p.personId,
        address: reach.get(p.personId)!.address!,
        assignmentIds: sentBy.get(p.personId)!,
        lines: p.items
          .filter((item) => sentBy.get(p.personId)!.includes(item.assignmentId))
          .map((item) => ({ startsAt: item.startsAt, positionName: item.positionName, teamName: item.teamName })),
      }));
    const queueIds = await queueRequestNotices(tx, { organizationId: viewer.organizationId, notices });

    const counts: Record<NoticeOutcome, number> = { emailed: 0, guardian: 0, no_address: 0, do_not_contact: 0 };
    for (const person of plan.people) if (sentBy.has(person.personId)) counts[reach.get(person.personId)!.outcome] += 1;

    await insertAuditRow(tx, {
      action: AUDIT_ACTIONS.WORSHIP_REQUESTS_SENT,
      actor: { userId: viewer.userId, email: viewer.email },
      resourceType: "organization",
      resourceId: viewer.organizationId,
      metadata: {
        sent,
        emailed: counts.emailed,
        guardian: counts.guardian,
        noAddress: counts.no_address,
        doNotContact: counts.do_not_contact,
        services: plan.services,
      },
    });
    return ok({
      sent,
      emailed: counts.emailed,
      guardian: counts.guardian,
      noAddress: counts.no_address,
      doNotContact: counts.do_not_contact,
      notOnTeam,
      services: plan.services,
      queueIds,
    });
  });
}

// ---------------------------------------------------------------------------
// The volunteer's own answers and dates
// ---------------------------------------------------------------------------

/**
 * Any member, on THEIR OWN row only; the person is derived from the viewer and
 * the export takes no person parameter. `response_source = self`. A row that is
 * not the viewer's, a draft (the assignee cannot see one) or one that does not
 * exist is `not_found`, IDENTICAL for all three (the id-guessing hole). The row
 * is locked first, then the service is read: a withdrawn row, a cancelled or a
 * started service is `conflict not_open` (Copy: "This request is no longer
 * open"). The same answer again is an `ok` no-op; a different answer is a normal
 * transition and the last write wins under the row lock. A change TO `declined`
 * queues one decline notice to the person who placed them (when they have a
 * deliverable address; it never names the decliner); the action attempts the
 * inline send after the commit.
 */
export function respondToAssignment(
  viewer: WorshipViewer,
  input: { assignmentId: string; answer: Answer; reason?: Reason | null },
): Promise<WorshipResult<{ changed: boolean; queueIds: string[] }>> {
  return guarded<{ changed: boolean; queueIds: string[] }>(viewer, [], async (tx) => {
    if (!isUuidShaped(input.assignmentId)) return notFound();
    const parsed = parseAnswer(input.answer, input.reason);
    if (!parsed.ok) return invalid(ACTION_COPY.generic);

    const a = await lockAssignment(tx, viewer.organizationId, input.assignmentId);
    if (!a || a.personId !== viewer.personId || a.status === "draft") return notFound();
    if (a.status === "withdrawn") return conflict("not_open", GATE_COPY.closedRequest.heading);

    const event = rowsOf(
      await tx.execute(sql`
        select (e.cancelled_at is not null) as cancelled,
               (e.starts_at <= presby_worship_org_now(e.organization_id)) as started,
               to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at
          from events e
         where e.id = ${a.eventId}::uuid and e.organization_id = ${viewer.organizationId}::uuid
      `),
    )[0];
    if (!event || event.cancelled === true || event.started === true) return conflict("not_open", GATE_COPY.closedRequest.heading);

    const status = statusForAnswer(parsed.answer);
    if (a.status === status && (status !== "declined" || a.declineReason === parsed.reason)) {
      return ok({ changed: false, queueIds: [] });
    }
    await tx
      .update(worshipAssignments)
      .set({
        status,
        responseSource: "self",
        respondedByPersonId: viewer.personId,
        declineReason: status === "declined" ? parsed.reason : null,
      })
      .where(and(eq(worshipAssignments.id, a.id), eq(worshipAssignments.organizationId, viewer.organizationId)));

    let queueIds: string[] = [];
    if (status === "declined" && a.status !== "declined" && a.assignedBy !== viewer.personId) {
      const position = await loadPosition(tx, viewer.organizationId, a.positionId);
      queueIds = await queueDeclinedNotice(tx, {
        organizationId: viewer.organizationId,
        toPersonId: a.assignedBy,
        groupId: a.groupId,
        eventId: a.eventId,
        positionName: position?.name ?? "",
        startsAt: String(event.starts_at),
      });
    }
    return ok({ changed: true, queueIds });
  });
}

export interface BlockoutConflict {
  assignmentId: string;
  eventId: string;
  /** Wall-clock 'YYYY-MM-DDTHH:mm'. */
  startsAt: string;
  positionName: string;
  teamName: string;
}

/**
 * Any member, for themselves. Saves "dates I can't serve": a range joined with
 * every live range it overlaps or touches (those are END-DATED and the union is
 * inserted, so history is kept and nothing is deleted, DECISION-327). Refuses an
 * end before the start, a range wholly in the past, one over 366 days, and a
 * 51st live range (the trigger, under an advisory lock the merge shares). The
 * blockout is SAVED even over a date the person has agreed to serve; their own
 * requested or confirmed assignments inside the range come back as `conflicts`
 * so the page can say so (a blockout never cancels anything).
 */
export function addBlockout(
  viewer: WorshipViewer,
  input: { startsOn: string; endsOn: string; reason?: Reason | null },
): Promise<WorshipResult<{ blockoutId: string; merged: boolean; conflicts: BlockoutConflict[] }>> {
  return guarded<{ blockoutId: string; merged: boolean; conflicts: BlockoutConflict[] }>(viewer, [], async (tx) => {
    const reason = input.reason ?? null;
    if (reason !== null && !isReason(reason)) return invalid(ACTION_COPY.generic);
    const today = await orgToday(tx, viewer.organizationId);
    const range: BlockoutRange = { startsOn: String(input.startsOn), endsOn: String(input.endsOn) };
    const problem = validateBlockoutRange(range, today);
    if (problem === "end_before_start") return invalid(MEMBER_COPY.blockouts.endBeforeStart);
    if (problem === "in_past") return invalid(MEMBER_COPY.blockouts.inPast);
    if (problem === "too_long") return invalid(MEMBER_COPY.blockouts.tooLong);
    if (problem === "invalid_date") return invalid(ACTION_COPY.generic);

    // The same advisory lock the insert trigger takes, so the merge and the cap see one consistent set.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`worship_blockouts:${viewer.organizationId}:${viewer.personId}`}, 0))`,
    );
    const live = rowsOf(
      await tx.execute(sql`
        select id::text as id, starts_on::text as starts_on, ends_on::text as ends_on
          from worship_blockouts
         where organization_id = ${viewer.organizationId}::uuid and person_id = ${viewer.personId}::uuid and ended_at is null
         order by starts_on, id
      `),
    ).map((r) => ({ id: String(r.id), startsOn: String(r.starts_on), endsOn: String(r.ends_on) }));
    const { merged, absorbedIds } = mergeBlockoutRanges(live, range);
    if (merged.endsOn.localeCompare(merged.startsOn) >= 0 && daysSpan(merged) > LIMITS.blockoutMaxDays) {
      return invalid(MEMBER_COPY.blockouts.tooLong);
    }
    for (const id of absorbedIds) {
      await tx.execute(sql`
        update worship_blockouts set ended_at = now()
         where id = ${id}::uuid and organization_id = ${viewer.organizationId}::uuid
      `);
    }
    const row = rowsOf(
      await tx.execute(sql`
        insert into worship_blockouts (organization_id, person_id, starts_on, ends_on, reason)
        values (${viewer.organizationId}::uuid, ${viewer.personId}::uuid, ${merged.startsOn}::date, ${merged.endsOn}::date, ${reason})
        returning id::text as id
      `),
    )[0]!;

    const conflictRows = rowsOf(
      await tx.execute(sql`
        select a.id::text as assignment_id, a.event_id::text as event_id,
               to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at,
               wp.name as position_name, g.name as team_name
          from worship_assignments a
          join events e on e.id = a.event_id and e.organization_id = a.organization_id
          join worship_positions wp on wp.id = a.position_id and wp.organization_id = a.organization_id
          join groups g on g.id = a.group_id and g.organization_id = a.organization_id
         where a.organization_id = ${viewer.organizationId}::uuid and a.person_id = ${viewer.personId}::uuid
           and a.status in ('requested', 'confirmed')
           and e.cancelled_at is null and e.starts_at > presby_worship_org_now(a.organization_id)
           and e.starts_at::date between ${merged.startsOn}::date and ${merged.endsOn}::date
         order by e.starts_at, a.id
      `),
    );
    return ok({
      blockoutId: String(row.id),
      merged: absorbedIds.length > 0,
      conflicts: conflictRows.map((r) => ({
        assignmentId: String(r.assignment_id),
        eventId: String(r.event_id),
        startsAt: String(r.starts_at),
        positionName: String(r.position_name),
        teamName: String(r.team_name),
      })),
    });
  });
}

/** Days in a range counting both ends. */
function daysSpan(range: BlockoutRange): number {
  const [ay, am, ad] = range.startsOn.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = range.endsOn.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000) + 1;
}

/** Any member, for themselves. Ends one of their own live ranges (never a delete). Another person's id is `not_found`. */
export function endBlockout(
  viewer: WorshipViewer,
  input: { blockoutId: string },
): Promise<WorshipResult<{ changed: boolean }>> {
  return guarded<{ changed: boolean }>(viewer, [], async (tx) => {
    if (!isUuidShaped(input.blockoutId)) return notFound();
    const row = rowsOf(
      await tx.execute(sql`
        select (ended_at is not null) as ended from worship_blockouts
         where id = ${input.blockoutId}::uuid and organization_id = ${viewer.organizationId}::uuid
           and person_id = ${viewer.personId}::uuid
           for update
      `),
    )[0];
    if (!row) return notFound();
    if (row.ended === true) return ok({ changed: false });
    await tx.execute(sql`
      update worship_blockouts set ended_at = now()
       where id = ${input.blockoutId}::uuid and organization_id = ${viewer.organizationId}::uuid
    `);
    return ok({ changed: true });
  });
}
