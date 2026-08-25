/**
 * Regression for the Sev-1 2FA bypass —
 * docs/work-log/2026-08-24-totp-callback-bypass-fix.md.
 *
 * Fast, deterministic coverage of the predicate `signInWithCredentials` now
 * evaluates itself (mirroring src/proxy.ts's `twoFactorRequired &&
 * !twoFactorVerified` check) without needing a running server. The e2e spec
 * (e2e/totp-callback-bypass.spec.ts) is the network-observable regression;
 * this is the unit-level guard against the predicate itself drifting.
 *
 * Mocks `@/lib/db` + `computeEffectiveTwoFactor`, NOT `auth()` — see
 * actions.ts's "IMPLEMENTATION NOTE" doc comment for why a same-invocation
 * `auth()` read was tried first and found to return stale (pre-sign-in)
 * data at runtime (NextAuth's zero-arg `auth()` reads `next/headers`'s
 * `headers()`, not `cookies()`, and only `cookies()` reflects a `.set()`
 * from earlier in the same Server Action).
 *
 * `next/navigation`'s real redirect() throws (NEXT_REDIRECT) rather than
 * returning — the mock below matches that so a test can assert BOTH which
 * URL redirect() was called with AND that execution stopped there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const signInMock = vi.fn();
const findFirstMock = vi.fn();
const computeEffectiveTwoFactorMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/auth", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: (...args: unknown[]) => findFirstMock(...args),
      },
    },
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { email: "users.email" }, // opaque column reference — eq() doesn't inspect it
}));

vi.mock("@/lib/auth/local-login", () => ({
  computeEffectiveTwoFactor: (...args: unknown[]) =>
    computeEffectiveTwoFactorMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

// The real "next-auth" package root import (index.js) transitively pulls in
// next/server, which does not resolve under plain Vitest Node.js (matching
// the established pattern in password-reset-actions.test.ts and
// admin/users/actions.test.ts). AuthError itself is a trivial Error subclass
// (@auth/core/errors.ts) — this stub preserves `instanceof` semantics for
// actions.ts's `err instanceof AuthError` check without loading the rest of
// the package.
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));

import { AuthError } from "next-auth";
import { signInWithCredentials } from "./actions";

const INPUT = {
  email: "Test@Presby.invalid",
  password: "hunter2",
  callbackUrl: "/admin",
};

describe("signInWithCredentials", () => {
  beforeEach(() => {
    signInMock.mockReset();
    findFirstMock.mockReset();
    computeEffectiveTwoFactorMock.mockReset();
    redirectMock.mockClear();
  });

  it("redirects to /totp?callbackUrl=<callbackUrl> — NOT the raw destination — when 2FA is required", async () => {
    signInMock.mockResolvedValue(undefined);
    findFirstMock.mockResolvedValue({
      id: "user-1",
      twoFactorRequired: true,
    });
    computeEffectiveTwoFactorMock.mockResolvedValue(true);

    await expect(signInWithCredentials(INPUT)).rejects.toThrow(
      `REDIRECT:/totp?callbackUrl=${encodeURIComponent(INPUT.callbackUrl)}`,
    );

    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirect: false }),
    );
    // Case-insensitive lookup, matching authorize()'s own .toLowerCase().
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(computeEffectiveTwoFactorMock).toHaveBeenCalledWith(true, "user-1");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith(
      `/totp?callbackUrl=${encodeURIComponent(INPUT.callbackUrl)}`,
    );
    // The bug this regresses: redirect() called with the raw destination,
    // bypassing /totp entirely.
    expect(redirectMock).not.toHaveBeenCalledWith(INPUT.callbackUrl);
  });

  it("redirects straight to callbackUrl — no /totp hop — when 2FA is not required", async () => {
    signInMock.mockResolvedValue(undefined);
    findFirstMock.mockResolvedValue({
      id: "user-1",
      twoFactorRequired: false,
    });
    computeEffectiveTwoFactorMock.mockResolvedValue(false);

    await expect(signInWithCredentials(INPUT)).rejects.toThrow(
      `REDIRECT:${INPUT.callbackUrl}`,
    );

    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith(INPUT.callbackUrl);
  });

  it("fails CLOSED (routes through /totp) on a not-found user row — documented residual race, worst case is one harmless TOTP prompt on a vanished session", async () => {
    signInMock.mockResolvedValue(undefined);
    findFirstMock.mockResolvedValue(undefined);

    await expect(signInWithCredentials(INPUT)).rejects.toThrow(
      `REDIRECT:/totp?callbackUrl=${encodeURIComponent(INPUT.callbackUrl)}`,
    );

    expect(computeEffectiveTwoFactorMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith(
      `/totp?callbackUrl=${encodeURIComponent(INPUT.callbackUrl)}`,
    );
    expect(redirectMock).not.toHaveBeenCalledWith(INPUT.callbackUrl);
  });

  it("returns { error } on AuthError and never calls redirect() or the DB lookup", async () => {
    signInMock.mockRejectedValue(new AuthError("CredentialsSignin"));

    const result = await signInWithCredentials(INPUT);

    expect(result).toEqual({ error: "Wrong email or password." });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("re-throws a non-AuthError from signIn() without calling redirect() or the DB lookup", async () => {
    const boom = new Error("db unreachable");
    signInMock.mockRejectedValue(boom);

    await expect(signInWithCredentials(INPUT)).rejects.toThrow(
      "db unreachable",
    );
    expect(redirectMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});
