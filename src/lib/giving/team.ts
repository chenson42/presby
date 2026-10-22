import "server-only";
import { sql } from "drizzle-orm";
import { assertPermissionSubset, withOrgContext, type OrgTx } from "@/lib/authz";
import { givingKeysInTx } from "./keys";
import { rowsOf } from "./db-util";

/**
 * The giving team - docs/work-log/2026-10-15-online-giving.md, Phase 2 R3
 * (F138, DECISION-170), Phase 3 P3-18 and the Phase 3 API contract "team.ts".
 *
 * WHY THIS MODULE EXISTS. After the platform operator designates the first
 * treasurer (`onboarding/treasurer-designation.ts`), the ordinary tenant paths cannot
 * delegate giving: `adoptTemplate()` needs `roles.manage` and `grantRole()`
 * needs `role_grants.manage`, each ALSO requires the actor to hold every key
 * being delegated - and no one holds both kinds of key (the founding
 * administrator has the first and no giving key; the treasurer the reverse).
 * F138. So a `giving.manage` holder gets a NARROW, AUDITED path of their own,
 * and only for roles made entirely of giving keys.
 *
 * WHAT MAKES IT SAFE (each is a step below, in this order, and each is tested):
 *   0. the actor holds `giving.manage` (one `presby_has_permission` call);
 *   1. the target role is ORG-OWNED, active, non-empty, and EVERY key it carries
 *      has `permissions.module = 'giving'` (`not_giving_only` otherwise - so a
 *      `roles.manage` holder adding a non-giving key to a giving role sends it
 *      back to the ordinary `role_grants.manage` path, never through this one);
 *   2. the target person holds a CURRENT membership here, and the grant is
 *      PERSON-ARM only (a group grant would widen silently when the group's
 *      roster changes);
 *   3. `assertPermissionSubset()` from `@/lib/authz`, called UNCHANGED - the
 *      actor can only hand out giving keys they hold themselves;
 *   4. the write. A revoke ends the grant (`ends_on = current_date`), never
 *      deletes it, and refuses to end the last effective `giving.manage` grant.
 *
 * NOTHING HERE EDITS A ROLE'S DEFINITION beyond `ensureGivingRole` adding the
 * template's own giving keys the actor already holds. The DECISION-106 rule
 * that adding a key to a role needs that key stands: `setRolePermissions()` is
 * untouched, and a test pins that a `roles.manage` holder without
 * `giving.view` still cannot add it to a role.
 *
 * The audit writes (`TENANT_ROLE_GRANTED` / `TENANT_ROLE_REVOKED` with
 * `path: "giving_team"`, `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE`) belong to
 * `team/actions.ts`, after the commit.
 */

export const GIVING_TEMPLATE_KEYS = ["treasurer", "giving_recorder"] as const;
export type GivingTemplateKey = (typeof GIVING_TEMPLATE_KEYS)[number];

const MANAGE = "giving.manage";

interface RoleFacts {
  id: string;
  key: string;
  name: string;
  deactivated: boolean;
  permissionKeys: string[];
  /** Non-empty AND every key's module is 'giving'. */
  givingOnly: boolean;
}

/** The org-owned role `roleId`, with its keys and whether it is giving-only. */
async function readRole(tx: OrgTx, organizationId: string, roleId: string): Promise<RoleFacts | null> {
  const row = rowsOf(
    await tx.execute(sql`
      select r.id, r.key, r.name, (r.deactivated_at is not null) as deactivated,
             coalesce(array_agg(arp.permission_key order by arp.permission_key)
                      filter (where arp.permission_key is not null), '{}') as keys,
             coalesce(bool_and(pm.module = 'giving') filter (where arp.permission_key is not null), false) as all_giving
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
    givingOnly: keys.length > 0 && row.all_giving === true,
  };
}

// ---------------------------------------------------------------------------
// listGivingTeam
// ---------------------------------------------------------------------------

export interface TeamGrant {
  grantId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  grantee:
    | { kind: "person"; personId: string; displayName: string }
    | { kind: "group"; groupName: string };
  /** 'YYYY-MM-DD'. */
  startsOn: string;
  givingKeys: string[];
  /** False when the role carries non-giving keys or the grant is group-arm: end it under Roles. */
  endableHere: boolean;
}

export interface TeamRole {
  id: string;
  key: string;
  name: string;
  givingKeys: string[];
}

export type ListGivingTeamResult =
  | {
      kind: "ok";
      grants: TeamGrant[];
      /** Active, org-owned, giving-only roles a grant can name. */
      assignableRoles: TeamRole[];
      /** Current members a role can be granted to (names only). */
      people: Array<{ personId: string; displayName: string }>;
      /** The giving template roles this org has no active role for. */
      missingTemplates: GivingTemplateKey[];
    }
  | { kind: "forbidden" };

export async function listGivingTeam(
  personId: string,
  organizationId: string,
): Promise<ListGivingTeamResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    const grantRows = rowsOf(
      await tx.execute(sql`
        select rg.id as grant_id, r.id as role_id, r.key as role_key, r.name as role_name,
               rg.person_id, rg.group_id, rg.starts_on::text as starts_on,
               btrim(concat_ws(' ', coalesce(nullif(p.preferred_name, ''), p.first_name), p.last_name)) as person_name,
               g.name as group_name,
               (select array_agg(arp.permission_key order by arp.permission_key)
                  from app_role_permissions arp join permissions pm on pm.key = arp.permission_key
                 where arp.role_id = r.id and pm.module = 'giving') as giving_keys,
               not exists (select 1 from app_role_permissions arp2 join permissions pm2 on pm2.key = arp2.permission_key
                            where arp2.role_id = r.id and pm2.module <> 'giving') as only_giving
          from role_grants rg
          join app_roles r on r.id = rg.role_id and r.organization_id = rg.organization_id
          left join people p on p.id = rg.person_id
          left join groups g on g.id = rg.group_id and g.organization_id = rg.organization_id
         where rg.organization_id = ${organizationId}::uuid
           and rg.starts_on <= current_date and (rg.ends_on is null or rg.ends_on > current_date)
           and exists (select 1 from app_role_permissions a3 join permissions p3 on p3.key = a3.permission_key
                        where a3.role_id = r.id and p3.module = 'giving')
         order by lower(coalesce(p.last_name, g.name)), rg.id
      `),
    );
    const grants = grantRows.map(
      (r): TeamGrant => ({
        grantId: String(r.grant_id),
        roleId: String(r.role_id),
        roleKey: String(r.role_key),
        roleName: String(r.role_name),
        grantee: r.person_id
          ? { kind: "person", personId: String(r.person_id), displayName: String(r.person_name) }
          : { kind: "group", groupName: String(r.group_name ?? "A group") },
        startsOn: String(r.starts_on),
        givingKeys: (r.giving_keys as string[] | null) ?? [],
        endableHere: Boolean(r.person_id) && r.only_giving === true,
      }),
    );

    const roleRows = rowsOf(
      await tx.execute(sql`
        select r.id, r.key, r.name,
               array_agg(arp.permission_key order by arp.permission_key) as keys
          from app_roles r
          join app_role_permissions arp on arp.role_id = r.id
          join permissions pm on pm.key = arp.permission_key
         where r.organization_id = ${organizationId}::uuid and r.deactivated_at is null
         group by r.id
        having bool_and(pm.module = 'giving')
         order by lower(r.name)
      `),
    );
    const assignableRoles = roleRows.map(
      (r): TeamRole => ({
        id: String(r.id),
        key: String(r.key),
        name: String(r.name),
        givingKeys: (r.keys as string[]) ?? [],
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
      missingTemplates: GIVING_TEMPLATE_KEYS.filter((k) => !have.has(k)),
    };
  });
}

// ---------------------------------------------------------------------------
// grantGivingRole
// ---------------------------------------------------------------------------

export type GrantGivingRoleResult =
  | { kind: "ok"; grantId: string; roleKey: string; roleName: string }
  | { kind: "forbidden" }
  /** Not an org-owned, active role of this organization. */
  | { kind: "invalid_role" }
  /** No current membership here. */
  | { kind: "invalid_target" }
  /** Empty, or carries a key outside the giving module: use Roles instead. */
  | { kind: "not_giving_only" }
  | { kind: "escalation_denied"; missingPermissions: string[] }
  | { kind: "already_granted" };

export async function grantGivingRole(
  actorPersonId: string,
  organizationId: string,
  actorUserId: string,
  input: { roleId: string; personId: string },
): Promise<GrantGivingRoleResult> {
  return withOrgContext(actorPersonId, organizationId, async (tx) => {
    // 0. gate
    const has = await givingKeysInTx(tx, { personId: actorPersonId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    // 1. the role
    const role = await readRole(tx, organizationId, input.roleId);
    if (!role || role.deactivated) return { kind: "invalid_role" };
    if (!role.givingOnly) return { kind: "not_giving_only" };

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
                ${actorUserId}::uuid, 'giving team')
        returning id
      `),
    )[0]!;
    return { kind: "ok", grantId: String(inserted.id), roleKey: role.key, roleName: role.name };
  });
}

// ---------------------------------------------------------------------------
// revokeGivingRole
// ---------------------------------------------------------------------------

export type RevokeGivingRoleResult =
  | { kind: "ok"; roleId: string; roleKey: string; personId: string }
  | { kind: "forbidden" }
  /** No such effective grant at this organization. */
  | { kind: "not_found" }
  /** A group-arm grant, or a role with non-giving keys: end it under Roles. */
  | { kind: "not_giving_only" }
  /** Would leave the organization with no effective `giving.manage` holder. */
  | { kind: "last_manager_blocked" };

export async function revokeGivingRole(
  actorPersonId: string,
  organizationId: string,
  input: { grantId: string },
): Promise<RevokeGivingRoleResult> {
  return withOrgContext(actorPersonId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId: actorPersonId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    const grant = rowsOf(
      await tx.execute(sql`
        select id, role_id, person_id, group_id from role_grants
         where id = ${input.grantId}::uuid and organization_id = ${organizationId}::uuid
           and starts_on <= current_date and (ends_on is null or ends_on > current_date)
         for update
      `),
    )[0];
    if (!grant) return { kind: "not_found" };
    if (!grant.person_id) return { kind: "not_giving_only" };

    const role = await readRole(tx, organizationId, String(grant.role_id));
    if (!role) return { kind: "not_found" };
    if (!role.givingOnly) return { kind: "not_giving_only" };

    if (role.permissionKeys.includes(MANAGE)) {
      const others = rowsOf(
        await tx.execute(sql`
          with manage_grants as (
            select rg.id, rg.person_id, rg.group_id
              from role_grants rg join app_role_permissions arp on arp.role_id = rg.role_id
             where rg.organization_id = ${organizationId}::uuid and arp.permission_key = ${MANAGE}
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
// ensureGivingRole (P3-18)
// ---------------------------------------------------------------------------

export type EnsureGivingRoleResult =
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
  /** The org's role of that key carries a key outside the giving module. */
  | { kind: "not_giving_only" }
  /** A NEW role would carry keys the actor does not hold. */
  | { kind: "escalation_denied"; missingPermissions: string[] };

/**
 * Reuse-and-reactivate (F109) the org-owned role built from a giving template,
 * so a deactivated or never-minted `giving_recorder` cannot strand delegation:
 * without this, the founding administrator lacks `giving.record` (so cannot
 * adopt it) and the treasurer lacks `roles.manage` (so cannot either), and no
 * one could re-create the role.
 *
 *   - no org-owned role of that key: create it from the template (kind and
 *     protected flag copied, as the designation does), but only if the actor
 *     holds EVERY template key - a new role cannot carry a key its creator
 *     lacks;
 *   - one exists but is deactivated: reactivate it;
 *   - one exists: add the template's keys it lacks, ADDITIVELY and only those
 *     the actor holds (the rest are reported as `skippedKeys`); never remove a
 *     key and never touch its name.
 * Only the two giving templates are reachable (`templateKey` is a closed enum).
 */
export async function ensureGivingRole(
  actorPersonId: string,
  organizationId: string,
  input: { templateKey: GivingTemplateKey },
): Promise<EnsureGivingRoleResult> {
  if (!(GIVING_TEMPLATE_KEYS as readonly string[]).includes(input.templateKey)) {
    return { kind: "template_not_found" };
  }
  return withOrgContext(actorPersonId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId: actorPersonId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

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

    const role = await readRole(tx, organizationId, String(existing.id));
    if (!role) return { kind: "template_not_found" };
    // An empty role is fine (nothing outside giving); a role with a non-giving key is not ours to revive.
    if (role.permissionKeys.length > 0 && !role.givingOnly) return { kind: "not_giving_only" };

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
