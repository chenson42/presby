"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  users,
  userTotp,
  userTotpRecoveryCodes,
  userTotpPendingEnrollments,
} from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

async function requireAdminUsers() {
  const session = await auth();
  if (!session?.user || !hasFeature(session.user.features, FEATURES.ADMIN_USERS)) {
    return null;
  }
  return session;
}

// Toggle whether a user must complete TOTP before accessing the admin shell.
// Rejects if actorId === targetUserId (self-disable block).
export async function setTwoFactorRequired(input: {
  userId: string;
  required: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdminUsers();
  if (!session) {
    return { ok: false, error: "Unauthorized." };
  }

  if (!input.required && session.user.id === input.userId) {
    return {
      ok: false,
      error: "You cannot disable your own 2FA requirement.",
    };
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true },
  });
  if (!target) {
    return { ok: false, error: "User not found." };
  }

  await db
    .update(users)
    .set({ twoFactorRequired: input.required })
    .where(eq(users.id, input.userId));

  await recordAudit({
    action: AUDIT_ACTIONS.USER_2FA_REQUIRED_CHANGED,
    resourceType: "user",
    resourceId: input.userId,
    metadata: { required: input.required },
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${input.userId}`);

  return { ok: true };
}

// Wipe all TOTP state for a user: enrolled secret, recovery codes, and pending
// enrollment. Does NOT clear a trusted-device cookie — this starter has none.
//
// The three DELETEs are sequential and idempotent. The Neon HTTP driver does
// not support db.transaction() on the pooled connection, so we follow the same
// pattern as resetEnrollmentAction in src/app/(admin)/admin/2fa/actions.ts.
// For atomic multi-write, use db.batch() instead — see DECISION-014 in docs/decisions.md.
//
// Known gap: the target user's twoFactorVerified JWT claim stays true until
// their JWT expires (typically 30 days). There is no session DB to invalidate
// the token. The user will be required to re-enroll on their next sign-in.
export async function forceResetTwoFactor(input: {
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdminUsers();
  if (!session) {
    return { ok: false, error: "Unauthorized." };
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true },
  });
  if (!target) {
    return { ok: false, error: "User not found." };
  }

  await db.delete(userTotp).where(eq(userTotp.userId, input.userId));
  await db
    .delete(userTotpRecoveryCodes)
    .where(eq(userTotpRecoveryCodes.userId, input.userId));
  await db
    .delete(userTotpPendingEnrollments)
    .where(eq(userTotpPendingEnrollments.userId, input.userId));

  await recordAudit({
    action: AUDIT_ACTIONS.USER_2FA_FORCE_RESET,
    resourceType: "user",
    resourceId: input.userId,
    metadata: {},
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${input.userId}`);

  return { ok: true };
}
