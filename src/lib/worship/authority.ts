import "server-only";
import { sql } from "drizzle-orm";
import type { OrgTx } from "@/lib/authz";
import { WORSHIP_KEYS, type WorshipHas, type WorshipKeyName } from "./vocab";

/**
 * In-transaction authority helpers - docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 "Module layout" (`authority.ts`). Every function takes the
 * transaction the caller already holds (`withOrgContext`), so a gate and the
 * write it guards share one snapshot.
 *
 * RLS enforces tenancy, not authorization: these answers come from the
 * permission resolver (`presby_has_permission`) and the seat function
 * (`presby_worship_leads_team`), never from a session claim and never from
 * `FEATURES.*`. NOT treasury's `holdsPermissions` (`check:treasury-boundaries`
 * keeps the two modules apart); the few lines are repeated on purpose.
 *
 * Scheduling authority is the key `worship.schedule` OR a live `chair` /
 * `leader` seat on THIS team's group (R7, DECISION-318), per team. `manage` and
 * `plan` never carry scheduling by themselves.
 */

export interface AuthorityViewer {
  personId: string;
  organizationId: string;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return ((result as { rows?: Array<Record<string, unknown>> } | null)?.rows ?? []) as Array<
    Record<string, unknown>
  >;
}

/** Which of the named worship keys the viewer holds, read live (keys are bound parameters). */
export async function holdsKeys(
  tx: OrgTx,
  viewer: AuthorityViewer,
  names: readonly WorshipKeyName[],
): Promise<Partial<WorshipHas>> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return {};
  const selects = unique.map(
    (name, i) =>
      sql`presby_has_permission(${viewer.personId}::uuid, ${viewer.organizationId}::uuid, ${WORSHIP_KEYS[name]}) as k${sql.raw(String(i))}`,
  );
  const row = rowsOf(await tx.execute(sql`select ${sql.join(selects, sql`, `)}`))[0] ?? {};
  const out: Partial<WorshipHas> = {};
  unique.forEach((name, i) => {
    out[name] = row[`k${i}`] === true;
  });
  return out;
}

/**
 * Any OTHER permission key (not a worship key), read live. Used for the two
 * keys worship composes with and does not own: `groups.manage` (adopting an
 * existing group) and `org_features.manage` (the off state's link).
 */
export async function holdsPermission(tx: OrgTx, viewer: AuthorityViewer, key: string): Promise<boolean> {
  const row = rowsOf(
    await tx.execute(
      sql`select presby_has_permission(${viewer.personId}::uuid, ${viewer.organizationId}::uuid, ${key}) as k`,
    ),
  )[0];
  return row?.k === true;
}

/** All three keys at once. */
export async function holdsAllKeys(tx: OrgTx, viewer: AuthorityViewer): Promise<WorshipHas> {
  const held = await holdsKeys(tx, viewer, ["manage", "plan", "schedule"]);
  return { manage: held.manage === true, plan: held.plan === true, schedule: held.schedule === true };
}

/**
 * Whether the viewer holds a live chair or leader seat on this team's group,
 * as of the organization's local today. False for a group that is not a worship
 * team, for a derived group, and for a seat that has ended, has not begun, or
 * is held by a merged, deceased or ended-relationship person.
 */
export async function leadsTeam(tx: OrgTx, viewer: AuthorityViewer, groupId: string): Promise<boolean> {
  const row = rowsOf(
    await tx.execute(sql`
      select presby_worship_leads_team(
               ${viewer.organizationId}::uuid,
               ${viewer.personId}::uuid,
               ${groupId}::uuid,
               presby_worship_org_today(${viewer.organizationId}::uuid)
             ) as leads
    `),
  )[0];
  return row?.leads === true;
}

/**
 * The team groups the viewer holds a live seat on. One statement, so a page
 * can show "You lead" without one call per team.
 */
export async function ledTeamIds(tx: OrgTx, viewer: AuthorityViewer): Promise<string[]> {
  const rows = rowsOf(
    await tx.execute(sql`
      select wt.group_id::text as group_id
        from worship_teams wt
       where wt.organization_id = ${viewer.organizationId}::uuid
         and presby_worship_leads_team(
               wt.organization_id,
               ${viewer.personId}::uuid,
               wt.group_id,
               presby_worship_org_today(wt.organization_id)
             )
    `),
  );
  return rows.map((r) => String(r.group_id));
}

/** `worship.schedule` or the seat on this team. `has` is passed when the caller already read the keys. */
export async function canScheduleTeam(
  tx: OrgTx,
  viewer: AuthorityViewer,
  groupId: string,
  has?: Pick<WorshipHas, "schedule">,
): Promise<boolean> {
  const schedule = has ? has.schedule : (await holdsKeys(tx, viewer, ["schedule"])).schedule === true;
  if (schedule) return true;
  return leadsTeam(tx, viewer, groupId);
}
