/**
 * Gate function for the NextAuth signIn callback.
 *
 * WHY this is email-keyed for OAuth (not id-keyed):
 *
 *   Auth.js v5 runs the `signIn` callback *before* the adapter creates a new
 *   user row. On a first-time Google sign-in, `user.id` is Google's `sub`
 *   string (e.g. "117483729384657382910") — not a database UUID. An id-keyed
 *   lookup therefore always misses on first sign-in, causing `!dbUser → false`
 *   and an AccessDenied error for every brand-new OAuth user.
 *
 *   Google asserts that it verified an address only through the
 *   `email_verified` claim on the profile, and Auth.js does not enforce it, so
 *   the gate requires the claim to be strictly `true` for every
 *   non-credentials provider and refuses before any lookup (DECISION-246,
 *   amending DECISION-015). With the claim true, using `user.email` as the
 *   lookup key is sound. See DECISION-015 for the deletion-strategy constraint
 *   (soft deactivation only; hard-delete invalidates the email-keyed gate).
 *
 * @see docs/decisions.md — DECISION-015, DECISION-246
 */

export type GateUser = {
  id?: string | null;
  email?: string | null;
};

/**
 * What the provider asserted about the address. `emailVerified` is `unknown`
 * on purpose: Auth.js types the profile claim as an optional boolean, but the
 * gate must refuse any runtime shape other than the boolean `true`. Required,
 * with no default, so a call site that forgets it is a compile error rather
 * than an open door.
 */
export type SignInClaims = { emailVerified: unknown };

/** True only for the boolean `true`; `"true"`, `1`, `null` and absent all fail. */
export function isEmailClaimVerified(claim: unknown): claim is true {
  return claim === true;
}

export type FindUserByEmail = (
  email: string
) => Promise<{ isActive: boolean } | null>;

/**
 * Evaluate whether a signing-in user should be allowed through the NextAuth
 * signIn callback.
 *
 * OAuth branch (provider !== "credentials"):
 *   - email claim not strictly true → false (decided before any lookup, so the
 *     refusal does not depend on whether an account exists)
 *   - no email from provider → false (fail-safe)
 *   - no row (new user)      → true  (adapter will create the row)
 *   - row, isActive = true   → true
 *   - row, isActive = false  → false (deactivated; block)
 *
 * Credentials branch:
 *   - returns true unconditionally.
 *   authorize() has already verified isActive and returned null if the user
 *   was inactive; NextAuth would not have called signIn if authorize()
 *   returned null. A second lookup here is a dead round-trip (see DECISION-015).
 *
 * @param provider        NextAuth provider id ("google", "credentials", etc.)
 * @param user            The user object from the signIn callback
 * @param claims          The provider's assertion about the address; only
 *                        `emailVerified === true` passes. Ignored for
 *                        credentials.
 * @param findUserByEmail Injected DB lookup — receives a lowercased email,
 *                        returns { isActive } or null. Only called for OAuth.
 */
export async function evaluateSignIn(
  provider: string,
  user: GateUser,
  claims: SignInClaims,
  findUserByEmail: FindUserByEmail,
): Promise<boolean> {
  if (provider === "credentials") {
    return true;
  }

  // OAuth path. The claim is checked first: an unverified address must not
  // reach the lookup, where it could match (and sign in as) an existing user.
  if (!isEmailClaimVerified(claims.emailVerified)) return false;

  if (!user.email) return false; // fail-safe: no email, cannot key the lookup

  const email = user.email.toLowerCase();
  const row = await findUserByEmail(email);

  if (row === null) return true; // new user — let the adapter create the row
  return row.isActive;           // existing user — honour soft-deactivation
}
