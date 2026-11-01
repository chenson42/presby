import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";

/**
 * The Node-side 2FA check shared by every treasury surface (giving and
 * reimbursements) - docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 P3-3.
 * The body of what was `giving/access-pure.ts#assertGivingSession` and
 * `givingTotpRedirectUrl`, moved here; `access-pure.ts` re-exports them under
 * their old names, so every giving import and test is untouched.
 *
 * WHY THE PAGE, ACTION AND ROUTE RE-CHECK THE CLAIM. The Edge reads the
 * `twoFactorRequired` claim, which refreshes only when the session is
 * re-derived, so a user who has JUST been granted a treasury key carries a
 * stale `false` until then. Every treasury surface re-checks the claim itself
 * and refuses when `twoFactorRequired && !twoFactorVerified`. For a requester
 * or approver whose claim does not require 2FA this is a no-op.
 *
 * PURE on purpose: no database, no `server-only`, no `@/lib/authz`. It reads
 * only the session the caller already has, so it loads in a test with no
 * `DATABASE_URL` and in a route handler's first line.
 */

/** The slice of the NextAuth session this check reads. */
export type TreasurySessionLike =
  | {
      user?: {
        id?: string | null;
        twoFactorRequired?: boolean | null;
        twoFactorVerified?: boolean | null;
      } | null;
    }
  | null
  | undefined;

export type TreasurySessionCheck =
  | { kind: "ok"; userId: string }
  | { kind: "unauthenticated" }
  | { kind: "two_factor_required" };

/**
 * `unauthenticated` when there is no signed-in user; `two_factor_required` when
 * the session says a challenge is required and not yet verified; else `ok`.
 * Anything not strictly `true` for `twoFactorRequired` counts as not required
 * (the claim is a boolean the jwt callback sets; a missing field is a user who
 * was never flagged), and anything not strictly `true` for `twoFactorVerified`
 * counts as not verified (fail closed on the half that matters).
 */
export function assertTreasurySession(session: TreasurySessionLike): TreasurySessionCheck {
  const user = session?.user;
  if (!user || !user.id) return { kind: "unauthenticated" };
  if (user.twoFactorRequired === true && user.twoFactorVerified !== true) {
    return { kind: "two_factor_required" };
  }
  return { kind: "ok", userId: user.id };
}

/**
 * Where a refused page or route sends the user: `/totp?callbackUrl=<path>`.
 * The path passes through the same open-redirect sanitizer every other
 * callbackUrl does (an off-origin or malformed value becomes `/launch`).
 */
export function treasuryTotpRedirectUrl(path: string): string {
  return `/totp?callbackUrl=${encodeURIComponent(sanitizeCallbackUrl(path))}`;
}
