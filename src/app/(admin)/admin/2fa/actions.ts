"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { auth, unstable_update } from "@/auth";
import { db } from "@/lib/db";
import {
  userTotp,
  userTotpPendingEnrollments,
  userTotpRecoveryCodes,
} from "@/lib/db/schema";
import {
  decryptSecret,
  FRESH_RECOVERY_CODES_COOKIE,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyToken,
} from "@/lib/two-factor";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

const FRESH_COOKIE_TTL_SECONDS = 300; // 5 minutes — enough to copy/paste

async function setFreshRecoveryCodesCookie(codes: string[]) {
  const jar = await cookies();
  jar.set(FRESH_RECOVERY_CODES_COOKIE, JSON.stringify(codes), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: FRESH_COOKIE_TTL_SECONDS,
    path: "/admin/2fa",
  });
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db
    .delete(userTotpRecoveryCodes)
    .where(eq(userTotpRecoveryCodes.userId, userId));
  await db.insert(userTotpRecoveryCodes).values(
    codes.map((c) => ({
      userId,
      codeHash: hashRecoveryCode(c),
    })),
  );
  return codes;
}

// ---------------------------------------------------------------------------
// clearFreshCodesCookieAction — called by the FreshRecoveryCodes client island
// after it mounts and the codes are visible to the user. Running the delete
// here (in a server action) is the only way to mutate cookies legally in
// Next 16; doing it in an RSC render was the source of BUG-2.
// ---------------------------------------------------------------------------

export async function clearFreshCodesCookieAction() {
  const jar = await cookies();
  // Path must match the path used when the cookie was SET in setFreshRecoveryCodesCookie.
  // A deletion sent without the matching Path attribute targets a different cookie
  // entry in the browser jar and silently fails.
  jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/admin/2fa" });
}

export async function confirmEnrollmentAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const token = String(formData.get("token") ?? "");
  const pending = await db.query.userTotpPendingEnrollments.findFirst({
    where: eq(userTotpPendingEnrollments.userId, session.user.id),
  });

  if (!pending) {
    throw new Error(
      "No pending enrollment. Reload /admin/2fa to start over.",
    );
  }
  if (pending.expiresAt < new Date()) {
    await db
      .delete(userTotpPendingEnrollments)
      .where(eq(userTotpPendingEnrollments.userId, session.user.id));
    throw new Error("Enrollment expired. Reload /admin/2fa to start over.");
  }

  const plain = decryptSecret(pending.secretCiphertext);
  if (!verifyToken(token, plain)) {
    throw new Error("That code didn't match. Try again.");
  }

  await db
    .insert(userTotp)
    .values({
      userId: session.user.id,
      secretCiphertext: pending.secretCiphertext,
    })
    .onConflictDoUpdate({
      target: userTotp.userId,
      set: {
        secretCiphertext: pending.secretCiphertext,
        enrolledAt: new Date(),
        lastUsedAt: null,
      },
    });

  await db
    .delete(userTotpPendingEnrollments)
    .where(eq(userTotpPendingEnrollments.userId, session.user.id));

  const freshCodes = await replaceRecoveryCodes(session.user.id);
  await setFreshRecoveryCodesCookie(freshCodes);

  await recordAudit({
    action: AUDIT_ACTIONS.TOTP_ENROLLED,
    resourceType: "user",
    resourceId: session.user.id,
  });

  await unstable_update({ user: { twoFactorVerified: true } });
  revalidatePath("/admin/2fa");
  redirect("/admin/2fa");
}

export async function regenerateRecoveryCodesAction() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const enrolled = await db.query.userTotp.findFirst({
    where: eq(userTotp.userId, session.user.id),
  });
  if (!enrolled) {
    throw new Error("Enroll in 2FA before generating recovery codes.");
  }

  const freshCodes = await replaceRecoveryCodes(session.user.id);
  await setFreshRecoveryCodesCookie(freshCodes);

  await recordAudit({
    action: AUDIT_ACTIONS.TOTP_RECOVERY_CODES_REGENERATED,
    resourceType: "user",
    resourceId: session.user.id,
  });

  revalidatePath("/admin/2fa");
  redirect("/admin/2fa");
}

export async function resetEnrollmentAction() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  await db.delete(userTotp).where(eq(userTotp.userId, session.user.id));
  await db
    .delete(userTotpRecoveryCodes)
    .where(eq(userTotpRecoveryCodes.userId, session.user.id));
  await db
    .delete(userTotpPendingEnrollments)
    .where(eq(userTotpPendingEnrollments.userId, session.user.id));

  await recordAudit({
    action: AUDIT_ACTIONS.TOTP_RESET,
    resourceType: "user",
    resourceId: session.user.id,
  });

  await unstable_update({ user: { twoFactorVerified: false } });
  revalidatePath("/admin/2fa");
}
