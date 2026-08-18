"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  userTotp,
  userTotpPendingEnrollments,
  userTotpRecoveryCodes,
} from "@/lib/db/schema";
import {
  decryptSecret,
  encryptSecret,
  FRESH_RECOVERY_CODES_COOKIE,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyToken,
} from "@/lib/two-factor";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { ActionResult } from "@/types/actions";

const FRESH_COOKIE_TTL_SECONDS = 300; // 5 minutes — enough to copy/paste

async function setFreshRecoveryCodesCookie(codes: string[]) {
  const jar = await cookies();
  jar.set(FRESH_RECOVERY_CODES_COOKIE, JSON.stringify(codes), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: FRESH_COOKIE_TTL_SECONDS,
    path: "/account/2fa",
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
  jar.delete({ name: FRESH_RECOVERY_CODES_COOKIE, path: "/account/2fa" });
}

// ---------------------------------------------------------------------------
// completeEnrollment — called from the client TOTP form
// ---------------------------------------------------------------------------

export async function completeEnrollment(input: {
  code: string;
}): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };

  const pending = await db.query.userTotpPendingEnrollments.findFirst({
    where: eq(userTotpPendingEnrollments.userId, session.user.id),
  });

  if (!pending) {
    return {
      ok: false,
      error: "No pending enrollment found. Reload the page to start over.",
    };
  }
  if (pending.expiresAt < new Date()) {
    await db
      .delete(userTotpPendingEnrollments)
      .where(eq(userTotpPendingEnrollments.userId, session.user.id));
    return {
      ok: false,
      error: "Enrollment session expired. Reload the page to start over.",
    };
  }

  const plain = decryptSecret(pending.secretCiphertext);
  if (!verifyToken(input.code, plain)) {
    return { ok: false, error: "That code did not match. Try again." };
  }

  // Store confirmed secret
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

  revalidatePath("/account/2fa");
  return { ok: true, data: { recoveryCodes: freshCodes } };
}

// ---------------------------------------------------------------------------
// regenerateRecoveryCodes
// ---------------------------------------------------------------------------

export async function regenerateRecoveryCodes(): Promise<
  ActionResult<{ recoveryCodes: string[] }>
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };

  const enrolled = await db.query.userTotp.findFirst({
    where: eq(userTotp.userId, session.user.id),
    columns: { userId: true },
  });
  if (!enrolled) {
    return {
      ok: false,
      error: "Enroll in 2FA before regenerating recovery codes.",
    };
  }

  const freshCodes = await replaceRecoveryCodes(session.user.id);
  await setFreshRecoveryCodesCookie(freshCodes);

  await recordAudit({
    action: AUDIT_ACTIONS.TOTP_RECOVERY_CODES_REGENERATED,
    resourceType: "user",
    resourceId: session.user.id,
  });

  revalidatePath("/account/2fa");
  return { ok: true, data: { recoveryCodes: freshCodes } };
}
