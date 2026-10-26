/**
 * getOrCreatePendingEnrollment
 *
 * Returns the pending two-factor enrolment secret for a user who is not yet
 * enrolled. Its only caller is the account page,
 * `src/app/(account)/account/2fa/page.tsx`. (`/admin/2fa` is a policy and
 * stranded-users page and does not call it.)
 *
 * Contract:
 *  - One stored secret per pending enrolment (`user_id` is the primary key).
 *  - The page always shows what the database holds: every return value is
 *    decrypted from a ciphertext read back from the table, never from a secret
 *    this call minted and did not see stored.
 *  - A fresh row is never overwritten. Within the TTL a reload, a second tab or
 *    a second concurrent render gets the same secret, so the QR code an
 *    authenticator app already scanned keeps working.
 *  - An absent or expired row is replaced atomically, so concurrent renders
 *    converge on one new secret.
 *
 * How (F342): the connection is autocommit READ COMMITTED, so the safety lives
 * in a single statement. `INSERT ... ON CONFLICT (user_id) DO UPDATE ... WHERE
 * expires_at <= now() RETURNING` writes only when there is no row or the row is
 * expired; a concurrent loser re-evaluates the WHERE against the winner's
 * committed row, finds it fresh, writes nothing and returns nothing. It then
 * reads the winner's secret on its next pass. The earlier find-then-upsert had
 * an unconditional `do update`, so two concurrent first renders each minted a
 * secret, the last write won, and one page showed a secret the database no
 * longer held (a correct code for it was refused).
 *
 * Bounded: a row can vanish between the two statements (admin reset, the
 * maintenance cron's expired-row sweep), so a pass that finds nothing to read
 * and loses the write goes round again, at most MAX_ATTEMPTS times, then throws
 * a constant error. It never returns a secret it did not see stored, and it
 * logs nothing: no secret, ciphertext, URI or user id leaves this function.
 *
 * Freshness and the TTL use the database clock (`now()`) so the test and the
 * write that follows it cannot disagree across two machines.
 *
 * Tested against the real database (`totp-pending.test.ts`) and with a scripted
 * one for the bounded paths (`totp-pending.exhaustion.test.ts`).
 */

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userTotpPendingEnrollments } from "@/lib/db/schema";
import {
  decryptSecret,
  encryptSecret,
  generateSecret,
  otpauthUrl,
} from "@/lib/two-factor";

export const PENDING_TTL_MINUTES = 10;

/** Passes before giving up; only sustained concurrent deletes can use more than one. */
const MAX_ATTEMPTS = 3;

export interface PendingEnrollmentResult {
  /** Base-32 plaintext secret — shown once for manual entry */
  secret: string;
  /** otpauth:// URI used to render the QR code */
  uri: string;
}

export async function getOrCreatePendingEnrollment(
  userId: string,
  email: string,
): Promise<PendingEnrollmentResult> {
  const table = userTotpPendingEnrollments;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 1. A fresh row: the reload path, and where a concurrent loser finds the
    //    winner's secret. Writes nothing.
    const [fresh] = await db
      .select({ secretCiphertext: table.secretCiphertext })
      .from(table)
      .where(and(eq(table.userId, userId), gt(table.expiresAt, sql`now()`)))
      .limit(1);
    if (fresh) {
      const secret = decryptSecret(fresh.secretCiphertext);
      return { secret, uri: otpauthUrl(email, secret) };
    }

    // 2. Absent or expired: insert, or replace only an expired row, in one
    //    statement. A row coming back means this call wrote it. The ciphertext
    //    minted here is discarded if another caller wins.
    const [written] = await db
      .insert(table)
      .values({
        userId,
        secretCiphertext: encryptSecret(generateSecret()),
        expiresAt: sql`now() + make_interval(mins => ${PENDING_TTL_MINUTES})`,
      })
      .onConflictDoUpdate({
        target: table.userId,
        set: {
          secretCiphertext: sql`excluded.secret_ciphertext`,
          expiresAt: sql`excluded.expires_at`,
          createdAt: sql`now()`,
        },
        setWhere: sql`${table.expiresAt} <= now()`,
      })
      .returning({ secretCiphertext: table.secretCiphertext });
    if (written) {
      const secret = decryptSecret(written.secretCiphertext);
      return { secret, uri: otpauthUrl(email, secret) };
    }
  }

  throw new Error("Pending two-factor enrolment could not be established");
}
