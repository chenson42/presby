import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";

/**
 * The Node-side 2FA check shared by every (org) surface that re-checks the
 * session claim itself: treasury (giving, reimbursements) and the presbytery
 * reports - DECISION-338, docs/work-log/2026-11-15-presbytery-reports.md.
 * The bodies moved byte for byte from `treasury/session.ts` (which was itself
 * the body of `giving/access-pure.ts#assertGivingSession`), renamed neutrally;
 * `treasury/session.ts` re-exports them under their old names, so every giving
 * and reimbursement import and test is untouched.
 *
 * WHY THE PAGE, ACTION AND ROUTE RE-CHECK THE CLAIM. The Edge reads the
 * `twoFactorRequired` claim, which refreshes only when the session is
 * re-derived, so a user who has JUST been granted a key carries a stale
 * `false` until then. Every such surface re-checks the claim itself and
 * refuses when `twoFactorRequired && !twoFactorVerified`. For a user whose
 * claim does not require 2FA this is a no-op.
 *
 * PURE on purpose: no database, no `server-only`, no `@/lib/authz`. It reads
 * only the session the caller already has, so it loads in a test with no
 * `DATABASE_URL` and in a route handler's first line.
 */

/** The slice of the NextAuth session this check reads. */
export type OrgSessionLike =
  | {
      user?: {
        id?: string | null;
        twoFactorRequired?: boolean | null;
        twoFactorVerified?: boolean | null;
      } | null;
    }
  | null
  | undefined;

export type OrgSessionCheck =
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
export function assertOrgSession(session: OrgSessionLike): OrgSessionCheck {
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
export function orgTotpRedirectUrl(path: string): string {
  return `/totp?callbackUrl=${encodeURIComponent(sanitizeCallbackUrl(path))}`;
}
