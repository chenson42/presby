// src/lib/auth/local-login.ts
//
// Fail-open helpers for auth-critical feature flags. See DECISION-026.
//
// DESIGN CONSTRAINT: these helpers are called from Node-runtime-only paths
// (authorize() and jwt() in src/auth.ts). They must NOT be imported from
// proxy.ts, which runs on the Edge runtime.

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { featureFlags } from "@/lib/db/schema";
import { isFlagEnabled } from "@/lib/flags";

const LOCAL_LOGIN_FLAG = "auth.local_login";
const REQUIRE_2FA_FLAG = "auth.require_2fa";

/**
 * Fail-open helper for the auth-critical `auth.local_login` flag.
 *
 * Standard isFlagEnabled() returns false on a missing row — the WRONG default
 * for a flag that gates the credentials endpoint itself. A missing row (not
 * yet seeded) must be treated as "enabled" so new forks don't get locked out.
 * See DECISION-026.
 *
 * Four outcomes:
 *   row missing  → true  (flag not yet seeded; treat as enabled; fail-open)
 *   row.enabled  → true  (admin left credentials on)
 *   row.enabled  → false (admin explicitly disabled credentials)
 *   DB error     → true  (never lock out credentials sign-in during a DB blip)
 */
export async function isLocalLoginEnabled(): Promise<boolean> {
  try {
    const row = await db.query.featureFlags.findFirst({
      where: eq(featureFlags.key, LOCAL_LOGIN_FLAG),
    });
    // undefined → flag not yet seeded → fail-open (true)
    // null is not expected from Drizzle findFirst, but guard it anyway
    return row == null ? true : row.enabled;
  } catch {
    // DB unreachable → fail-open: never lock everyone out of credentials sign-in
    return true;
  }
}

/**
 * Does any congregation this user belongs to require 2FA?
 *
 * Delegates to presby_two_factor_required(), which is SECURITY DEFINER for the
 * reason finding F26 records: this runs during sign-in, when no organization
 * GUC is set and cannot be — picking an organization happens after
 * authentication. Queried directly, RLS filters it to zero rows for exactly the
 * users it protects. Do not "simplify" this into a Drizzle join.
 *
 * Returns false on any error. That is deliberate and matches DECISION-026's
 * posture: an unreachable database must not newly *impose* a challenge on
 * someone who has never enrolled, which would lock them out during a blip. The
 * user's own `two_factor_required` column still applies — this only ever adds.
 */
async function organizationRequiresTwoFactor(userId: string): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`select presby_two_factor_required(${userId}::uuid) as required`,
    );
    return result.rows[0]?.required === true;
  } catch {
    return false;
  }
}

/**
 * Compute the effective twoFactorRequired value for a jwt() callback.
 *
 * Two sources can require 2FA, and the more restrictive wins:
 *   - `users.two_factor_required` — this person, set by an admin
 *   - any organization they hold an active membership in (per-church policy)
 *
 * Both are then subject to the `auth.require_2fa` master switch, which can turn
 * enforcement off for the whole installation:
 *   flag ON  → true  (user must complete the TOTP challenge on admin routes)
 *   flag OFF → false (master switch disables enforcement everywhere)
 *   DB error → the resolved requirement (pre-feature behavior)
 *
 * This is NOT fail-open: a missing flag row → false → no enforcement. That is
 * the safe default for a flag whose job is to _add_ gating, not to gate sign-in.
 */
export async function computeEffectiveTwoFactor(
  rawRequired: boolean,
  userId?: string,
): Promise<boolean> {
  // The user's own column short-circuits the org lookup; there is nothing a
  // congregation could add to an already-required user.
  const required =
    rawRequired ||
    (userId ? await organizationRequiresTwoFactor(userId) : false);

  if (!required) return false;
  try {
    return await isFlagEnabled(REQUIRE_2FA_FLAG);
  } catch {
    // DB blip: reproduce pre-feature behavior (the resolved requirement)
    return required;
  }
}
