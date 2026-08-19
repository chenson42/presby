/**
 * totp-fixture.ts — seeds a real, already-enrolled TOTP secret for the
 * "mfa-enrolled" e2e fixture (see users.ts).
 *
 * Every other e2e assertion that touches TOTP (role-boundaries.spec.ts,
 * member-home.spec.ts, post-login-routing.spec.ts) deliberately tests the
 * UN-enrolled redirect gate via mfa-admin — see that fixture's comment in
 * users.ts. None of them complete an actual TOTP challenge, because none of
 * them have a secret to compute a code from. This file exists so
 * totp-full-login.spec.ts can: CLAUDE.md's Phase 4 gate on any change touching
 * `src/app/(auth)/` requires a running-server smoke of the full login path,
 * including an MFA-enrolled user (P0.5 commit a6, work-log
 * 2026-08-19-brand-foundation).
 *
 * The secret is a fixed, widely-published TOTP demo value (the one most
 * client-library READMEs use, "JBSWY3DPEHPK3PXP", doubled for a little more
 * entropy) — not a credential, just a stable seed a Node process and the
 * running server can both derive the same 6-digit code from at verify time.
 *
 * Encryption duplicates src/lib/two-factor.ts's format (AES-256-GCM,
 * iv‖tag‖ciphertext, base64) rather than importing it — seed-users.ts's
 * header states the standing rule for this directory: nothing under e2e/
 * imports application modules, because src/lib/db opens a WebSocket pool at
 * import time. This file doesn't touch that module, but the rule is simplest
 * held uniformly rather than argued about per file.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon<false, false>>;

/** RFC 4648 base32 — see the file header for why this value is not a secret. */
export const E2E_TOTP_TEST_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

function encryptForFixture(plain: string): string {
  const raw = process.env.AUTH_TOTP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "[totp-fixture] AUTH_TOTP_ENCRYPTION_KEY is not set. The mfa-enrolled " +
        "fixture needs it to seed a TOTP secret the running server can also " +
        "decrypt — set it in .env.local (32 bytes, base64; " +
        "`openssl rand -base64 32`) and restart the server so it picks the " +
        "value up. This is a hard failure, not a skip, for the same reason " +
        "assertRateLimiterDisabled() in global-setup.ts is: a silently-skipped " +
        "fixture is a suite that reports green having proven nothing.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "[totp-fixture] AUTH_TOTP_ENCRYPTION_KEY must decode to 32 bytes.",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Upserts a working TOTP enrolment for the given user id. Idempotent — safe to
 * call on every globalSetup run, matching seed-users.ts's contract. Each call
 * re-encrypts with a fresh IV (a decryption detail, not a semantic change) —
 * the plaintext secret, and therefore every code a spec can compute from
 * E2E_TOTP_TEST_SECRET, stays the same across runs.
 */
export async function seedTotpEnrollment(
  sql: Sql,
  userId: string,
): Promise<void> {
  const ciphertext = encryptForFixture(E2E_TOTP_TEST_SECRET);
  await sql`
    INSERT INTO user_totp (user_id, secret_ciphertext, enrolled_at)
    VALUES (${userId}, ${ciphertext}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      secret_ciphertext = EXCLUDED.secret_ciphertext,
      last_used_at      = NULL
  `;
}
