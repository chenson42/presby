import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { insertAuditRow } from "@/lib/audit-tx";
import type { OrgTx } from "@/lib/authz";
import { groupMemberships, groups, groupTypes } from "@/lib/db/domain/groups";
import {
  worshipPositionQualifications,
  worshipPositions,
  worshipServiceTypeTeams,
  worshipServiceTypes,
  worshipTeams,
} from "@/lib/db/domain/worship";
import {
  addManagedGroupMemberInTx,
  endManagedGroupMemberInTx,
  insertManagedGroupInTx,
  updateManagedGroupInTx,
} from "@/lib/groups";
import { isUuidShaped } from "@/lib/shared/uuid";
import { runGated, type WorshipViewer } from "./access";
import { holdsPermission } from "./authority";
import { ACTION_COPY, SERVICES_COPY, TEAMS_COPY } from "./copy";
import {
  conflict,
  forbidden,
  invalid,
  mapDatabaseError,
  notFound,
  ok,
  type WorshipResult,
} from "./result";
import { isStarterKey, startersFor, type StarterKey } from "./starters";
import { orgName, orgToday, rowsOf } from "./sql-util";
import { LIMITS, TEAM_KINDS, type TeamKind } from "./vocab";

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
           and rg.starts_on <= presby_worship_org_today(${organizationId}::uuid)
           and (rg.ends_on is null or rg.ends_on > presby_worship_org_today(${organizationId}::uuid))
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
                    and gm.starts_on <= presby_worship_org_today(${viewer.organizationId}::uuid)
                    and (gm.ends_on is null or gm.ends_on > presby_worship_org_today(${viewer.organizationId}::uuid))
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

    const today = await orgToday(tx, viewer.organizationId);
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
