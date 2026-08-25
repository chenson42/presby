"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { computeEffectiveTwoFactor } from "@/lib/auth/local-login";

export interface SignInInput {
  email: string;
  password: string;
  turnstileToken?: string;
  callbackUrl: string;
}

/**
 * Server action wrapper for credentials sign-in. Matches the pattern
 * established in src/app/(auth)/totp/actions.ts (DECISION-021).
 *
 * On success: evaluates the 2FA predicate itself (see below) and redirects.
 * On AuthError: returns { error } so the client form can display inline error.
 * On any other error: re-throws (never swallow NEXT_REDIRECT).
 *
 * SECURITY (docs/work-log/2026-08-24-totp-callback-bypass-fix.md): this used
 * to call signIn() with its default `redirect: true`, which throws
 * NEXT_REDIRECT straight to `input.callbackUrl`. When this action is invoked
 * from client code via startTransition (as signin-credentials-form.tsx does)
 * rather than a real browser form POST, Next's Server-Action redirect
 * handling renders the destination route's RSC payload INLINE in the
 * action's own response — no second, browser-visible HTTP request is ever
 * issued. src/proxy.ts's mandatory 2FA gate is Edge middleware keyed on
 * inbound requests; if the destination (e.g. /admin or /o/<slug>) never
 * generates one, the gate never runs, and a 2FA-required-but-unverified user
 * reached the gated page directly. Root cause: this was the ONLY case in the
 * app where a Server-Action redirect target is itself a page with real
 * content instead of another redirect (contrast /launch, which has no UI on
 * its happy path and therefore always forces a second, real request).
 *
 * The fix: call signIn() with `redirect: false` so it only sets the session
 * cookie and returns, then evaluate the SAME predicate src/proxy.ts uses
 * (`twoFactorRequired && !twoFactorVerified`) inside this action, and issue
 * our OWN redirect() call.
 *
 * IMPLEMENTATION NOTE — divergence from the Phase 3 design doc: the design
 * proposed re-reading the session via `auth()` immediately after `signIn()`,
 * on the theory that `signIn({ redirect: false })`'s `cookies().set()` call
 * would be visible to that same-invocation `auth()` read. Verified false at
 * runtime (a debug probe during Phase 4 showed `auth()` returning `null`
 * here): NextAuth's no-arg `auth()` resolves the current session via
 * `next/headers`'s `headers()` — the raw INCOMING request's Cookie header —
 * not via `next/headers`'s `cookies()`, which is the API Next.js actually
 * synchronizes with a same-request `.set()`. `headers()` is immutable input;
 * it never reflects a cookie this same action just wrote. (See
 * node_modules/next-auth/lib/index.js's `initAuth`, the zero-arg branch:
 * `getSession(await headers(), config)`.)
 *
 * Rather than hand-decode NextAuth's session JWT from `cookies()` ourselves
 * (fragile — cookie-name/secure-prefix selection and the JWT `salt` value
 * are internal `@auth/core` details explicitly marked "will be
 * refactored/changed, do not rely on it"), this reuses the exact helper the
 * `jwt()` callback itself calls, `computeEffectiveTwoFactor()`
 * (src/lib/auth/local-login.ts) — the single source of truth for "does this
 * user need 2FA," combining the user's own column, org-level requirements,
 * and the `auth.require_2fa` flag. `twoFactorVerified` needs no lookup at
 * all: `src/auth.ts`'s `jwt()` callback unconditionally sets it to `false`
 * on every fresh sign-in (`user?.id` branch, line ~244) — a session this
 * action itself just created can never carry `true`.
 */
export async function signInWithCredentials(
  input: SignInInput,
): Promise<{ error: string } | undefined> {
  try {
    await signIn("credentials", {
      email: input.email,
      password: input.password,
      turnstileToken: input.turnstileToken ?? "",
      redirectTo: input.callbackUrl,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // CredentialsSignin and other NextAuth errors — return a friendly message.
      // Do not re-throw: the client shows the inline error and resets the widget.
      return { error: "Wrong email or password." };
    }
    // Any non-AuthError (e.g. a NEXT_REDIRECT from some other cause, or an
    // unexpected error) must propagate so Next.js can handle it.
    throw err;
  }

  // signIn() above already succeeded (authorize() found and validated this
  // user), so this lookup is expected to hit. A THROWN exception here (e.g. a
  // DB blip) still propagates, unhandled, rather than being caught and turned
  // into a silent gate bypass. A successful query that returns zero rows
  // (the row was deleted in the narrow window between authorize() and this
  // lookup) is NOT treated as "not required" — it fails CLOSED to `required =
  // true`, routing the user through /totp. Worst case for that vanished-row
  // race, the user sees one harmless TOTP prompt for a session that has
  // nothing left to protect; the alternative (fail open) would silently wave
  // through a genuine 2FA-required user on any transient no-row result.
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
    columns: { id: true, twoFactorRequired: true },
  });

  const required = user
    ? await computeEffectiveTwoFactor(user.twoFactorRequired, user.id)
    : true;

  if (required) {
    redirect(
      `/totp?${new URLSearchParams({ callbackUrl: input.callbackUrl }).toString()}`,
    );
  }
  redirect(input.callbackUrl);
}
