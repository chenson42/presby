/**
 * The PURE half of the giving gate (docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Gate order on every surface"): the key and toggle names, the
 * Node-side 2FA check (step 3) and the `/totp` redirect builder. No database,
 * no `server-only`, no `@/lib/authz` — so it loads in a test with no
 * `DATABASE_URL` (CI runs without one) and in a route handler's first line.
 * `access.ts` re-exports everything here, so callers import from
 * `@/lib/giving/access`; the split exists for loadability, not for layering.
 */

import {
  assertTreasurySession,
  treasuryTotpRedirectUrl,
  type TreasurySessionCheck,
  type TreasurySessionLike,
} from "@/lib/treasury/session";

export const GIVING_TOGGLE_KEY = "org_portal.giving" as const;

export const GIVING_KEYS = {
  view: "giving.view",
  record: "giving.record",
  manage: "giving.manage",
} as const;

export type GivingKey = (typeof GIVING_KEYS)[keyof typeof GIVING_KEYS];

// ---------------------------------------------------------------------------
// Step 3 - the Node-side 2FA check
// ---------------------------------------------------------------------------
//
// The body moved to src/lib/treasury/session.ts (the reimbursement surfaces run
// the same check, Phase 3 P3-3 of docs/work-log/2026-10-25-treasury-inc1.md).
// These are the OLD NAMES, kept as aliases so every giving import and test is
// untouched; behaviour is identical because it is the same function.

/** The slice of the NextAuth session this check reads. */
export type GivingSessionLike = TreasurySessionLike;

export type GivingSessionCheck = TreasurySessionCheck;

/** See `assertTreasurySession`. */
export const assertGivingSession = assertTreasurySession;

/** See `treasuryTotpRedirectUrl`. */
export const givingTotpRedirectUrl = treasuryTotpRedirectUrl;
