import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";

/**
 * The PURE half of the giving gate (docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Gate order on every surface"): the key and toggle names, the
 * Node-side 2FA check (step 3) and the `/totp` redirect builder. No database,
 * no `server-only`, no `@/lib/authz` — so it loads in a test with no
 * `DATABASE_URL` (CI runs without one) and in a route handler's first line.
 * `access.ts` re-exports everything here, so callers import from
 * `@/lib/giving/access`; the split exists for loadability, not for layering.
 */

export const GIVING_TOGGLE_KEY = "org_portal.giving" as const;

export const GIVING_KEYS = {
  view: "giving.view",
  record: "giving.record",
  manage: "giving.manage",
} as const;

export type GivingKey = (typeof GIVING_KEYS)[keyof typeof GIVING_KEYS];

// ---------------------------------------------------------------------------
// Step 3 — the Node-side 2FA check
// ---------------------------------------------------------------------------

/** The slice of the NextAuth session this check reads. */
export type GivingSessionLike =
  | {
      user?: {
        id?: string | null;
        twoFactorRequired?: boolean | null;
        twoFactorVerified?: boolean | null;
      } | null;
    }
  | null
  | undefined;

export type GivingSessionCheck =
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
export function assertGivingSession(session: GivingSessionLike): GivingSessionCheck {
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
export function givingTotpRedirectUrl(path: string): string {
  return `/totp?callbackUrl=${encodeURIComponent(sanitizeCallbackUrl(path))}`;
}
