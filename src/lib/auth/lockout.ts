// src/lib/auth/lockout.ts
//
// CREDENTIALS-ONLY: this module is never called for OAuth sign-ins.
// Google OAuth users are unaffected by account lockout — Google handles their
// own throttling. Only the Credentials authorize() path (src/auth.ts) reads
// these columns. The failedLoginAttempts and lockedUntil columns on `users`
// are semantically credentials-only; OAuth sign-ins neither increment nor
// check them (a successful OAuth sign-in DOES reset them as a side-effect of
// the jwt callback lastLoginAt update — this is intentional and benign).
//
// TIMING ORACLE (accepted): checkLockout() short-circuits before bcrypt
// (~100ms) when the account is locked. This creates a timing difference
// between "locked" (fast) and "wrong password" (slow). Accepted for this
// starter: the attacker who triggered the lock already knows they triggered
// it (they made 5 failed attempts). No new enumeration information is
// revealed by the timing difference. Forks operating at scale where timing
// side-channels matter should add a dummy bcrypt call on all early-return
// paths in authorize(). See DECISION-025.
//
// DOS AS DESIGN LIMITATION: any caller who knows a target's email can lock
// their account by submitting 5 bad passwords. The IP rate limiter (5/min
// per IP) limits the speed of the DoS. Turnstile CAPTCHA (Tier 2 #12) is
// the planned paired mitigation. See DECISION-025.

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION_SECONDS = 900; // 15 minutes

export type LockoutState = {
  /**
   * If true, authorize() returns null immediately without calling bcrypt.
   * The lock window is still active (lockedUntil is in the future).
   * The counter is NOT incremented while locked (R4).
   */
  locked: boolean;
  /**
   * If true, the lock window has expired. authorize() resets the counter to 0
   * BEFORE calling bcrypt, giving the user a fresh LOCKOUT_THRESHOLD window
   * rather than immediately re-locking on the next failure (Gap 2 fix).
   * Only true when lockedUntil was non-null and is now in the past or equal
   * to `now`.
   */
  resetCounter: boolean;
};

/**
 * Pure, synchronous lockout state evaluation. No DB access — inject `now`
 * for testability.
 *
 * Three outcomes:
 *   lockedUntil === null              → { locked: false, resetCounter: false }
 *   lockedUntil > now                 → { locked: true,  resetCounter: false }
 *   lockedUntil <= now (expired)      → { locked: false, resetCounter: true }
 *
 * @param user  Subset of the user row; only lockedUntil is inspected here.
 *              failedLoginAttempts is included in the type for the
 *              caller's convenience (authorize() has it in scope).
 * @param now   Reference time; pass `new Date()` from authorize().
 */
export function checkLockout(
  user: { failedLoginAttempts: number; lockedUntil: Date | null },
  now: Date,
): LockoutState {
  if (user.lockedUntil === null) {
    return { locked: false, resetCounter: false };
  }
  if (user.lockedUntil > now) {
    return { locked: true, resetCounter: false };
  }
  // lockedUntil is non-null and <= now: window has expired.
  return { locked: false, resetCounter: true };
}
