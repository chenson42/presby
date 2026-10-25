import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The server-side grant that lets the session's 2FA claim be set.
 *
 * The jwt callback in `src/auth.ts` cannot tell a server-side
 * `unstable_update()` from a request that merely carries the same payload, so
 * it reads nothing from the update payload. The claim is instead set only while
 * a grant is active for the token's own subject. A grant is a capability, not
 * data: it lives in the async context of the verification action's request, is
 * never serialized, and is consumed once (DECISION-230).
 *
 * Fails closed: if async context ever stopped reaching the callback, the claim
 * would simply not be set and verification would not stick.
 *
 * NEVER export this from, or wrap it in, a `'use server'` module. Every
 * exported async function of such a file is an endpoint the browser can call.
 * `src/lib/auth/config.ts` (reached by the proxy) must not import it either.
 */
type TwoFactorGrant = {
  userId: string;
  method: "totp" | "recovery";
  consumed: boolean;
};

const storage = new AsyncLocalStorage<TwoFactorGrant>();

/** Runs `fn` with a grant for `userId`; the grant ends when `fn` settles. */
export function withTwoFactorGrant<T>(
  userId: string,
  method: "totp" | "recovery",
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ userId, method, consumed: false }, fn);
}

/**
 * True at most once per grant, and only for the user the grant names. Called by
 * the jwt callback with the token's subject.
 */
export function takeTwoFactorGrant(tokenSub: string): boolean {
  const grant = storage.getStore();
  if (!grant || grant.consumed || grant.userId !== tokenSub) return false;
  grant.consumed = true;
  return true;
}
