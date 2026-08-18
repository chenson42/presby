"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth, unstable_update } from "@/auth";
import { db } from "@/lib/db";
import { roles, users, userRoles } from "@/lib/db/schema";
import { ADMIN_ROLE, FEATURES, hasFeature } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.roles?.includes(ADMIN_ROLE)) {
    throw new Error("Forbidden");
  }
  return session;
}

// If the role change targets the actor's own user row, refresh their JWT so
// the change takes effect immediately rather than at next sign-in. For
// changes targeting other users, the affected user's JWT stays stale until
// their next sign-in or until something calls `unstable_update` in their
// session context.
async function refreshSelfIfNeeded(actorId: string, targetUserId: string) {
  if (actorId === targetUserId) {
    await unstable_update({});
  }
}

export async function assignRoleAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = String(formData.get("userId"));
  const roleId = String(formData.get("roleId"));

  await db
    .insert(userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();

  await recordAudit({
    action: AUDIT_ACTIONS.USER_ROLE_ASSIGNED,
    resourceType: "user",
    resourceId: userId,
    metadata: { roleId },
  });

  await refreshSelfIfNeeded(session.user.id, userId);
  revalidatePath("/admin/users");
}

export async function removeRoleAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = String(formData.get("userId"));
  const roleName = String(formData.get("roleName"));

  const role = await db.query.roles.findFirst({
    where: eq(roles.name, roleName),
  });
  if (!role) throw new Error(`Unknown role: ${roleName}`);

  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));

  await recordAudit({
    action: AUDIT_ACTIONS.USER_ROLE_REMOVED,
    resourceType: "user",
    resourceId: userId,
    metadata: { roleName },
  });

  await refreshSelfIfNeeded(session.user.id, userId);
  revalidatePath("/admin/users");
}

// ---------------------------------------------------------------------------
// deactivateUser / reactivateUser
//
// Gate: admin.users feature (not just admin role) so the permission model
// is consistent with the rest of the user-management surface.
// Self-deactivation is blocked for deactivateUser; admins can reactivate any
// user including themselves if somehow they were deactivated by another admin.
// ---------------------------------------------------------------------------

async function requireAdminUsers() {
  const session = await auth();
  if (!session?.user || !hasFeature(session.user.features, FEATURES.ADMIN_USERS)) {
    return null;
  }
  return session;
}

export async function deactivateUser(input: {
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdminUsers();
  if (!session) return { ok: false, error: "Forbidden." };

  // Self-deactivation block — an admin cannot lock themselves out.
  if (session.user.id === input.userId) {
    return { ok: false, error: "You cannot deactivate your own account." };
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true, isActive: true },
  });
  if (!target) return { ok: false, error: "User not found." };
  if (!target.isActive) return { ok: false, error: "User is already inactive." };

  await db
    .update(users)
    .set({ isActive: false })
    .where(eq(users.id, input.userId));

  await recordAudit({
    action: AUDIT_ACTIONS.USER_DEACTIVATED,
    resourceType: "user",
    resourceId: input.userId,
    metadata: {},
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${input.userId}`);
  return { ok: true };
}

export async function reactivateUser(input: {
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdminUsers();
  if (!session) return { ok: false, error: "Forbidden." };

  const target = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true, isActive: true },
  });
  if (!target) return { ok: false, error: "User not found." };
  if (target.isActive) return { ok: false, error: "User is already active." };

  await db
    .update(users)
    .set({ isActive: true })
    .where(eq(users.id, input.userId));

  await recordAudit({
    action: AUDIT_ACTIONS.USER_REACTIVATED,
    resourceType: "user",
    resourceId: input.userId,
    metadata: {},
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${input.userId}`);
  return { ok: true };
}

export async function unlockUserAction(input: {
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdminUsers();
  if (!session) return { ok: false, error: "Forbidden." };

  const target = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true },
  });
  if (!target) return { ok: false, error: "User not found." };

  // Idempotent: setting null → null and 0 → 0 on an already-unlocked user
  // is a no-op. This cleanly handles race conditions and expired-lock rows.
  await db
    .update(users)
    .set({ lockedUntil: null, failedLoginAttempts: 0 })
    .where(eq(users.id, input.userId));

  await recordAudit({
    action: AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED,
    resourceType: "user",
    resourceId: input.userId,
    metadata: { clearedByAdminId: session.user.id },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}
