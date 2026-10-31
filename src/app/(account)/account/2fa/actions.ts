"use server";

import { revalidatePath } from "next/cache";
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
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyToken,
} from "@/lib/two-factor";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { withTwoFactorGrant } from "@/lib/auth/two-factor-grant";
import type { ActionResult } from "@/types/actions";

// This file is "use server": every export is an endpoint the browser can call.
// It exports exactly completeEnrollment and regenerateRecoveryCodes, and nothing
// here may wrap or re-export the grant (two-factor-grant.boundaries.test.ts G3).
// There is no cookie and no `next/headers` anywhere in this route: the recovery
// codes are returned to the caller and live in client memory only (F166, S1).

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

const NO_SETUP_IN_PROGRESS =
  "No setup in progress was found. Reload this page to see where things stand.";
const ALREADY_ENROLLED =
  "Two-factor authentication is already set up on this account, possibly in another tab. Reload this page.";

// ---------------------------------------------------------------------------
// completeEnrollment — called from the client TOTP form (F166, DECISION-292)
//
// Confirming a first enrolment is a possession proof of the authenticator, so it
// may mark the session verified through the same single-use grant that
// verifyTotpAction uses. That is allowed only because, in this order:
//   1. the code verifies against the caller's OWN pending secret, before anything
//      is written and before any grant exists;
//   2. the user_totp insert is `ON CONFLICT DO NOTHING ... RETURNING`: if an
//      enrolment already exists nothing is replaced and no grant is opened (a
//      SELECT-then-insert would let two in-flight confirmations both pass: the
//      F342 lesson);
//   3. the writes have committed before the session is touched.
// A failed session update costs one /totp challenge, never the enrolment: the
// claim is never set on a throw.
// ---------------------------------------------------------------------------

export async function completeEnrollment(input: {
  code: string;
}): Promise<
  ActionResult<{ recoveryCodes: string[]; sessionVerified: boolean }>
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  const userId = session.user.id;

  const pending = await db.query.userTotpPendingEnrollments.findFirst({
    where: eq(userTotpPendingEnrollments.userId, userId),
  });

  if (!pending) {
    return { ok: false, error: NO_SETUP_IN_PROGRESS };
  }
  if (pending.expiresAt < new Date()) {
    await db
      .delete(userTotpPendingEnrollments)
      .where(eq(userTotpPendingEnrollments.userId, userId));
    return {
      ok: false,
      error: "Enrollment session expired. Reload the page to start over.",
    };
  }

  // 1. The possession proof.
  const plain = decryptSecret(pending.secretCiphertext);
  if (!verifyToken(input.code, plain)) {
    return { ok: false, error: "That code did not match. Try again." };
  }

  // 2. One transaction. An early return inside the callback COMMITS what was
  // written so far (only a throw rolls back): on a conflict that is just the
  // pending-row delete, which is what we want.
  const freshCodes = generateRecoveryCodes();
  const enrolled = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(userTotp)
      .values({ userId, secretCiphertext: pending.secretCiphertext })
      .onConflictDoNothing({ target: userTotp.userId })
      .returning({ userId: userTotp.userId });
    await tx
      .delete(userTotpPendingEnrollments)
      .where(eq(userTotpPendingEnrollments.userId, userId));
    if (inserted.length === 0) return false; // already enrolled: replace nothing
    await replaceRecoveryCodes(tx, userId, freshCodes);
    return true;
  });
  if (!enrolled) return { ok: false, error: ALREADY_ENROLLED };

  // 3. Mark the session verified: after the commit, inside the grant, for the
  // session user, with an empty payload (the jwt callback reads nothing from it).
  // `sessionVerified` is true only if the update completed AND the session it
  // returned reports the claim.
  let sessionVerified = false;
  try {
    const updated = await withTwoFactorGrant(session.user.id, "totp", () => unstable_update({}));
    sessionVerified = updated?.user?.twoFactorVerified === true;
  } catch {
    // One PII-free line: no id, code, secret or error text. Fail closed: the
    // enrolment stands and the person answers one /totp challenge.
    console.error("[2fa] session refresh after enrolment failed");
  }

  // A boolean, never a secret: it tells an enrolment-verified session apart from
  // a challenge-verified one (TOTP_VERIFY_SUCCEEDED / TOTP_RECOVERY_SUCCEEDED).
  await recordAudit({
    action: AUDIT_ACTIONS.TOTP_ENROLLED,
    resourceType: "user",
    resourceId: userId,
    metadata: { sessionVerified },
  });

  // No revalidatePath and no cookie: the session update above already makes Next
  // re-render the route, and the client holder keeps the codes through it.
  return { ok: true, data: { recoveryCodes: freshCodes, sessionVerified } };
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

  await recordAudit({
    action: AUDIT_ACTIONS.TOTP_RECOVERY_CODES_REGENERATED,
    resourceType: "user",
    resourceId: session.user.id,
  });

  // Refreshes the unused-code count. The re-render is harmless: the management
  // view keeps its identity, and the new codes live in RegenerateCodesForm's state.
  revalidatePath("/account/2fa");
  return { ok: true, data: { recoveryCodes: freshCodes } };
}
