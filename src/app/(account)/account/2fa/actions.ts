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

/** The pool or an open transaction: both expose the same delete/insert. */
type Executor = Pick<typeof db, "delete" | "insert">;

/** Replaces every recovery-code hash for the user with hashes of `codes`. */
async function replaceRecoveryCodes(
  executor: Executor,
  userId: string,
  codes: string[],
): Promise<void> {
  await executor
    .delete(userTotpRecoveryCodes)
    .where(eq(userTotpRecoveryCodes.userId, userId));
  await executor.insert(userTotpRecoveryCodes).values(
    codes.map((c) => ({
      userId,
      codeHash: hashRecoveryCode(c),
    })),
  );
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

  const freshCodes = generateRecoveryCodes();
  await replaceRecoveryCodes(db, session.user.id, freshCodes);
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

  // F344: only a session that has passed the second factor may mint codes that
  // themselves pass the second factor. Whether or not 2FA is required of this
  // account: an enrolled account that is not required today becomes required the
  // moment a congregation or designation turns the requirement on. No lockout:
  // /totp accepts any signed-in enrolled user, with a code or a recovery code.
  if (!session.user.twoFactorVerified) {
    await recordAudit({
      action: AUDIT_ACTIONS.TOTP_RECOVERY_CODES_REGENERATE_REFUSED,
      resourceType: "user",
      resourceId: session.user.id,
      metadata: { twoFactorRequired: session.user.twoFactorRequired },
    });
    return {
      ok: false,
      error:
        "Confirm it's you with your authenticator app or a recovery code first. Reload this page to see how.",
    };
  }

  const freshCodes = generateRecoveryCodes();
  const userId = session.user.id;
  await db.transaction(async (tx) => {
    await replaceRecoveryCodes(tx, userId, freshCodes);
  });
  await setFreshRecoveryCodesCookie(freshCodes);

  await recordAudit({
    action: AUDIT_ACTIONS.TOTP_RECOVERY_CODES_REGENERATED,
    resourceType: "user",
    resourceId: session.user.id,
  });

  revalidatePath("/account/2fa");
  return { ok: true, data: { recoveryCodes: freshCodes } };
}
