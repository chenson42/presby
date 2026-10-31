import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { assertPermissionSubset, withOrgContext, type OrgTx } from "@/lib/authz";
import { rowsOf } from "./db-util";
import { holdsPermissions } from "./keys";
import { TREASURY_MODULES, type TreasuryModule } from "./modules";

/**
 * The treasury team - the narrow, audited delegation path for the money
 * surfaces. docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 P3-14 and F296,
 * generalizing `giving/team.ts` (docs/work-log/2026-10-15-online-giving.md,
 * Phase 2 R3 / F138, DECISION-170), which is now a thin wrapper over this file
 * with `surface: "giving"`.
 *
 * WHY THIS MODULE EXISTS. After the platform operator designates the first
 * treasurer, the ordinary tenant paths cannot delegate treasury keys:
 * `adoptTemplate()` needs `roles.manage` and `grantRole()` needs
 * `role_grants.manage`, and each ALSO requires the actor to hold every key
 * being delegated - and no one holds both kinds of key (the founding
 * administrator has the first and no money key; the treasurer the reverse).
 * F138. So a manage-key holder gets a NARROW, AUDITED path of their own, and
 * only for roles made entirely of treasury-module keys (F296: the treasurer
 * must be able to name a second payer, and the treasurer role now carries
 * reimbursement keys as well as giving keys).
 *
 * TWO SURFACES, ONE IMPLEMENTATION. A surface is a manage key plus a module:
 *   giving          `giving.manage`          module 'giving'
 *   reimbursement   `reimbursement.manage`   module 'reimbursement'
 * The actor gate is the surface's own manage key, so a `giving.manage` holder
 * who holds no reimbursement key gets nothing on the reimbursement page and
 * vice versa. A surface LISTS only roles (and grants) that carry at least one
 * key of its own module, so the giving page never shows the Reimbursement
 * Clerk role.
 *
 * WHAT MAKES IT SAFE (each is a step below, in this order, and each is tested):
 *   0. the actor holds the surface's manage key (one `presby_has_permission`);
 *   1. the target role is ORG-OWNED, active, non-empty, and EVERY key it
 *      carries has `permissions.module` in `TREASURY_MODULES`
 *      (`not_treasury_only` otherwise - a `roles.manage` holder adding a
 *      non-treasury key to a treasury role sends it back to the ordinary
 *      `role_grants.manage` path, never through this one);
 *   2. the target person holds a CURRENT membership here, and the grant is
 *      PERSON-ARM only (a group grant would widen silently when the group's
 *      roster changes);
 *   3. `assertPermissionSubset()` from `@/lib/authz`, called UNCHANGED - the
 *      actor can only hand out keys they hold themselves (DECISION-068/106);
 *   4. the write. A revoke ends the grant (`ends_on = current_date`), never
 *      deletes it, and refuses to end the last effective manage-key grant of
 *      that surface.
 *
 * NOTHING HERE EDITS A ROLE'S DEFINITION beyond `ensureTreasuryRole` adding the
 * template's own keys the actor already holds. The DECISION-106 rule that
 * adding a key to a role needs that key stands: `setRolePermissions()` is
 * untouched.
 *
 * The audit writes (`TENANT_ROLE_GRANTED` / `TENANT_ROLE_REVOKED` with `path:
 * "giving_team"` or `"reimbursement_team"`, `ROLE_DEFINITION_ADOPTED_FROM_
 * TEMPLATE`) belong to each surface's `team/actions.ts`, after the commit.
 *
 * This file names permission KEYS (strings), never a `reimbursement_*` table or
 * function (T2).
 */

export type TeamSurface = "giving" | "reimbursement";

interface SurfaceSpec {
  /** The key whose holders may use this surface. */
  manageKey: string;
  /** A role/grant is listed on this surface only if it carries a key of this module. */
  ownModule: TreasuryModule;
  /** Closed list: the templates `ensureTreasuryRole` may build from. */
  templateKeys: readonly string[];
  /** `role_grants.grant_reason` for a grant made here. */
  grantReason: string;
}

export const TEAM_SURFACES: Readonly<Record<TeamSurface, SurfaceSpec>> = {
  giving: {
    manageKey: "giving.manage",
    ownModule: "giving",
    templateKeys: ["treasurer", "giving_recorder"],
    grantReason: "giving team",
  },
  reimbursement: {
    manageKey: "reimbursement.manage",
    ownModule: "reimbursement",
    templateKeys: ["treasurer", "reimbursement_clerk"],
    grantReason: "reimbursement team",
  },
};

/** `in (...)` list over the closed module set; bound parameters, not interpolation. */
const MODULES_IN: SQL = sql.join(
  TREASURY_MODULES.map((m) => sql`${m}`),
  sql`, `,
);

interface RoleFacts {
  id: string;
  key: string;
  name: string;
  deactivated: boolean;
  permissionKeys: string[];
  /** Non-empty AND every key's module is in TREASURY_MODULES. */
  treasuryOnly: boolean;
  /** Carries at least one key of the surface's own module. */
  hasOwnKey: boolean;
}

/** The org-owned role `roleId`, with its keys and whether it is treasury-only. */
async function readRole(
  tx: OrgTx,
  organizationId: string,
  roleId: string,
  ownModule: TreasuryModule,
): Promise<RoleFacts | null> {
  const row = rowsOf(
    await tx.execute(sql`
      select r.id, r.key, r.name, (r.deactivated_at is not null) as deactivated,
             coalesce(array_agg(arp.permission_key order by arp.permission_key)
                      filter (where arp.permission_key is not null), '{}') as keys,
             coalesce(bool_and(pm.module in (${MODULES_IN})) filter (where arp.permission_key is not null), false) as all_treasury,
             coalesce(bool_or(pm.module = ${ownModule}), false) as has_own
        from app_roles r
        left join app_role_permissions arp on arp.role_id = r.id
        left join permissions pm on pm.key = arp.permission_key
       where r.id = ${roleId}::uuid and r.organization_id = ${organizationId}::uuid
       group by r.id
    `),
  )[0];
  if (!row) return null;
  const keys = (row.keys as string[]) ?? [];
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    deactivated: row.deactivated === true,
    permissionKeys: keys,
    treasuryOnly: keys.length > 0 && row.all_treasury === true,
    hasOwnKey: row.has_own === true,
  };
}

async function holdsManage(
  tx: OrgTx,
  surface: TeamSurface,
  actorPersonId: string,
  organizationId: string,
): Promise<boolean> {
  const [held] = await holdsPermissions(tx, { personId: actorPersonId, organizationId }, [
    TEAM_SURFACES[surface].manageKey,
  ]);
  return held === true;
}

// ---------------------------------------------------------------------------
// listTreasuryTeam
// ---------------------------------------------------------------------------

export interface TreasuryTeamGrant {
  grantId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  grantee:
    | { kind: "person"; personId: string; displayName: string }
    | { kind: "group"; groupName: string };
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  /** The role's keys in this surface's own module. */
  ownKeys: string[];
  /** False when the role carries non-treasury keys or the grant is group-arm: end it under Roles. */
  endableHere: boolean;
}

export interface TreasuryTeamRole {
  id: string;
  key: string;
  name: string;
  ownKeys: string[];
}

export type ListTreasuryTeamResult =
  | {
      kind: "ok";
      grants: TreasuryTeamGrant[];
      /** Active, org-owned, treasury-only roles with a key of this surface's module. */
      assignableRoles: TreasuryTeamRole[];
      /** Current members a role can be granted to (names only). */
      people: Array<{ personId: string; displayName: string }>;
      /** The surface's template roles this org has no assignable role for. */
      missingTemplates: string[];
    }
  | { kind: "forbidden" };

export async function listTreasuryTeam(
  surface: TeamSurface,
  personId: string,
  organizationId: string,
): Promise<ListTreasuryTeamResult> {
  const spec = TEAM_SURFACES[surface];
  return withOrgContext(personId, organizationId, async (tx) => {
    if (!(await holdsManage(tx, surface, personId, organizationId))) return { kind: "forbidden" };

    const grantRows = rowsOf(
      await tx.execute(sql`
        select rg.id as grant_id, r.id as role_id, r.key as role_key, r.name as role_name,
               rg.person_id, rg.group_id, rg.starts_on::text as starts_on,
               btrim(concat_ws(' ', coalesce(nullif(p.preferred_name, ''), p.first_name), p.last_name)) as person_name,
               g.name as group_name,
               (select array_agg(arp.permission_key order by arp.permission_key)
                  from app_role_permissions arp join permissions pm on pm.key = arp.permission_key
                 where arp.role_id = r.id and pm.module = ${spec.ownModule}) as own_keys,
               not exists (select 1 from app_role_permissions arp2 join permissions pm2 on pm2.key = arp2.permission_key
                            where arp2.role_id = r.id and pm2.module not in (${MODULES_IN})) as only_treasury
          from role_grants rg
          join app_roles r on r.id = rg.role_id and r.organization_id = rg.organization_id
          left join people p on p.id = rg.person_id
          left join groups g on g.id = rg.group_id and g.organization_id = rg.organization_id
         where rg.organization_id = ${organizationId}::uuid
           and rg.starts_on <= current_date and (rg.ends_on is null or rg.ends_on > current_date)
           and exists (select 1 from app_role_permissions a3 join permissions p3 on p3.key = a3.permission_key
                        where a3.role_id = r.id and p3.module = ${spec.ownModule})
         order by lower(coalesce(p.last_name, g.name)), rg.id
      `),
    );
    const grants = grantRows.map(
      (r): TreasuryTeamGrant => ({
        grantId: String(r.grant_id),
        roleId: String(r.role_id),
        roleKey: String(r.role_key),
        roleName: String(r.role_name),
        grantee: r.person_id
          ? { kind: "person", personId: String(r.person_id), displayName: String(r.person_name) }
          : { kind: "group", groupName: String(r.group_name ?? "A group") },
        startsOn: String(r.starts_on),
        ownKeys: (r.own_keys as string[] | null) ?? [],
        endableHere: Boolean(r.person_id) && r.only_treasury === true,
      }),
    );

    const roleRows = rowsOf(
      await tx.execute(sql`
        select r.id, r.key, r.name,
               array_agg(arp.permission_key order by arp.permission_key)
                 filter (where pm.module = ${spec.ownModule}) as own_keys
          from app_roles r
          join app_role_permissions arp on arp.role_id = r.id
          join permissions pm on pm.key = arp.permission_key
         where r.organization_id = ${organizationId}::uuid and r.deactivated_at is null
         group by r.id
        having bool_and(pm.module in (${MODULES_IN})) and bool_or(pm.module = ${spec.ownModule})
         order by lower(r.name)
      `),
    );
    const assignableRoles = roleRows.map(
      (r): TreasuryTeamRole => ({
        id: String(r.id),
        key: String(r.key),
        name: String(r.name),
        ownKeys: (r.own_keys as string[]) ?? [],
      }),
    );

    const peopleRows = rowsOf(
      await tx.execute(sql`
        select p.id, btrim(concat_ws(' ', coalesce(nullif(p.preferred_name, ''), p.first_name), p.last_name)) as display_name
          from memberships m join people p on p.id = m.person_id and p.merged_into_id is null
         where m.organization_id = ${organizationId}::uuid and m.ended_on is null
         order by lower(p.last_name), lower(p.first_name), p.id
      `),
    );

    const have = new Set(assignableRoles.map((r) => r.key));
    return {
      kind: "ok",
      grants,
      assignableRoles,
      people: peopleRows.map((r) => ({ personId: String(r.id), displayName: String(r.display_name) })),
      missingTemplates: spec.templateKeys.filter((k) => !have.has(k)),
    };
  });
}

// ---------------------------------------------------------------------------
// grantTreasuryRole
// ---------------------------------------------------------------------------

export type GrantTreasuryRoleResult =
  | { kind: "ok"; grantId: string; roleKey: string; roleName: string }
  | { kind: "forbidden" }
  /** Not an org-owned, active role of this organization. */
  | { kind: "invalid_role" }
  /** No current membership here. */
  | { kind: "invalid_target" }
  /** Empty, or carries a key outside the treasury modules: use Roles instead. */
  | { kind: "not_treasury_only" }
  | { kind: "escalation_denied"; missingPermissions: string[] }
  | { kind: "already_granted" };

export async function grantTreasuryRole(
  surface: TeamSurface,
  actorPersonId: string,
  organizationId: string,
  actorUserId: string,
  input: { roleId: string; personId: string },
): Promise<GrantTreasuryRoleResult> {
  const spec = TEAM_SURFACES[surface];
  return withOrgContext(actorPersonId, organizationId, async (tx) => {
    // 0. gate
    if (!(await holdsManage(tx, surface, actorPersonId, organizationId))) return { kind: "forbidden" };

    // 1. the role
    const role = await readRole(tx, organizationId, input.roleId, spec.ownModule);
    if (!role || role.deactivated) return { kind: "invalid_role" };
    if (!role.treasuryOnly) return { kind: "not_treasury_only" };
    // A role with none of this surface's keys is another surface's to grant: the
    // gate above is THIS surface's manage key, so honoring it here would let a
    // holder of one manage key hand out the other module's roles.
    if (!role.hasOwnKey) return { kind: "invalid_role" };

    // 2. the target (person-arm only: there is no group parameter at all)
    const member = rowsOf(
      await tx.execute(sql`
        select 1 from memberships m join people p on p.id = m.person_id and p.merged_into_id is null
         where m.person_id = ${input.personId}::uuid and m.organization_id = ${organizationId}::uuid
           and m.ended_on is null
      `),
    )[0];
    if (!member) return { kind: "invalid_target" };

    // 3. DECISION-068's subset check, unchanged
    const subset = await assertPermissionSubset(tx, actorPersonId, organizationId, role.permissionKeys);
    if (!subset.ok) return { kind: "escalation_denied", missingPermissions: subset.missingPermissions };

    // A second, identical, still-effective grant is a no-op the caller should hear about.
    const existing = rowsOf(
      await tx.execute(sql`
        select 1 from role_grants
         where organization_id = ${organizationId}::uuid and role_id = ${input.roleId}::uuid
           and person_id = ${input.personId}::uuid
           and starts_on <= current_date and (ends_on is null or ends_on > current_date)
      `),
    )[0];
    if (existing) return { kind: "already_granted" };

    // 4. the write
    const inserted = rowsOf(
      await tx.execute(sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by, grant_reason)
        values (${organizationId}::uuid, ${input.roleId}::uuid, ${input.personId}::uuid, current_date,
                ${actorUserId}::uuid, ${spec.grantReason})
        returning id
      `),
    )[0]!;
    return { kind: "ok", grantId: String(inserted.id), roleKey: role.key, roleName: role.name };
  });
}

// ---------------------------------------------------------------------------
// revokeTreasuryRole
// ---------------------------------------------------------------------------

export type RevokeTreasuryRoleResult =
  | { kind: "ok"; roleId: string; roleKey: string; personId: string }
  | { kind: "forbidden" }
  /** No such effective grant at this organization. */
  | { kind: "not_found" }
  /** A group-arm grant, or a role with non-treasury keys: end it under Roles. */
  | { kind: "not_treasury_only" }
  /** Would leave the organization with no effective holder of this surface's manage key. */
  | { kind: "last_manager_blocked" };

export async function revokeTreasuryRole(
  surface: TeamSurface,
  actorPersonId: string,
  organizationId: string,
  input: { grantId: string },
): Promise<RevokeTreasuryRoleResult> {
  const { manageKey, ownModule } = TEAM_SURFACES[surface];
  return withOrgContext(actorPersonId, organizationId, async (tx) => {
    if (!(await holdsManage(tx, surface, actorPersonId, organizationId))) return { kind: "forbidden" };

    const grant = rowsOf(
      await tx.execute(sql`
        select id, role_id, person_id, group_id from role_grants
         where id = ${input.grantId}::uuid and organization_id = ${organizationId}::uuid
           and starts_on <= current_date and (ends_on is null or ends_on > current_date)
         for update
      `),
    )[0];
    if (!grant) return { kind: "not_found" };
    if (!grant.person_id) return { kind: "not_treasury_only" };

    const role = await readRole(tx, organizationId, String(grant.role_id), ownModule);
    if (!role) return { kind: "not_found" };
    if (!role.treasuryOnly) return { kind: "not_treasury_only" };
    // Not a grant of this surface (it is never listed here): same answer as a missing one.
    if (!role.hasOwnKey) return { kind: "not_found" };

    if (role.permissionKeys.includes(manageKey)) {
      const others = rowsOf(
        await tx.execute(sql`
          with manage_grants as (
            select rg.id, rg.person_id, rg.group_id
              from role_grants rg join app_role_permissions arp on arp.role_id = rg.role_id
             where rg.organization_id = ${organizationId}::uuid and arp.permission_key = ${manageKey}
               and rg.id <> ${input.grantId}::uuid
               and rg.starts_on <= current_date and (rg.ends_on is null or rg.ends_on > current_date)
          ),
          holders as (
            select mg.person_id as pid from manage_grants mg where mg.person_id is not null
            union
            select gm.person_id from manage_grants mg
              join group_memberships gm on gm.group_id = mg.group_id
             where mg.group_id is not null and gm.organization_id = ${organizationId}::uuid
               and gm.starts_on <= current_date and (gm.ends_on is null or gm.ends_on > current_date)
          )
          select count(distinct h.pid)::int as n
            from holders h
            join people p on p.id = h.pid and p.merged_into_id is null
            join memberships m on m.person_id = h.pid and m.organization_id = ${organizationId}::uuid
             and m.ended_on is null
        `),
      )[0];
      if (Number(others?.n ?? 0) === 0) return { kind: "last_manager_blocked" };
    }

    await tx.execute(sql`update role_grants set ends_on = current_date where id = ${input.grantId}::uuid`);
    return {
      kind: "ok",
      roleId: role.id,
      roleKey: role.key,
      personId: String(grant.person_id),
    };
  });
}

// ---------------------------------------------------------------------------
// ensureTreasuryRole (P3-18)
// ---------------------------------------------------------------------------

export type EnsureTreasuryRoleResult =
  | {
      kind: "ok";
      roleId: string;
      roleKey: string;
      templateRoleId: string;
      created: boolean;
      reactivated: boolean;
      /** Template keys added to an existing role (only keys the actor holds). */
      addedKeys: string[];
      /** Template keys the role still lacks because the actor does not hold them. */
      skippedKeys: string[];
    }
  | { kind: "forbidden" }
  | { kind: "template_not_found" }
  /** The org's role of that key carries a key outside the treasury modules. */
  | { kind: "not_treasury_only" }
  /** A NEW role would carry keys the actor does not hold. */
  | { kind: "escalation_denied"; missingPermissions: string[] };

/**
 * Reuse-and-reactivate (F109) the org-owned role built from a surface template,
 * so a deactivated or never-minted role cannot strand delegation: without this,
 * the founding administrator lacks the money keys (so cannot adopt it) and the
 * treasurer lacks `roles.manage` (so cannot either), and no one could re-create
 * the role.
 *
 *   - no org-owned role of that key: create it from the template (kind and
 *     protected flag copied, as the designation does), but only if the actor
 *     holds EVERY template key - a new role cannot carry a key its creator
 *     lacks;
 *   - one exists but is deactivated: reactivate it;
 *   - one exists: add the template's keys it lacks, ADDITIVELY and only those
 *     the actor holds (the rest are reported as `skippedKeys`); never remove a
 *     key and never touch its name.
 * Only the surface's templates are reachable (`templateKey` is a closed list).
 */
export async function ensureTreasuryRole(
  surface: TeamSurface,
  actorPersonId: string,
  organizationId: string,
  input: { templateKey: string },
): Promise<EnsureTreasuryRoleResult> {
  const spec = TEAM_SURFACES[surface];
  if (!spec.templateKeys.includes(input.templateKey)) {
    return { kind: "template_not_found" };
  }
  return withOrgContext(actorPersonId, organizationId, async (tx) => {
    if (!(await holdsManage(tx, surface, actorPersonId, organizationId))) return { kind: "forbidden" };

    const template = rowsOf(
      await tx.execute(sql`
        select r.id, r.key, r.name, r.role_kind, r.is_protected,
               coalesce(array_agg(arp.permission_key order by arp.permission_key)
                        filter (where arp.permission_key is not null), '{}') as keys
          from app_roles r
          left join app_role_permissions arp on arp.role_id = r.id
         where r.organization_id is null and r.key = ${input.templateKey}
           and (r.organization_type_scope is null
                or r.organization_type_scope = (select organization_type from organizations
                                                 where id = ${organizationId}::uuid))
         group by r.id
      `),
    )[0];
    if (!template) return { kind: "template_not_found" };
    const templateKeys = (template.keys as string[]) ?? [];
    if (templateKeys.length === 0) return { kind: "template_not_found" };

    const existing = rowsOf(
      await tx.execute(sql`
        select id from app_roles
         where organization_id = ${organizationId}::uuid and key = ${input.templateKey}
         for update
      `),
    )[0];

    if (!existing) {
      const subset = await assertPermissionSubset(tx, actorPersonId, organizationId, templateKeys);
      if (!subset.ok) return { kind: "escalation_denied", missingPermissions: subset.missingPermissions };
      const created = rowsOf(
        await tx.execute(sql`
          insert into app_roles (organization_id, key, name, role_kind, is_protected)
          values (${organizationId}::uuid, ${input.templateKey}, ${String(template.name)},
                  ${String(template.role_kind)}, ${template.is_protected === true})
          returning id
        `),
      )[0]!;
      const roleId = String(created.id);
      for (const key of templateKeys) {
        await tx.execute(sql`
          insert into app_role_permissions (role_id, permission_key) values (${roleId}::uuid, ${key})
        `);
      }
      return {
        kind: "ok",
        roleId,
        roleKey: input.templateKey,
        templateRoleId: String(template.id),
        created: true,
        reactivated: false,
        addedKeys: templateKeys,
        skippedKeys: [],
      };
    }

    const role = await readRole(tx, organizationId, String(existing.id), spec.ownModule);
    if (!role) return { kind: "template_not_found" };
    // An empty role is fine (nothing outside the treasury modules); a role with
    // a key outside them is not ours to revive.
    if (role.permissionKeys.length > 0 && !role.treasuryOnly) return { kind: "not_treasury_only" };

    const lacking = templateKeys.filter((k) => !role.permissionKeys.includes(k));
    let notHeld: string[] = [];
    if (lacking.length > 0) {
      const subset = await assertPermissionSubset(tx, actorPersonId, organizationId, lacking);
      if (!subset.ok) notHeld = subset.missingPermissions;
    }
    const addable = lacking.filter((k) => !notHeld.includes(k));

    for (const key of addable) {
      await tx.execute(sql`
        insert into app_role_permissions (role_id, permission_key) values (${role.id}::uuid, ${key})
        on conflict do nothing
      `);
    }
    if (role.deactivated) {
      await tx.execute(sql`update app_roles set deactivated_at = null where id = ${role.id}::uuid`);
    }
    return {
      kind: "ok",
      roleId: role.id,
      roleKey: role.key,
      templateRoleId: String(template.id),
      created: false,
      reactivated: role.deactivated,
      addedKeys: addable,
      skippedKeys: notHeld,
    };
  });
}
