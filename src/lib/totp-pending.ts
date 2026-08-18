/**
 * getOrCreatePendingEnrollment
 *
 * Shared helper used by the admin /admin/2fa and account /account/2fa pages
 * when an unenrolled user lands on either enrollment page.
 *
 * Behaviour:
 *  - If a non-expired pending row exists for the user, decrypt the ciphertext
 *    and reuse that secret.  The QR code presented to the user stays stable
 *    across page reloads within the TTL window — the user's authenticator
 *    app keeps working because the secret never changes mid-session.
 *  - If no row exists, or the row is expired, mint a fresh secret, upsert the
 *    pending row, and return the new values.
 *
 * This logic was previously duplicated (correctly) in account/2fa/page.tsx and
 * (incorrectly, always-mint path) in admin/2fa/page.tsx.  Centralising it here
 * ensures both surfaces behave identically.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userTotpPendingEnrollments } from "@/lib/db/schema";
import {
  decryptSecret,
  encryptSecret,
  generateSecret,
  otpauthUrl,
} from "@/lib/two-factor";

export const PENDING_TTL_MINUTES = 10;

export interface PendingEnrollmentResult {
  /** Base-32 plaintext secret — shown once for manual entry */
  secret: string;
  /** otpauth:// URI used to render the QR code */
  uri: string;
}

/**
 * Returns the active pending enrollment for `userId`, creating (or replacing
 * an expired) pending row when necessary.
 *
 * This is a pure DB + crypto function with no Next.js dependencies, which
 * makes it straightforward to unit-test by mocking the DB.
 */
export async function getOrCreatePendingEnrollment(
  userId: string,
  email: string,
): Promise<PendingEnrollmentResult> {
  const existing = await db.query.userTotpPendingEnrollments.findFirst({
    where: eq(userTotpPendingEnrollments.userId, userId),
  });

  if (existing && existing.expiresAt > new Date()) {
    // Reuse — decrypt the ciphertext to recover the plaintext secret so we
    // can regenerate the QR URI without storing it.
    const secret = decryptSecret(existing.secretCiphertext);
    const uri = otpauthUrl(email, secret);
    return { secret, uri };
  }

  // Expired or absent — mint fresh.
  const secret = generateSecret();
  const ciphertext = encryptSecret(secret);
  const expiresAt = new Date(Date.now() + PENDING_TTL_MINUTES * 60 * 1000);

  await db
    .insert(userTotpPendingEnrollments)
    .values({ userId, secretCiphertext: ciphertext, expiresAt })
    .onConflictDoUpdate({
      target: userTotpPendingEnrollments.userId,
      set: { secretCiphertext: ciphertext, expiresAt, createdAt: new Date() },
    });

  const uri = otpauthUrl(email, secret);
  return { secret, uri };
}
