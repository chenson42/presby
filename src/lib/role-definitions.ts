import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  assertPermissionSubset,
  withOrgContext,
  type OrganizationType,
  type OrgTx,
} from "@/lib/authz";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  appRolePermissions,
  appRoles,
  permissions,
} from "@/lib/db/domain/authz";
import { organizations } from "@/lib/db/domain/org";

/**
 * Tenant role *definition* administration —
 * `docs/work-log/2026-08-26-role-permissions-admin.md`, DECISION-106/109.
 * Parallel to, and deliberately NOT folded into, `src/lib/role-grants.ts`:
 * that module governs WHO HOLDS a role (`role_grants`); this one governs
 * WHAT A ROLE CONTAINS (`app_roles`/`app_role_permissions`) — a materially
 * more powerful capability, gated on its own permission (`roles.manage`,
 * distinct from `role_grants.manage`) per DECISION-106 ruling 2.
 *
 * SAME SHAPE AS `role-grants.ts`: one `withOrgContext()` transaction per
 * export, permission check first, thrown exceptions for genuine failure
 * (`OrgAccessError`, unexpected DB errors), typed result variants for every
 * expected/denied outcome.
 *
 * THE CENTRAL FINDING THIS MODULE CLOSES (Phase 1, gap 1): before this,
 * nothing stopped an admin holding `roles.manage` from editing a role they
 * already hold to add a tier-3 permission — no `role_grants` row was ever
 * inserted for that path, so DECISION-068's escalation check (built for
 * `grantRole()`) never ran. Every write here that changes what a role can
 * do — `createRole`, `setRolePermissions`, `adoptTemplate` — now runs
 * `assertPermissionSubset()` (DECISION-106 ruling 1, extracted to
 * `src/lib/authz.ts` so both modules share the same posture):
 *   - `createRole`/`adoptTemplate` check the FULL proposed permission set —
 *     there is no prior state to diff against.
 *   - `setRolePermissions` checks only the ADDED DELTA. A pure permission
 *     REMOVAL has an empty delta, which `assertPermissionSubset()` passes
 *     trivially — removing a permission can never escalate anyone.
 *
 * THE DEFINITION-SIDE SELF-LOCKOUT GUARD (Phase 3 Edge Cases, DECISION-109
 * finding 4): a custom role can carry `roles.manage` the same as any other
 * permission. `setRolePermissions()` (removing it) and `deactivateRole()`
 * (deactivating a role that carries it) both run the SAME conceptual
 * holder-count guard `role-grants.ts`'s `revokeRole()` already runs for
 * `role_grants.manage` (finding 6 there) — generalized to key on
 * `roles.manage` and to exclude every grant of the ROLE BEING CHANGED
 * (`wouldZeroOutRolesManageHolders`, private below), not a single grant id,
 * since a definition-side edit can affect every holder of that role at
 * once, not just one grant. This is a parallel implementation of the SAME
 * SQL shape, not a divergent one — see that helper's own comment for the
 * one-line diff between the two.
 *
 * DEACTIVATION ENDS LIVE GRANTS IN THE SAME TRANSACTION (DECISION-109
 * finding 3): `presby_effective_permissions()` has no `deactivated_at`
 * awareness, so `deactivateRole()` also ends every currently-effective
 * `role_grants` row pointing at the role (`ends_on = current_date`, the
 * same non-destructive mechanism `revokeRole()` uses) — never a bare column
 * write on its own, which would be cosmetic.
 *
 * `isProtected` IS THE GATE, NOT `role_kind` (DECISION-106 ruling 5):
 * `role_kind` is a descriptive label; `isProtected` is the column the schema
 * was actually built to gate mutation on. Constitutional roles — including
 * `role_admin` itself — are never editable or deactivatable through this
 * module, checked BEFORE the escalation/lockout checks run.
 */

const ROLES_MANAGE = "roles.manage";
const KEY_RE = /^[a-z][a-z0-9_]{0,49}$/;

/**
 * The single-permission gate every exported function in this module checks
 * FIRST, mirroring `role-grants.ts`'s `hasRoleGrantsManage` — deliberately
 * not shared code between the two (each module names its own one
 * permission, `role_grants.manage` there, `roles.manage` here), but the same
 * `presby_has_permission()` shape.
 */
async function hasRolesManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${ROLES_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

/** Every `app_role_permissions` key currently bound to `roleId`. */
async function permissionKeysForRole(
  tx: OrgTx,
  roleId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ permissionKey: appRolePermissions.permissionKey })
    .from(appRolePermissions)
    .where(eq(appRolePermissions.roleId, roleId));
  return rows.map((r) => r.permissionKey);
}

/**
 * How many DISTINCT people currently hold `roleId` at `organizationId` —
 * person-arm grants directly, group-arm grants expanded through their live
 * (non-ended) `group_memberships`. Same "currently effective" window every
 * other holder-count query in this codebase uses (`starts_on <= current_date
 * and (ends_on is null or ends_on > current_date)`).
 *
 * Used for `RoleDefinitionEntry.holderCount` (the roles list / edit page's
 * "N people currently hold this role" copy) — read fresh at call time, never
 * cached, per the Phase 3 Edge Cases note that this must never be trusted
 * from an earlier render.
 */
async function roleHolderCount(
  tx: OrgTx,
  organizationId: string,
  roleId: string,
): Promise<number> {
  const result = await tx.execute(sql`
    with active_grants as (
      select rg.id as grant_id, rg.person_id, rg.group_id
        from role_grants rg
       where rg.organization_id = ${organizationId}::uuid
         and rg.role_id = ${roleId}::uuid
         and rg.starts_on <= current_date
         and (rg.ends_on is null or rg.ends_on > current_date)
    ),
    holder_people as (
      select person_id as pid from active_grants where person_id is not null
      union
      select gm.person_id as pid
        from active_grants ag
        join group_memberships gm on gm.group_id = ag.group_id
       where ag.group_id is not null
         and gm.organization_id = ${organizationId}::uuid
         and gm.ends_on is null
    )
    select count(distinct pid)::int as holder_count from holder_people
  `);
  return (
    (result as unknown as { rows?: Array<{ holder_count?: number }> }).rows?.[0]
      ?.holder_count ?? 0
  );
}

/**
 * The definition-side self-lockout guard (DECISION-109 finding 4). Same CTE
 * shape as `role-grants.ts`'s `revokeRole()` lockout query (that module's
 * finding 6), parameterized differently in exactly two respects:
 *   - keyed on `roles.manage`, not `role_grants.manage`.
 *   - excludes every grant of `excludeRoleId` (the role being edited or
 *     deactivated) rather than one specific grant id — a definition-side
 *     edit changes what ALL of that role's holders can do at once, not one
 *     grant.
 *
 * Returns `true` when removing/deactivating `roles.manage` from
 * `excludeRoleId` would leave zero OTHER currently-effective `roles.manage`
 * holders at this organization.
 */
async function wouldZeroOutRolesManageHolders(
  tx: OrgTx,
  organizationId: string,
  excludeRoleId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    with active_manage_grants as (
      select rg.id as grant_id, rg.person_id, rg.group_id
        from role_grants rg
        join app_role_permissions arp on arp.role_id = rg.role_id
       where rg.organization_id = ${organizationId}::uuid
         and arp.permission_key = ${ROLES_MANAGE}
         and rg.role_id != ${excludeRoleId}::uuid
         and rg.starts_on <= current_date
         and (rg.ends_on is null or rg.ends_on > current_date)
    ),
    holder_people as (
      select person_id as pid from active_manage_grants where person_id is not null
      union
      select gm.person_id as pid
        from active_manage_grants amg
        join group_memberships gm on gm.group_id = amg.group_id
       where amg.group_id is not null
         and gm.organization_id = ${organizationId}::uuid
         and gm.ends_on is null
    )
    select count(distinct pid)::int as holder_count from holder_people
  `);
  const holderCount =
    (result as unknown as { rows?: Array<{ holder_count?: number }> })
      .rows?.[0]?.holder_count ?? 0;
  return holderCount === 0;
}

/**
 * `key`: `/^[a-z][a-z0-9_]{0,49}$/`, checked as-given (not trimmed — the
 * format itself rejects surrounding whitespace). `name`: trimmed, then
 * 1–100 characters. Phase 1 gap 5 / Phase 3 Edge Cases.
 */
function validateKeyAndName(
  key: string,
  rawName: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  if (!KEY_RE.test(key)) {
    return {
      ok: false,
      reason:
        "Key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores (max 50 characters).",
    };
  }
  const name = rawName.trim();
  if (name.length < 1 || name.length > 100) {
    return { ok: false, reason: "Name must be between 1 and 100 characters." };
  }
  return { ok: true, name };
}

/**
 * Resolves the organization's own type, for matching template
 * `organization_type_scope` (see `listTemplateRoles`/`adoptTemplate`).
 * A plain, already-org-scoped read inside the caller's transaction.
 */
async function resolveOrganizationType(
  tx: OrgTx,
  organizationId: string,
): Promise<OrganizationType | undefined> {
  const [row] = await tx
    .select({ organizationType: organizations.organizationType })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.organizationType;
}

// ---------------------------------------------------------------------------
// listPermissionCatalog
// ---------------------------------------------------------------------------

export interface PermissionCatalogEntry {
  key: string;
  module: string;
  description: string;
  sensitivityTier: number;
}

/**
 * Plain read of the global `permissions` table — no org scoping (the table
 * carries no `organization_id`, and RLS grants a bare `select` to
 * `presby_app`, no policy at all). Powers the tier-grouped checklist on both
 * the create and edit forms.
 */
export async function listPermissionCatalog(): Promise<
  PermissionCatalogEntry[]
> {
  const rows = await db
    .select({
      key: permissions.key,
      module: permissions.module,
      description: permissions.description,
      sensitivityTier: permissions.sensitivityTier,
    })
    .from(permissions)
    .orderBy(permissions.sensitivityTier, permissions.module, permissions.key);
  return rows;
}

// ---------------------------------------------------------------------------
// listRoleDefinitions / getRoleDefinition
// ---------------------------------------------------------------------------

export interface RoleDefinitionEntry {
  id: string;
  key: string;
  name: string;
  roleKind: string;
  isProtected: boolean;
  deactivatedAt: string | null;
  permissionKeys: string[];
  holderCount: number;
}

export type RoleDefinitionsListResult =
  | { kind: "ok"; roles: RoleDefinitionEntry[] }
  | { kind: "forbidden" };

/**
 * This organization's OWN `app_roles` rows only (`organization_id` = this
 * org) — never the `organization_id IS NULL` template catalog, which is a
 * separate read (`listTemplateRoles`).
 */
export async function listRoleDefinitions(
  viewerPersonId: string,
  organizationId: string,
): Promise<RoleDefinitionsListResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasRolesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const roleRows = await tx
      .select({
        id: appRoles.id,
        key: appRoles.key,
        name: appRoles.name,
        roleKind: appRoles.roleKind,
        isProtected: appRoles.isProtected,
        deactivatedAt: appRoles.deactivatedAt,
      })
      .from(appRoles)
      .where(eq(appRoles.organizationId, organizationId))
      .orderBy(appRoles.name);

    const roles: RoleDefinitionEntry[] = [];
    for (const row of roleRows) {
      const permissionKeys = await permissionKeysForRole(tx, row.id);
      const holderCount = await roleHolderCount(tx, organizationId, row.id);
      roles.push({
        id: row.id,
        key: row.key,
        name: row.name,
        roleKind: row.roleKind,
        isProtected: row.isProtected,
        deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : null,
        permissionKeys,
        holderCount,
      });
    }

    return { kind: "ok", roles };
  });
}

export type RoleDefinitionResult =
  | { kind: "ok"; role: RoleDefinitionEntry }
  | { kind: "forbidden" }
  | { kind: "not_found" };

export async function getRoleDefinition(
  viewerPersonId: string,
  organizationId: string,
  roleId: string,
): Promise<RoleDefinitionResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasRolesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .select({
        id: appRoles.id,
        key: appRoles.key,
        name: appRoles.name,
        roleKind: appRoles.roleKind,
        isProtected: appRoles.isProtected,
        deactivatedAt: appRoles.deactivatedAt,
      })
      .from(appRoles)
      .where(
        and(eq(appRoles.id, roleId), eq(appRoles.organizationId, organizationId)),
      )
      .limit(1);
    if (!row) {
      return { kind: "not_found" };
    }

    const permissionKeys = await permissionKeysForRole(tx, row.id);
    const holderCount = await roleHolderCount(tx, organizationId, row.id);

    return {
      kind: "ok",
      role: {
        id: row.id,
        key: row.key,
        name: row.name,
        roleKind: row.roleKind,
        isProtected: row.isProtected,
        deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : null,
        permissionKeys,
        holderCount,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// listTemplateRoles
// ---------------------------------------------------------------------------

export interface TemplateRoleEntry {
  id: string;
  key: string;
  name: string;
  permissionKeys: string[];
}

/**
 * `organization_id IS NULL` rows where `organization_type_scope IS NULL` OR
 * matches this org's own type. Requires the `app_roles` RLS split landed in
 * `drizzle/0032_presby_role_definitions.sql` (database-admin's Phase 4
 * commit 1) — without it, `organization_id IS NULL` rows are structurally
 * invisible to `presby_app` under any org context, and this always returns
 * an empty list, never an error (a widened-`SELECT` gap, not a query bug).
 */
export async function listTemplateRoles(
  viewerPersonId: string,
  organizationId: string,
): Promise<
  { kind: "ok"; templates: TemplateRoleEntry[] } | { kind: "forbidden" }
> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasRolesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const organizationType = await resolveOrganizationType(tx, organizationId);

    const templateRows = await tx
      .select({ id: appRoles.id, key: appRoles.key, name: appRoles.name })
      .from(appRoles)
      .where(
        and(
          isNull(appRoles.organizationId),
          organizationType
            ? or(
                isNull(appRoles.organizationTypeScope),
                eq(appRoles.organizationTypeScope, organizationType),
              )
            : isNull(appRoles.organizationTypeScope),
        ),
      )
      .orderBy(appRoles.name);

    const templates: TemplateRoleEntry[] = [];
    for (const row of templateRows) {
      const permissionKeys = await permissionKeysForRole(tx, row.id);
      templates.push({
        id: row.id,
        key: row.key,
        name: row.name,
        permissionKeys,
      });
    }

    return { kind: "ok", templates };
  });
}

// ---------------------------------------------------------------------------
// createRole
// ---------------------------------------------------------------------------

export type CreateRoleResult =
  | { kind: "ok"; roleId: string; roleKey: string }
  | { kind: "forbidden" }
  | { kind: "escalation_denied"; missingPermissions: string[] }
  | { kind: "duplicate_key" }
  | { kind: "invalid_input"; reason: string };

/**
 * Gate → validate key/name → `assertPermissionSubset()` with the FULL
 * proposed permission set (this is a brand-new role — delta === full set) →
 * insert `app_roles` (`role_kind: 'custom'`, `is_protected: false`) +
 * `app_role_permissions` rows, one transaction. Unique-violation on
 * `(organization_id, key)` caught and returned as `duplicate_key`, never
 * thrown — the `try`/`catch` wraps the WHOLE `withOrgContext()` call (not a
 * block inside it), the same shape `org-provisioning.ts`'s
 * `createOrganization()` uses: once a statement inside a Postgres
 * transaction errors, the transaction is aborted and no further query on
 * that same `tx` is possible, so the only correct place to inspect the
 * error is after the transaction has already unwound.
 */
export async function createRole(
  actorPersonId: string,
  organizationId: string,
  input: { key: string; name: string; permissionKeys: string[] },
): Promise<CreateRoleResult> {
  try {
    return await withOrgContext(actorPersonId, organizationId, async (tx) => {
      if (!(await hasRolesManage(tx, actorPersonId, organizationId))) {
        return { kind: "forbidden" };
      }

      const validation = validateKeyAndName(input.key, input.name);
      if (!validation.ok) {
        return { kind: "invalid_input", reason: validation.reason };
      }

      const subsetCheck = await assertPermissionSubset(
        tx,
        actorPersonId,
        organizationId,
        input.permissionKeys,
      );
      if (!subsetCheck.ok) {
        return {
          kind: "escalation_denied",
          missingPermissions: subsetCheck.missingPermissions,
        };
      }

      const [inserted] = await tx
        .insert(appRoles)
        .values({
          organizationId,
          key: input.key,
          name: validation.name,
          roleKind: "custom",
          isProtected: false,
        })
        .returning({ id: appRoles.id });
      const roleId = inserted!.id;

      if (input.permissionKeys.length > 0) {
        await tx.insert(appRolePermissions).values(
          input.permissionKeys.map((permissionKey) => ({
            roleId,
            permissionKey,
          })),
        );
      }

      return { kind: "ok", roleId, roleKey: input.key };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { kind: "duplicate_key" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// setRolePermissions
// ---------------------------------------------------------------------------

export type SetRolePermissionsResult =
  | { kind: "ok"; addedKeys: string[]; removedKeys: string[]; holderCount: number }
  | { kind: "forbidden" }
  | { kind: "protected_role" }
  | { kind: "not_found" }
  | { kind: "escalation_denied"; missingPermissions: string[] }
  | { kind: "self_lockout_blocked" };

/**
 * Gate → load role scoped to this org (`not_found` if missing or belonging
 * to another org) → `protected_role` if `is_protected` (gates on
 * `isProtected`, NOT `role_kind` — DECISION-106 ruling 5) BEFORE either
 * check below runs → diff `newPermissionKeys` against the role's current
 * `app_role_permissions` → `assertPermissionSubset()` on the ADDED DELTA
 * ONLY, never the full resulting set → if this role currently carries
 * `roles.manage` AND the new set does not, run the definition-side lockout
 * guard and refuse (writing nothing) if it would zero out this org's
 * `roles.manage` holders → diff-apply `app_role_permissions` → return
 * `addedKeys`/`removedKeys`/`holderCount`, the last read BEFORE the write
 * (for the audit event and the "N people currently hold this role" UI copy
 * — never trusted from an earlier render).
 */
export async function setRolePermissions(
  actorPersonId: string,
  organizationId: string,
  roleId: string,
  newPermissionKeys: string[],
): Promise<SetRolePermissionsResult> {
  return withOrgContext(actorPersonId, organizationId, async (tx) => {
    if (!(await hasRolesManage(tx, actorPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [role] = await tx
      .select({ id: appRoles.id, isProtected: appRoles.isProtected })
      .from(appRoles)
      .where(
        and(eq(appRoles.id, roleId), eq(appRoles.organizationId, organizationId)),
      )
      .limit(1);
    if (!role) {
      return { kind: "not_found" };
    }
    if (role.isProtected) {
      return { kind: "protected_role" };
    }

    const oldKeys = await permissionKeysForRole(tx, roleId);
    const oldKeySet = new Set(oldKeys);
    const newKeySet = new Set(newPermissionKeys);

    const addedKeys = newPermissionKeys.filter((key) => !oldKeySet.has(key));
    const removedKeys = oldKeys.filter((key) => !newKeySet.has(key));

    const subsetCheck = await assertPermissionSubset(
      tx,
      actorPersonId,
      organizationId,
      addedKeys,
    );
    if (!subsetCheck.ok) {
      return {
        kind: "escalation_denied",
        missingPermissions: subsetCheck.missingPermissions,
      };
    }

    // Read fresh, BEFORE the write — never trusted from an earlier render.
    const holderCount = await roleHolderCount(tx, organizationId, roleId);

    const hadRolesManage = oldKeySet.has(ROLES_MANAGE);
    const willHaveRolesManage = newKeySet.has(ROLES_MANAGE);
    if (hadRolesManage && !willHaveRolesManage) {
      const wouldZeroOut = await wouldZeroOutRolesManageHolders(
        tx,
        organizationId,
        roleId,
      );
      if (wouldZeroOut) {
        return { kind: "self_lockout_blocked" };
      }
    }

    if (removedKeys.length > 0) {
      await tx
        .delete(appRolePermissions)
        .where(
          and(
            eq(appRolePermissions.roleId, roleId),
            inArray(appRolePermissions.permissionKey, removedKeys),
          ),
        );
    }
    if (addedKeys.length > 0) {
      await tx.insert(appRolePermissions).values(
        addedKeys.map((permissionKey) => ({ roleId, permissionKey })),
      );
    }

    return { kind: "ok", addedKeys, removedKeys, holderCount };
  });
}

// ---------------------------------------------------------------------------
// deactivateRole
// ---------------------------------------------------------------------------

export type DeactivateRoleResult =
  | { kind: "ok"; endedGrantCount: number }
  | { kind: "forbidden" }
  | { kind: "protected_role" }
  | { kind: "not_found" }
  | { kind: "already_deactivated" }
  | { kind: "self_lockout_blocked" };

/**
 * Gate → load role scoped to this org (`not_found`) → `protected_role` if
 * `is_protected` (constitutional roles, including `role_admin` itself, are
 * never deactivatable through this UI) → `already_deactivated` if
 * `deactivated_at` is already set → if this role carries `roles.manage`,
 * the same lockout guard `setRolePermissions` runs → in ONE transaction:
 * set `deactivated_at = now()` AND end every currently-effective
 * `role_grants` row pointing at this role (`ends_on = current_date`, the
 * same non-destructive mechanism `revokeRole()` uses) — required, not
 * optional polish, since `presby_effective_permissions()` has no
 * `deactivated_at` awareness (DECISION-109 finding 3). Returns
 * `endedGrantCount` for the audit event and the UI's confirmation copy.
 */
export async function deactivateRole(
  actorPersonId: string,
  organizationId: string,
  roleId: string,
): Promise<DeactivateRoleResult> {
  return withOrgContext(actorPersonId, organizationId, async (tx) => {
    if (!(await hasRolesManage(tx, actorPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [role] = await tx
      .select({
        id: appRoles.id,
        isProtected: appRoles.isProtected,
        deactivatedAt: appRoles.deactivatedAt,
      })
      .from(appRoles)
      .where(
        and(eq(appRoles.id, roleId), eq(appRoles.organizationId, organizationId)),
      )
      .limit(1);
    if (!role) {
      return { kind: "not_found" };
    }
    if (role.isProtected) {
      return { kind: "protected_role" };
    }
    if (role.deactivatedAt !== null) {
      return { kind: "already_deactivated" };
    }

    const permissionKeys = await permissionKeysForRole(tx, roleId);
    if (permissionKeys.includes(ROLES_MANAGE)) {
      const wouldZeroOut = await wouldZeroOutRolesManageHolders(
        tx,
        organizationId,
        roleId,
      );
      if (wouldZeroOut) {
        return { kind: "self_lockout_blocked" };
      }
    }

    await tx
      .update(appRoles)
      .set({ deactivatedAt: new Date() })
      .where(eq(appRoles.id, roleId));

    const endedResult = await tx.execute(sql`
      update role_grants
         set ends_on = current_date
       where organization_id = ${organizationId}::uuid
         and role_id = ${roleId}::uuid
         and starts_on <= current_date
         and (ends_on is null or ends_on > current_date)
      returning id
    `);
    const endedGrantCount =
      (endedResult as unknown as { rows?: Array<{ id: string }> }).rows
        ?.length ?? 0;

    return { kind: "ok", endedGrantCount };
  });
}

// ---------------------------------------------------------------------------
// adoptTemplate
// ---------------------------------------------------------------------------

export type AdoptTemplateResult =
  | { kind: "ok"; roleId: string; roleKey: string; templateKey: string }
  | { kind: "forbidden" }
  | { kind: "template_not_found" }
  | { kind: "escalation_denied"; missingPermissions: string[] }
  | { kind: "duplicate_key" }
  | { kind: "invalid_input"; reason: string };

/**
 * Gate → load the template row (`organization_id IS NULL`, type-scope
 * matches or NULL) → reads its permission set → `assertPermissionSubset()`
 * on the FULL template permission set (DECISION-106's note: a cloned role's
 * permissions are not exempt from the subset check just because the source
 * was a template) → inserts a NEW `app_roles` row scoped to THIS org
 * (`role_kind: 'custom'`, `is_protected: false` — the org's own copy is
 * fully editable/deactivatable from this point on, not linked back to the
 * template) using `input.key`/`input.name` if given, else the template's
 * own → same `duplicate_key` handling as `createRole`.
 *
 * The `ok` variant carries `templateKey` (the source template's own key, not
 * just its id) — not in the Phase 3 design doc's literal type sketch, added
 * here because `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE`'s audit metadata
 * (Phase 3 Component Plan) needs it and the action layer has no other cheap
 * way to get it without a second read outside this transaction.
 */
export async function adoptTemplate(
  actorPersonId: string,
  organizationId: string,
  input: { templateRoleId: string; key?: string; name?: string },
): Promise<AdoptTemplateResult> {
  try {
    return await withOrgContext(actorPersonId, organizationId, async (tx) => {
      if (!(await hasRolesManage(tx, actorPersonId, organizationId))) {
        return { kind: "forbidden" };
      }

      const organizationType = await resolveOrganizationType(
        tx,
        organizationId,
      );

      const [template] = await tx
        .select({ id: appRoles.id, key: appRoles.key, name: appRoles.name })
        .from(appRoles)
        .where(
          and(
            eq(appRoles.id, input.templateRoleId),
            isNull(appRoles.organizationId),
            organizationType
              ? or(
                  isNull(appRoles.organizationTypeScope),
                  eq(appRoles.organizationTypeScope, organizationType),
                )
              : isNull(appRoles.organizationTypeScope),
          ),
        )
        .limit(1);
      if (!template) {
        return { kind: "template_not_found" };
      }

      const templatePermissionKeys = await permissionKeysForRole(
        tx,
        template.id,
      );

      const key = input.key ?? template.key;
      const rawName = input.name ?? template.name;
      const validation = validateKeyAndName(key, rawName);
      if (!validation.ok) {
        return { kind: "invalid_input", reason: validation.reason };
      }

      const subsetCheck = await assertPermissionSubset(
        tx,
        actorPersonId,
        organizationId,
        templatePermissionKeys,
      );
      if (!subsetCheck.ok) {
        return {
          kind: "escalation_denied",
          missingPermissions: subsetCheck.missingPermissions,
        };
      }

      const [inserted] = await tx
        .insert(appRoles)
        .values({
          organizationId,
          key,
          name: validation.name,
          roleKind: "custom",
          isProtected: false,
        })
        .returning({ id: appRoles.id });
      const roleId = inserted!.id;

      if (templatePermissionKeys.length > 0) {
        await tx.insert(appRolePermissions).values(
          templatePermissionKeys.map((permissionKey) => ({
            roleId,
            permissionKey,
          })),
        );
      }

      return { kind: "ok", roleId, roleKey: key, templateKey: template.key };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { kind: "duplicate_key" };
    }
    throw err;
  }
}
