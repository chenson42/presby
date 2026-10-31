import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { roleFeatures, roles, users } from "@/lib/db/schema";
import { ADMIN_ROLE, FEATURES } from "@/lib/permissions";
import { AUDIT_ACTIONS, insertAuditRow, type AuditActor } from "@/lib/audit-tx";
import type { OrgTx } from "@/lib/authz";

/**
 * Two-factor for a platform role (F343, DECISION-291): when a person is GIVEN a
 * platform-administration role, switch their own `users.two_factor_required`
 * on, audited, in the grant's own transaction.
 *
 * Why a write and not a derived term. New accounts default to "not required"
 * (migration 0080); the requirement now comes from a role, a congregation, or
 * the person's own setting. A platform administrator holds no congregation
 * membership, so neither the congregation policy nor a flagged key can reach
 * them: this column is their only protection, and this is the one place it is
 * set. It stays an ordinary per-person setting, so an administrator can still
 * switch it off on the user page (operator ruling 2026-10-26); the platform role
 * itself still confers no tenant authority. There is deliberately no platform-role term
 * in `computeEffectiveTwoFactor`.
 *
 * THE ONE PREDICATE. A role is a platform role when its name is `ADMIN_ROLE`
 * (which holds its features from code, not from `role_features`) OR it is bound
 * to `FEATURES.ADMIN_DASHBOARD` (the `support_operator` shape, DECISION-044's
 * `canAccessAdmin`). Nothing else in the tree restates it; a source-scan test
 * pins that.
 *
 * ONE TRANSACTION, CHANGED ROW ONLY. The caller passes the transaction that
 * inserts the `user_roles` row, so the grant and the column commit or roll back
 * as one: no token can carry the admin features without also carrying the
 * requirement. The update is conditional (`and not two_factor_required ...
 * returning`) and the audit row is written only when it returned a row, so a
 * person who is already required is not audited again, and two administrators
 * pressing Add at once write one row.
 *
 * CALLERS call this only when their grant row was NEWLY inserted (P3-3): pressing
 * Add on a role a person already holds must not silently undo an administrator
 * who deliberately switched the setting off. A DIFFERENT platform role granted
 * later switches it on again, audited with its own `roleName`.
 *
 * NEVER `auth()`. `ensureDefaultRole` runs inside the jwt callback, and
 * `recordAudit()` resolves an omitted actor through `auth()`, which would
 * re-enter that callback from inside itself. This module therefore imports
 * neither `@/auth` nor `recordAudit`; it writes with `insertAuditRow()` and the
 * caller's actor, where `null` is an explicit system write.
 *
 * TRIPWIRE (DECISION-291). Any future writer of `users.is_platform_admin`, of
 * `user_roles` for a platform role, or of `role_features` must call this. Today
 * the only writers are the two callers above; SQL-set rights bypass it and are
 * an accepted residual.
 *
 * Removing the role does NOT clear the column (R2e): the person stays required
 * until an administrator uses the per-person switch.
 */

/** The `cause` recorded on the audit row, so "who changed this person's setting" stays one query. */
export const PLATFORM_ROLE_2FA_CAUSE = "platform_role_granted" as const;

export async function requireTwoFactorForPlatformRole(
  tx: OrgTx,
  input: { userId: string; roleId: string; actor: AuditActor },
): Promise<{ changed: boolean; roleName: string | null }> {
  const [role] = await tx
    .select({ name: roles.name })
    .from(roles)
    .where(
      and(
        eq(roles.id, input.roleId),
        or(
          eq(roles.name, ADMIN_ROLE),
          sql`exists (select 1 from ${roleFeatures} where ${roleFeatures.roleId} = ${roles.id} and ${roleFeatures.featureKey} = ${FEATURES.ADMIN_DASHBOARD})`,
        ),
      ),
    )
    .limit(1);
  if (!role) return { changed: false, roleName: null };

  const updated = await tx
    .update(users)
    .set({ twoFactorRequired: true })
    .where(and(eq(users.id, input.userId), eq(users.twoFactorRequired, false)))
    .returning({ id: users.id });
  if (updated.length === 0) return { changed: false, roleName: role.name };

  await insertAuditRow(tx, {
    action: AUDIT_ACTIONS.USER_2FA_REQUIRED_CHANGED,
    actor: input.actor,
    resourceType: "user",
    resourceId: input.userId,
    metadata: { required: true, cause: PLATFORM_ROLE_2FA_CAUSE, roleName: role.name },
  });
  return { changed: true, roleName: role.name };
}
